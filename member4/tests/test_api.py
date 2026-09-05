# -*- coding: utf-8 -*-
"""
API / 管线集成自测：POST /start -> 处理 -> GET /report 闭环（含 proof_data 哈希校验）
运行：python tests/test_api.py

说明：使用 TestClient context 保持应用事件循环，按线上方式等待后台任务完成，
不直接重复调用 process_task。
"""
import os
import sys
import copy

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import time

os.environ.setdefault("USE_MOCK_DATA", "true")
os.environ.setdefault("MEMBER3_PATH", "")  # 若有成员3 目录，可在此指向

from fastapi.testclient import TestClient
import app as app_module
from app import app, store, TaskStatus
import hashing
from report_builder import SUCCESS_PROOF_STEPS, compute_report_payload_hash

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} -> {detail}")


def test_pipeline():
    print("\n[1] /start -> process_task -> /report 闭环")
    client = TestClient(app)
    client.__enter__()
    h = client.get("/api/v1/health")
    check("health 200", h.status_code == 200, str(h.status_code))
    print("    health:", h.json())
    check("health 明确返回 ChainAgent 状态",
          h.json().get("chain_agent_status") in ("mock", "real"), str(h.json()))
    connected = h.json().get("member3_connected")
    check("member3 已从同级目录自动接入", connected is True, str(connected))

    r = client.post("/api/v1/audit/start", json={
        "target_type": "HYBRID",
        "contract_address": "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
        "chain_id": 11155111,
        "whitepaper_text": "团队持有 10% 代币，锁仓 2 年。已由 CertiK 完成审计。APY 30%。",
        "_note": "成员1交付说明，不进入审计证明正文。",
    })
    check("start 返回 200 + task_id", r.status_code == 200 and "task_id" in r.json(), str(r.status_code))
    if r.status_code != 200:
        client.__exit__(None, None, None)
        return
    task_id = r.json()["task_id"]

    for _ in range(200):
        if store.get(task_id)["status"] in (TaskStatus.COMPLETED, TaskStatus.FAILED):
            break
        time.sleep(0.01)

    rec = store.get(task_id)
    check("任务状态 COMPLETED", rec["status"] == TaskStatus.COMPLETED, str(rec["status"]))
    report = rec["report"]
    check("report 非空", report is not None)

    check("含 proof_data", "proof_data" in report)
    pd = report["proof_data"]
    check("merkle_root 非空且 0x", bool(pd.get("merkle_root")) and pd["merkle_root"].startswith("0x"))
    check("report_hash 非空且 0x", bool(pd.get("report_hash")) and pd["report_hash"].startswith("0x"))
    check("reasoning_step_hashes 为列表", isinstance(pd.get("reasoning_step_hashes"), list))
    check("哈希算法为 Ethereum keccak256",
          pd.get("hash_algorithm") == "ethereum-keccak256" and pd.get("hash_version") == "keccak-v1")
    check("含完整七步有序 steps", isinstance(pd.get("steps"), list) and len(pd["steps"]) == 7)
    check("step_hashes 覆盖每一步", pd.get("step_hashes") == [s["step_hash"] for s in pd["steps"]])
    check("七步哈希均真实独立", len(set(pd.get("step_hashes", []))) == 7)
    check("summary 含 overall_risk_score", "overall_risk_score" in report.get("summary", {}))
    check("findings 为列表", isinstance(report.get("findings"), list))
    check("含 disclaimer", bool(report.get("disclaimer")))
    step_events = [e for e in rec["entries"] if e.get("event") == "STEP"]
    check("SSE entries 含全部关键步骤",
          [e["current_step"] for e in step_events] == [
              "INPUT_VALIDATED", "CHAIN_FETCHED", "DOC_PARSING",
              "CROSS_CHECKING", "RISK_SCORING", "REPORT_ASSEMBLED",
              "PROOF_MANIFEST_COMPILED",
          ])
    check("SSE 最后一条为 COMPLETED", rec["entries"][-1].get("event") == "COMPLETED")

    # 每一步索引唯一连续，且能只用 SSE/报告携带的字段重算。
    steps = pd["steps"]
    check("step_index 严格为 0..N-1",
          [s["step_index"] for s in steps] == list(range(len(steps))))
    check("成员1交付注释可接受且不进入证明正文",
          "_note" not in steps[0]["input"] and "delivery_note" not in steps[0]["input"])
    continuous = True
    prev = hashing.ZERO_HASH
    for step in steps:
        expected_input_hash = hashing.keccak256_hex(
            hashing.canonical_json(step["input"]).encode("utf-8")
        )
        expected_output_hash = hashing.keccak256_hex(
            hashing.canonical_json(step["output"]).encode("utf-8")
        )
        expected_content = hashing.canonical_json({
            "task_id": step["task_id"],
            "step_index": step["step_index"],
            "source": step["source"],
            "agent": step["agent"],
            "current_step": step["current_step"],
            "message": step["message"],
            "evidence": step["evidence"],
            "input_hash": expected_input_hash,
            "output_hash": expected_output_hash,
        })
        if step["previous_step_hash"] != prev:
            continuous = False
            break
        if step["input_hash"] != expected_input_hash or step["output_hash"] != expected_output_hash:
            continuous = False
            break
        if step["hash_content"] != expected_content:
            continuous = False
            break
        if not hashing.verify_step(
            prev, step["hash_content"], step["timestamp_ms"], step["step_hash"]
        ):
            continuous = False
            break
        prev = step["step_hash"]
    check("完整步骤链连续且可重算", continuous)

    manifest = steps[-1]
    check("第七步为证明清单编译",
          manifest["current_step"] == SUCCESS_PROOF_STEPS[-1])
    check("证明清单声明完整七步顺序",
          manifest["output"].get("ordered_steps") == list(SUCCESS_PROOF_STEPS))
    check("证明清单承诺前六个真实哈希",
          manifest["input"].get("ordered_prior_step_hashes") == pd["step_hashes"][:-1])
    check("证明清单正文哈希可重算",
          manifest["output"].get("report_payload_hash") == compute_report_payload_hash(report)
          and pd.get("report_payload_hash") == compute_report_payload_hash(report))
    check("proof_data 指向第七步哈希",
          pd.get("manifest_step_hash") == manifest["step_hash"])
    check("backend_step_hashes 包含四个后端步骤",
          pd.get("backend_step_hashes") == [
              step["step_hash"] for step in steps if step["source"] == "BACKEND"
          ] and len(pd.get("backend_step_hashes", [])) == 4)

    check("merkle_root 由全部 step_hashes 复现一致",
          hashing.merkle_root(pd["step_hashes"]) == pd["merkle_root"])
    check("report_hash 由完整报告复现一致",
          hashing.compute_report_hash(report) == pd["report_hash"])

    tampered = dict(report)
    tampered["proof_data"] = dict(report["proof_data"])
    tampered["proof_data"]["merkle_root"] = "0x" + "1" * 64
    check("篡改 merkle_root 会改变 report_hash",
          hashing.compute_report_hash(tampered) != pd["report_hash"])

    tampered_payload = copy.deepcopy(report)
    tampered_payload["summary"]["overall_risk_score"] += 1
    check("篡改业务正文会破坏证明清单承诺",
          compute_report_payload_hash(tampered_payload) != pd["report_payload_hash"])

    # 完成后的 SSE 可被迟到订阅者完整读取，不会挂起。
    stream = client.get(f"/api/v1/audit/stream/{task_id}")
    check("迟到订阅 SSE 返回 200 + 终态",
          stream.status_code == 200 and '"event": "COMPLETED"' in stream.text)

    # 浏览器联调 CORS 与请求校验。
    cors = client.options("/api/v1/audit/start", headers={
        "Origin": "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
    })
    check("允许配置的前端 Origin",
          cors.headers.get("access-control-allow-origin") == "http://localhost:3000")
    denied_cors = client.options("/api/v1/audit/start", headers={
        "Origin": "https://untrusted.example",
        "Access-Control-Request-Method": "POST",
    })
    check("未配置 Origin 不获授权",
          denied_cors.headers.get("access-control-allow-origin") is None)
    bad = client.post("/api/v1/audit/start", json={
        "target_type": "CONTRACT", "contract_address": "0x123", "chain_id": 11155111,
    })
    check("无效 Ethereum 地址返回 422", bad.status_code == 422, str(bad.status_code))
    client.__exit__(None, None, None)


