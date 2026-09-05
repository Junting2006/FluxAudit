# test_llm_success_path.py —— 仅当配置了 DEEPSEEK_API_KEY 后运行
from agent_process import run_agent_process

r = run_agent_process({
    "task_id": "llm_ok_001",
    "whitepaper_text": "团队持有 10% 代币，锁仓 2 年，已由 CertiK 审计，APY 30%。",
    "chain_data": {"team_wallet_pct": 82, "top_wallet_concentration_pct": 82,
                   "has_timelock": False, "contract_verified": True},
    "use_llm": True,
})
# 关键断言：LLM 成功路径也必须包含规则引擎的 3 条硬性矛盾
assert len(r["contradictions"]) == 3, \
    f"LLM 成功路径硬性矛盾丢失：{len(r['contradictions'])} 条"
assert r["risk_score"] == 85 and r["risk_level"] == "HIGH"
print("LLM 成功路径 OK：", r["doc_result"], r["risk_score"], r["risk_level"])