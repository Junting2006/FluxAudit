"""
FluxAudit（流审）· 成员4 报告组装
=================================================================
把成员3 的结构化结果 + ChainAgent 数据，映射为分工.md 中
GET /api/v1/audit/report/:task_id 的最终报告 JSON，并完成全部哈希。

哈希责任划分（确保"每一步都哈希"且口径统一）：
- app.py 按真实事件顺序统一重算全部步骤，成员3 原始哈希不直接并入最终证明链；
- 第七步编译证明清单，承诺前六步顺序、哈希与业务报告正文；
- merkle_root 由全部 step_hashes 构建，而不是只覆盖 AI 步骤；
- report_hash 仅排除自身，保护完整报告、步骤与 Merkle Root。
"""

from config import DISCLAIMER
from hashing import (
    HASH_ALGORITHM,
    HASH_VERSION,
    canonical_json,
    compute_report_hash,
    keccak256_hex,
    merkle_root,
    now_ms,
)


SUCCESS_PROOF_STEPS = (
    "INPUT_VALIDATED",
    "CHAIN_FETCHED",
    "DOC_PARSING",
    "CROSS_CHECKING",
    "RISK_SCORING",
    "REPORT_ASSEMBLED",
    "PROOF_MANIFEST_COMPILED",
)


def compute_report_payload_hash(report: dict) -> str:
    """哈希业务报告正文；proof_data 单独由第七步和最终 report_hash 保护。"""
    payload = {
        key: report[key]
        for key in ("task_id", "meta", "summary", "findings", "disclaimer")
        if key in report
    }
    return keccak256_hex(canonical_json(payload).encode("utf-8"))


def build_proof_manifest(report: dict, prior_steps: list) -> dict:
    """编译第七步的真实证明清单，并拒绝不完整或乱序的成功链。"""
    expected_prior = list(SUCCESS_PROOF_STEPS[:-1])
    actual_prior = [step.get("current_step") for step in prior_steps]
    if actual_prior != expected_prior:
        raise ValueError(
            "cannot compile proof manifest: expected ordered steps "
            f"{expected_prior}, got {actual_prior}"
        )

    prior_hashes = [step["step_hash"] for step in prior_steps]
    payload_hash = compute_report_payload_hash(report)
    return {
        "input": {
            "ordered_prior_step_hashes": prior_hashes,
            "report_payload_hash": payload_hash,
        },
        "output": {
            "manifest_version": "proof-manifest-v1",
            "hash_algorithm": HASH_ALGORITHM,
            "hash_version": HASH_VERSION,
            "ordered_steps": list(SUCCESS_PROOF_STEPS),
            "prior_step_count": len(prior_steps),
            "final_step_count": len(SUCCESS_PROOF_STEPS),
            "report_payload_hash": payload_hash,
        },
    }


def build_report(agent_result: dict, chain_data: dict, meta_extra: dict = None) -> dict:
    """
    入参 agent_result：成员3（或 Mock）run_agent_process 的输出。
    返回最终报告字典（proof_data 先留空，由 finalize_proof 填充）。
    """
    task_id = agent_result.get("task_id", "task_unknown")
    risk_score = agent_result.get("risk_score", 0)
    risk_level = agent_result.get("risk_level", "LOW")
    risk_reasons = agent_result.get("risk_reasons", [])
    contradictions = agent_result.get("contradictions", [])

    model_version = (agent_result.get("meta") or {}).get("model_version", "unknown")
    data_sources = ["Sepolia RPC", "Whitepaper", "Etherscan API"]
    if chain_data.get("_mock"):
        data_sources = ["Mock Chain Data", "Whitepaper", "Rule Engine"]

    meta = {
        "model_version": model_version,
        "data_sources": data_sources,
        "data_mode": chain_data.get("_mode", "mock" if chain_data.get("_mock") else "real"),
        "data_provenance": chain_data.get("provenance", {}),
        "timestamp": int(now_ms() / 1000),
    }
    if meta_extra:
        meta.update(meta_extra)

    summary = {
        "overall_risk_score": risk_score,
        "risk_level": risk_level,
        "verdict": "；".join(risk_reasons) if risk_reasons else "未检测到明显风险。",
    }

    findings = []
    for c in contradictions:
        findings.append({
            "category": c.get("category"),
            "severity": c.get("severity"),
            "title": c.get("title"),
            "description": c.get("description"),
            "evidence": c.get("evidence"),
        })

    report = {
        "task_id": task_id,
        "meta": meta,
        "summary": summary,
        "findings": findings,
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
    return report


def finalize_proof(report: dict, steps: list):
    """
    把统一有序步骤写入报告，计算覆盖全部步骤的 Merkle Root 与报告哈希。
    成功报告应包含 PROOF_MANIFEST_COMPILED；失败报告允许保留已执行步骤。
    """
    step_hashes = [step["step_hash"] for step in steps]
    merkle = merkle_root(step_hashes)
    proof_data = report["proof_data"]
    proof_data["steps"] = steps
    proof_data["step_hashes"] = step_hashes
    proof_data["reasoning_step_hashes"] = [
        step["step_hash"] for step in steps if step.get("source") == "AI"
    ]
    proof_data["backend_step_hashes"] = [
        step["step_hash"] for step in steps if step.get("source") == "BACKEND"
    ]
    manifest_steps = [
        step for step in steps if step.get("current_step") == "PROOF_MANIFEST_COMPILED"
    ]
    if manifest_steps:
        manifest = manifest_steps[-1]
        proof_data["manifest_step_hash"] = manifest["step_hash"]
        proof_data["report_payload_hash"] = manifest["output"]["report_payload_hash"]
    proof_data["merkle_root"] = merkle
    proof_data["report_hash"] = compute_report_hash(report)
    return report
