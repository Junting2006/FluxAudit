"""
FluxAudit（流审）· 成员4 后端主服务（FastAPI）
=================================================================
核心 API（与分工.md 对齐）：
  POST /api/v1/audit/start            -> 提交审计任务
  GET  /api/v1/audit/stream/:task_id  -> SSE 实时推演日志（每条带 step_hash）
  GET  /api/v1/audit/report/:task_id  -> 最终审计报告（含 proof_data）
  GET  /api/v1/health                 -> 健康检查

兼任"总集成与技术负责人"：一条命令启动，端到端闭环。

哈希口径（强制）：所有 step_hash / merkle_root / report_hash 均使用本包 hashing 模块的
Ethereum keccak256；编排链为 入参校验 -> 链上拉取 -> AI 三步 -> 报告组装 -> 证明清单 -> Merkle -> 报告哈希，
每一步都生成 keccak256 step_hash，形成连续可验证的证明链。
"""

import asyncio
import json
import os
import re
import sys
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# 让本包模块可被直接运行（python app.py）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import (
    CORS_ORIGINS,
    USE_MOCK_DATA,
    DEFAULT_USE_LLM,
    DEFAULT_CHAIN_ID,
    DISCLAIMER,
)
from hashing import (
    HASH_ALGORITHM,
    HASH_VERSION,
    ZERO_HASH,
    canonical_json,
    keccak256_hex,
    hash_step,
    now_ms,
)
from chain_agent import ChainAgent
from agent_adapter import get_agent_result, RUN_AGENT_PROCESS
from report_builder import build_proof_manifest, build_report, finalize_proof
from task_queue import store, TaskStatus

app = FastAPI(title="FluxAudit Backend (Member 4)", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Last-Event-ID"],
)

chain_agent = ChainAgent()
_task_counter = {"n": 0}
_ADDRESS_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")


class AuditStartRequest(BaseModel):
    """前端提交审计任务的显式边界。"""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    target_type: Literal["CONTRACT", "DOCUMENT", "HYBRID"] = "HYBRID"
    contract_address: str = ""
    chain_id: int = Field(default=DEFAULT_CHAIN_ID, ge=1)
    whitepaper_text: str = Field(default="", max_length=200_000)
    file_base64: str | None = Field(default=None, max_length=8_000_000)
    use_llm: bool = DEFAULT_USE_LLM
    delivery_note: str | None = Field(
        default=None,
        alias="_note",
        exclude=True,
        max_length=500,
    )

    @field_validator("contract_address")
    @classmethod
    def validate_contract_address(cls, value: str) -> str:
        value = value.strip()
        if value and not _ADDRESS_RE.fullmatch(value):
            raise ValueError("contract_address must be a 20-byte 0x-prefixed address")
        return value

    @model_validator(mode="after")
    def require_audit_target(self):
        if not (self.contract_address or self.whitepaper_text.strip() or self.file_base64):
            raise ValueError("provide contract_address, whitepaper_text, or file_base64")
        return self


def _gen_task_id() -> str:
    _task_counter["n"] += 1
    return f"task_{os.getpid()}_{_task_counter['n']:06d}"


def _build_step(task_id: str, steps: list, source: str, agent: str,
                current_step: str, message: str, input_data=None, output=None,
                evidence=None, timestamp_ms: int | None = None) -> dict:
    """按真实事件顺序生成可跨端重算的 keccak-v1 步骤。"""
    step_index = len(steps)
    previous_step_hash = steps[-1]["step_hash"] if steps else ZERO_HASH
    timestamp_ms = now_ms() if timestamp_ms is None else timestamp_ms
    input_value = input_data if input_data is not None else {}
    output_value = output if output is not None else {}
    input_hash = keccak256_hex(canonical_json(input_value).encode("utf-8"))
    output_hash = keccak256_hex(canonical_json(output_value).encode("utf-8"))
    payload = {
        "task_id": task_id,
        "step_index": step_index,
        "source": source,
        "agent": agent,
        "current_step": current_step,
        "message": message,
        "evidence": evidence or [],
        "input_hash": input_hash,
        "output_hash": output_hash,
    }
    hash_content = canonical_json(payload)
    step_hash = hash_step(previous_step_hash, hash_content, timestamp_ms)
    return {
        **payload,
        "input": input_value,
        "output": output_value,
        "timestamp": timestamp_ms,
        "timestamp_ms": timestamp_ms,
        "previous_step_hash": previous_step_hash,
        "hash_content": hash_content,
        "step_hash": step_hash,
        "hash_algorithm": HASH_ALGORITHM,
        "hash_version": HASH_VERSION,
    }