def test_failure_terminal():
    print("\n[2] 失败终态与错误报告")
    original_fetch = app_module.chain_agent.fetch

    def fail_fetch(*_args, **_kwargs):
        raise RuntimeError("forced test failure")

    app_module.chain_agent.fetch = fail_fetch
    client = TestClient(app)
    client.__enter__()
    try:
        response = client.post("/api/v1/audit/start", json={
            "target_type": "CONTRACT",
            "contract_address": "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
            "chain_id": 11155111,
        })
        task_id = response.json()["task_id"]
        for _ in range(200):
            rec = store.get(task_id)
            if rec["status"] in (TaskStatus.COMPLETED, TaskStatus.FAILED):
                break
            time.sleep(0.01)

        rec = store.get(task_id)
        check("任务状态 FAILED", rec["status"] == TaskStatus.FAILED, str(rec["status"]))
        check("SSE 最后一条为 FAILED", rec["entries"][-1].get("event") == "FAILED")
        check("失败步骤也进入哈希链",
              rec["report"]["proof_data"]["steps"][-1]["current_step"] == "PROCESS_FAILED")
        report_response = client.get(f"/api/v1/audit/report/{task_id}")
        check("失败报告可读取", report_response.status_code == 200)
    finally:
        app_module.chain_agent.fetch = original_fetch
        client.__exit__(None, None, None)


if __name__ == "__main__":
    test_pipeline()
    test_failure_terminal()
    print("\n" + "=" * 60)
    print(f"TOTAL: {PASS} PASS, {FAIL} FAIL")
    raise SystemExit(0 if FAIL == 0 else 1)
