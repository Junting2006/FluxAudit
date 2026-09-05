# test_llm_fallback.py
import os
from agent_process import run_agent_process

# 强制走 LLM 路径，但不配 key —— 应自动降级到规则引擎且记录 fallback_reason
r = run_agent_process({
    "task_id": "llm_fallback_001",
    "whitepaper_text": "团队持有 10% 代币，锁仓 2 年。",
    "chain_data": {"team_wallet_pct": 82, "top_wallet_concentration_pct": 82,
                   "has_timelock": False, "contract_verified": True},
    "use_llm": True,   # 注意：当前版本 run_agent_process 还不认这个入参，需先按 P0-2 重构
})
assert r["risk_level"] in ("LOW", "MEDIUM", "HIGH", "CRITICAL")
assert len(r["contradictions"]) == 3, f"降级后应仍有 3 条硬性矛盾，实际 {len(r['contradictions'])}"
print("LLM 降级路径 OK，fallback_reason:", r["meta"].get("fallback_reason"))