def _step_event(step: dict) -> dict:
    return {
        "event": "STEP",
        "task_id": step["task_id"],
        "status": TaskStatus.PROCESSING.value,
        "current_step": step["current_step"],
        "log_entry": step,
    }


def _publish_step(task_id: str, steps: list, **kwargs) -> dict:
    step = _build_step(task_id, steps, **kwargs)
    steps.append(step)
    store.publish(task_id, _step_event(step))
    return step


def _terminal_event(task_id: str, status: TaskStatus, **extra) -> dict:
    return {
        "event": status.value,
        "task_id": task_id,
        "status": status.value,
        **extra,
    }


async def process_task(task_id: str, input_data: dict):
    """后台编排：逐步骤哈希并推送 SSE，最终产出带 proof_data 的报告。"""
    steps = []
    try:
        store.set_status(task_id, TaskStatus.PROCESSING)
        contract_address = input_data.get("contract_address", "")
        chain_id = input_data.get("chain_id", DEFAULT_CHAIN_ID)
        whitepaper_text = input_data.get("whitepaper_text", "")
        use_llm = input_data.get("use_llm", DEFAULT_USE_LLM)

        # ---- 后端步骤 0：输入校验（统一哈希链起点）----
        in_summary = {k: input_data.get(k) for k in ("target_type", "contract_address", "chain_id")}
        _publish_step(
            task_id,
            steps,
            source="BACKEND",
            agent="Backend",
            current_step="INPUT_VALIDATED",
            message="任务入参已校验。",
            input_data=in_summary,
            output={"valid": True},
        )

        # ---- 链上数据拉取 ----
        chain_data = await asyncio.to_thread(chain_agent.fetch, contract_address, chain_id)
        _publish_step(
            task_id,
            steps,
            source="BACKEND",
            agent="ChainAgent",
            current_step="CHAIN_FETCHED",
            message="链上数据已拉取：" + chain_agent.summarize(chain_data),
            input_data={"contract_address": contract_address, "chain_id": chain_id},
            output=chain_data,
        )

        # ---- AI 多智能体（成员3 / Mock）；成员4按统一链重新哈希 ----
        agent_result = await asyncio.to_thread(
            get_agent_result, task_id, whitepaper_text, chain_data, use_llm
        )
        reasoning_steps = []
        for entry in agent_result.get("reasoning_log", []):
            evidence = entry.get("evidence") or []
            if not evidence and isinstance(entry.get("output"), list):
                evidence = [
                    item.get("evidence") for item in entry["output"]
                    if isinstance(item, dict) and item.get("evidence")
                ]
            step = _publish_step(
                task_id,
                steps,
                source="AI",
                agent=entry.get("agent") or "Agent",
                current_step=entry.get("current_step") or "AGENT_PROCESSING",
                message=entry.get("message") or "Agent 步骤已完成。",
                input_data=entry.get("input") or {
                    "previous_step_hash": steps[-1]["step_hash"],
                },
                output=entry.get("output", {}),
                evidence=evidence,
            )
            reasoning_steps.append(step)

        agent_result["step_hashes"] = [step["step_hash"] for step in reasoning_steps]
        agent_result["reasoning_log"] = reasoning_steps

        # ---- 报告组装：作为最后一个业务步骤纳入哈希链 ----
        report = build_report(agent_result, chain_data)
        _publish_step(
            task_id,
            steps,
            source="BACKEND",
            agent="ReportBuilder",
            current_step="REPORT_ASSEMBLED",
            message="结构化审计报告已组装。",
            input_data={"step_hashes": [step["step_hash"] for step in steps]},
            output={
                "task_id": report["task_id"],
                "risk_score": report["summary"]["overall_risk_score"],
                "findings_count": len(report["findings"]),
            },
        )

        # ---- 证明清单编译：第七个独立业务步骤，承诺正文与前六步的顺序 ----
        manifest = build_proof_manifest(report, steps)
        _publish_step(
            task_id,
            steps,
            source="BACKEND",
            agent="ProofCompiler",
            current_step="PROOF_MANIFEST_COMPILED",
            message="七步证明清单已编译并校验。",
            input_data=manifest["input"],
            output=manifest["output"],
            evidence=[
                f"prior_steps:{manifest['output']['prior_step_count']}",
                f"report_payload_hash:{manifest['output']['report_payload_hash']}",
            ],
        )
        report = finalize_proof(report, steps)

        store.set_report(task_id, report)
        store.set_status(task_id, TaskStatus.COMPLETED)
        store.publish(task_id, _terminal_event(
            task_id,
            TaskStatus.COMPLETED,
            merkle_root=report["proof_data"]["merkle_root"],
            report_hash=report["proof_data"]["report_hash"],
        ))
    except Exception as exc:  # 任何异常也兜底为可读报告，保证 Demo 不崩
        error_code = type(exc).__name__.upper()
        try:
            _publish_step(
                task_id,
                steps,
                source="BACKEND",
                agent="Backend",
                current_step="PROCESS_FAILED",
                message="审计处理失败。",
                input_data={"completed_steps": len(steps)},
                output={"error_code": error_code},
            )
        except Exception:
            pass
        err_report = {
            "task_id": task_id,
            "meta": {
                "model_version": "error",
                "timestamp": int(now_ms() / 1000),
                "status": TaskStatus.FAILED.value,
            },
            "summary": {"overall_risk_score": 0, "risk_level": "LOW",
                        "verdict": "审计处理失败，请重试或切换 Mock 模式。"},
            "findings": [],
            "proof_data": {
                "hash_algorithm": HASH_ALGORITHM,
                "hash_version": HASH_VERSION,
                "manifest_version": "proof-manifest-v1",
                "steps": [],
                "step_hashes": [],
                "reasoning_step_hashes": [],
                "backend_step_hashes": [],
                "manifest_step_hash": "",
                "report_payload_hash": "",
                "merkle_root": "",
                "report_hash": "",
            },
            "disclaimer": DISCLAIMER,
        }
        err_report = finalize_proof(err_report, steps)
        store.set_report(task_id, err_report)
        store.set_status(task_id, TaskStatus.FAILED)
        store.publish(task_id, _terminal_event(
            task_id,
            TaskStatus.FAILED,
            error_code=error_code,
            message="审计处理失败，请重试或切换 Mock 模式。",
        ))
    finally:
        store.finish(task_id)


