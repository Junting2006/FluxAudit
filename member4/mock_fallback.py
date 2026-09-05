"""
FluxAudit（流审）· 成员4 Mock 兜底（防 AI 超时 / 成员3 未接入）
=================================================================
当 USE_MOCK_DATA=true 或成员3 / LLM 不可用时，自动切入本静态数据源，
输出与成员3 run_agent_process 完全一致结构的字典，保证 2 分钟 Demo 无卡顿。

关键：所有哈希仍使用 Ethereum keccak256（hashing 模块），确保可验证闭环不破——
即使走 Mock，SSE 的每条日志、report 的 merkle_root / report_hash 仍然可复核、可上链。
"""

from hashing import (
    ZERO_HASH,
    canonical_json,
    hash_step,
    now_ms,
)
from config import DISCLAIMER, MODEL_VERSION

# 合成高风险示例（与成员3 demo 一致，便于对照）
_MOCK_CHAIN_DATA = {
    "team_wallet_pct": 82,
    "top_wallet_concentration_pct": 82,
    "has_timelock": False,
    "contract_verified": False,
}


def _log(agent, current_step, message, timestamp, step_index, step_hash, output):
    return {
        "agent": agent,
        "current_step": current_step,
        "message": message,
        "timestamp": timestamp,
        "step_index": step_index,
        "step_hash": step_hash,
        "output": output,
    }


def run_mock_agent(task_id: str, whitepaper_text: str, chain_data: dict = None) -> dict:
    """
    返回与成员3 run_agent_process 完全相同字段结构的字典。
    包含 reasoning_log（每条带 keccak256 step_hash）、step_hashes、contradictions 等。
    """
    chain_data = chain_data or _MOCK_CHAIN_DATA
    reasoning_log = []
    prev = ZERO_HASH

    # Step 0：DocAgent（Mock）
    doc_result = {
        "team_allocation_pct": 10,
        "has_lockup_claim": True,
        "lockup_years": 2.0,
        "audit_claimed": True,
        "audit_firm": "certik",
        "high_yield_promise": True,
        "yield_pct": 30,
        "statements": [{"field": "mock", "value": "演示用合成数据"}],
    }
    ts0 = now_ms()
    msg0 = "DocAgent（Mock）完成文档解析，提取声明 1 条。"
    h0 = hash_step(prev, canonical_json(doc_result) + "|" + msg0, ts0)
    reasoning_log.append(_log("DocAgent", "DOC_PARSING", msg0, ts0, 0, h0, doc_result))

    # Step 1：CrossCheckAgent（Mock）
    contradictions = [
        {
            "category": "TOKENOMICS_MISMATCH",
            "severity": "CRITICAL",
            "title": "代币分配与智能合约逻辑矛盾",
            "description": f"文档声明团队持股 10%，实际链上团队钱包占比 {chain_data.get('team_wallet_pct')}%。",
            "evidence": "Mock Whitepaper vs chain team_wallet_pct",
        },
        {
            "category": "LOCKUP_VIOLATION",
            "severity": "CRITICAL",
            "title": "锁仓承诺与链上合约约束矛盾",
            "description": "文档承诺锁仓 2 年，但链上合约未发现 TimeLock 约束。",
            "evidence": "Mock Whitepaper vs chain has_timelock=False",
        },
        {
            "category": "WALLET_CONCENTRATION",
            "severity": "CRITICAL",
            "title": "链上代币高度集中",
            "description": f"头部钱包持仓占比达 {chain_data.get('top_wallet_concentration_pct')}%，存在单一实体控盘风险。",
            "evidence": "chain top_wallet_concentration_pct",
        },
    ]
    ts1 = now_ms()
    msg1 = f"CrossCheckAgent（Mock）完成交叉核验，发现矛盾 {len(contradictions)} 条。"
    h1 = hash_step(h0, canonical_json(contradictions) + "|" + msg1, ts1)
    reasoning_log.append(_log("CrossCheckAgent", "CROSS_CHECKING", msg1, ts1, 1, h1, contradictions))

    # Step 2：RiskAgent（Mock）
    risk = {
        "risk_score": 85,
        "risk_level": "HIGH",
        "risk_reasons": ["代币分配与链上实际持仓严重不符", "锁仓承诺无链上约束", "代币高度集中"],
    }
    ts2 = now_ms()
    msg2 = f"RiskAgent（Mock）综合打分：{risk['risk_score']} 分，风险等级 {risk['risk_level']}。"
    h2 = hash_step(h1, canonical_json(risk) + "|" + msg2, ts2)
    reasoning_log.append(_log("RiskAgent", "RISK_SCORING", msg2, ts2, 2, h2, risk))

    return {
        "task_id": task_id,
        "current_step": "RISK_SCORING",
        "meta": {
            "model_version": MODEL_VERSION + "(Mock)",
            "timestamp": ts2,
            "fallback_reason": "USE_MOCK_DATA / 成员3 未接入时的静态兜底",
        },
        "risk_score": risk["risk_score"],
        "risk_level": risk["risk_level"],
        "risk_reasons": risk["risk_reasons"],
        "contradictions": contradictions,
        "reasoning_log": reasoning_log,
        "step_hashes": [e["step_hash"] for e in reasoning_log],
        "doc_result": doc_result,
        "chain_data_used": chain_data,
        "disclaimer": DISCLAIMER,
    }