@app.post("/api/v1/audit/start")
async def start_audit(request: AuditStartRequest):
    input_data = request.model_dump(exclude_none=True)
    task_id = _gen_task_id()
    store.create(task_id, input_data)
    asyncio.create_task(process_task(task_id, input_data))
    return {
        "task_id": task_id,
        "status": TaskStatus.PROCESSING.value,
        "created_at": store.get(task_id)["created_at"],
    }


@app.get("/api/v1/audit/stream/{task_id}")
async def stream_audit(task_id: str):
    rec = store.get(task_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="task not found")

    async def event_gen():
        # 先订阅再重放，避免两者之间发布的事件丢失；seen 消除重叠事件。
        q = store.subscribe(task_id)
        seen = set()

        def event_key(entry: dict):
            if entry.get("event") == "STEP":
                return ("STEP", entry.get("log_entry", {}).get("step_index"))
            return (entry.get("event"), entry.get("status"))

        try:
            for entry in list(rec["entries"]):
                key = event_key(entry)
                if key in seen:
                    continue
                seen.add(key)
                yield f"data: {json.dumps(entry, ensure_ascii=False)}\n\n"
            while True:
                item = await q.get()
                if item is None:
                    break
                key = event_key(item)
                if key in seen:
                    continue
                seen.add(key)
                yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
        finally:
            store.subscribers.get(task_id, set()).discard(q)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/v1/audit/report/{task_id}")
async def get_report(task_id: str):
    rec = store.get(task_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="task not found")
    if rec["report"] is not None:
        return rec["report"]
    if rec["status"] not in (TaskStatus.COMPLETED, TaskStatus.FAILED):
        return JSONResponse(
            status_code=202,
            content={"task_id": task_id, "status": rec["status"].value,
                     "message": "审计处理中，请稍后重试或订阅 /stream。"},
        )
    raise HTTPException(status_code=500, detail="task finished without a report")


@app.get("/api/v1/health")
async def health():
    return {
        "status": "ok",
        "use_mock_data": USE_MOCK_DATA,
        "chain_agent_status": chain_agent.status(),
        "member3_connected": RUN_AGENT_PROCESS is not None,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
