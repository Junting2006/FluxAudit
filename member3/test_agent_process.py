# -*- coding: utf-8 -*-
"""
FluxAudit 成员3 自测脚本
运行：python test_agent_process.py
标准：0 FAIL 才算"没问题"，可交付成员4联调。
"""
from agent_process import (
    doc_agent, cross_check_agent, risk_agent, run_agent_process,
    keccak256, _hash_step, _canonical, _score_to_level, MOCK_CHAIN_DATA,
)
from config import DOC_LAG_RISK_WEIGHT, HIGH_YIELD_THRESHOLD

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} -> {detail}")


# ---------------------------------------------------------------
# ① 已知向量：证明 keccak256 与以太坊一致
# ---------------------------------------------------------------
def test_keccak_known_vector():
    print("\n[1] keccak256 已知向量（与 ethers.js 一致的前提）")
    # keccak256("") 是以太坊公认固定值，任何实现都必须输出它
    expected = "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    actual = keccak256(b"").hex()
    check("keccak256(b'') == 以太坊已知值", actual == expected, f"got {actual}")
    check("返回 32 字节", len(keccak256(b"abc")) == 32)


# ---------------------------------------------------------------
# ①b canonical JSON：Python 与浏览器数字表示一致
# ---------------------------------------------------------------
def test_canonical_json_browser_compatibility():
    print("\n[1b] canonical JSON 浏览器数字兼容")
    payload = {
        "lockup_years": 2.0,
        "nested": [0.0, True, None, "2.0", {"negative": -3.0}],
        "ratio": 2.5,
    }
    expected = (
        '{"lockup_years":2,"nested":[0,true,null,"2.0",{"negative":-3}],'
        '"ratio":2.5}'
    )
    check("整数型浮点数与整数 canonical JSON 相同",
          _canonical({"value": 2.0}) == _canonical({"value": 2}))
    check("递归规范且不改变字符串/布尔/null/小数",
          _canonical(payload) == expected, _canonical(payload))
    check("整数与整数型浮点数产生相同 Ethereum keccak256",
          keccak256(_canonical({"value": 2.0}).encode("utf-8"))
          == keccak256(_canonical({"value": 2}).encode("utf-8")))
    check("跨端 canonical JSON 固定向量",
          keccak256(expected.encode("utf-8")).hex()
          == "ae69b1383574e561399317147549ebb6bdec10e6f5deebcade7893a0802ff8df")
    check("_canonical 不修改调用方对象",
          payload["lockup_years"] == 2.0 and payload["nested"][0] == 0.0)


# ---------------------------------------------------------------
# ② DocAgent：文档解析
# ---------------------------------------------------------------
def test_doc_agent():
    print("\n[2] DocAgent 文档解析")
    text = "团队持有 10% 代币，锁仓 2 年。已由 CertiK 完成安全审计。预计 APY 30%。"
    d = doc_agent(text)
    check("team_allocation_pct == 10", d["team_allocation_pct"] == 10, str(d))
    check("lockup_years == 2.0", d["lockup_years"] == 2.0, str(d))
    check("has_lockup_claim == True", d["has_lockup_claim"] is True)
    check("audit_claimed == True", d["audit_claimed"] is True)
    check("audit_firm == certik", d["audit_firm"] == "certik", str(d["audit_firm"]))
    check("high_yield_promise == True", d["high_yield_promise"] is True)
    check("yield_pct == 30", d["yield_pct"] == 30, str(d["yield_pct"]))

    d2 = doc_agent("")
    check("空文本不崩溃且无声明",
          d2["team_allocation_pct"] is None and d2["has_lockup_claim"] is False)

    check("收益阈值来自 config.py", HIGH_YIELD_THRESHOLD == 20, str(HIGH_YIELD_THRESHOLD))
    check("阈值以下不算高收益",
          doc_agent(f"团队 10%，APY {HIGH_YIELD_THRESHOLD - 1}%")["high_yield_promise"] is False)
    check("达到阈值算高收益",
          doc_agent(f"团队 10%，APY {HIGH_YIELD_THRESHOLD}%")["high_yield_promise"] is True)
    check("不承诺固定收益不算高收益", doc_agent("治理代币无收益承诺，不承诺固定收益")["high_yield_promise"] is False)
    check("锁仓 12 个月 == 1.0 年", doc_agent("锁仓 12 个月")["lockup_years"] == 1.0)
    check("英文关键词紧贴数字可提取", doc_agent("Team:10%; APR20%")["team_allocation_pct"] == 10)
    check("英文关键词紧贴数字可提取收益", doc_agent("Team:10%; APR20%")["yield_pct"] == 20)
    check("中英文混排可提取", doc_agent("团队 Team allocation=12%，年化APR:25%")["team_allocation_pct"] == 12)
    check("中英文混排可提取收益", doc_agent("团队 Team allocation=12%，年化APR:25%")["yield_pct"] == 25)


# ---------------------------------------------------------------
# ③ CrossCheckAgent：矛盾检测
# ---------------------------------------------------------------
def test_cross_check():
    print("\n[3] CrossCheckAgent 矛盾检测")
    doc = {"team_allocation_pct": 10, "has_lockup_claim": True, "lockup_years": 2.0,
           "audit_claimed": True, "audit_firm": "certik",
           "high_yield_promise": True, "yield_pct": 30}
    chain = {"team_wallet_pct": 82, "top_wallet_concentration_pct": 82,
             "has_timelock": False, "contract_verified": False}
    cs = cross_check_agent(doc, chain)
    cats = {c["category"] for c in cs}
    check("检测到 TOKENOMICS_MISMATCH", "TOKENOMICS_MISMATCH" in cats, str(cats))
    check("检测到 LOCKUP_VIOLATION", "LOCKUP_VIOLATION" in cats, str(cats))
    check("检测到 UNVERIFIED_CONTRACT", "UNVERIFIED_CONTRACT" in cats, str(cats))
    check("检测到 WALLET_CONCENTRATION", "WALLET_CONCENTRATION" in cats, str(cats))
    check("共 4 条矛盾", len(cs) == 4, f"got {len(cs)}")
    check("每条含 category/severity/title/description/evidence",
          all(all(k in c for k in ("category", "severity", "title", "description", "evidence"))
              for c in cs))

    # 合规场景：应 0 矛盾
    doc2 = {"team_allocation_pct": 10, "has_lockup_claim": True, "lockup_years": 1.0,
            "audit_claimed": True, "high_yield_promise": False}
    chain2 = {"team_wallet_pct": 12, "top_wallet_concentration_pct": 30,
              "has_timelock": True, "contract_verified": True}
    check("合规场景 0 矛盾", cross_check_agent(doc2, chain2) == [], str(cross_check_agent(doc2, chain2)))

    # 容忍阈值：差值 15pp 不触发，16pp 触发
    doc3 = {"team_allocation_pct": 10, "has_lockup_claim": False,
            "audit_claimed": False, "high_yield_promise": False}
    chain3 = {"team_wallet_pct": 25, "top_wallet_concentration_pct": 30,
              "has_timelock": True, "contract_verified": True}
    chain4 = {**chain3, "team_wallet_pct": 26}
    check("团队差值 15pp 不触发", cross_check_agent(doc3, chain3) == [])
    check("团队差值 16pp 触发", len(cross_check_agent(doc3, chain4)) == 1)

    # 成员1 NovaPay 演示扩展：补齐路演事实表中的高风险类别
    chain5 = {
        "team_wallet_pct": 82,
        "top_wallet_concentration_pct": 82,
        "has_timelock": False,
        "contract_verified": True,
        "liquidity_locked": False,
        "source_similarity_pct": 92,
        "audit_report_available": False,
        "abnormal_fund_flow": True,
        "demo_profile": "novapay_high_risk",
        "suppress_wallet_concentration": True,
    }
    cs5 = cross_check_agent(doc, chain5)
    cats5 = {c["category"] for c in cs5}
    for cat in ("TOKENOMICS_MISMATCH", "LIQUIDITY_UNLOCKED", "TIMELOCK_MISSING",
                "CODE_FORKED", "MISSING_AUDIT", "FUND_FLOW_ABNORMAL"):
        check(f"NovaPay 扩展检测到 {cat}", cat in cats5, str(cats5))

    # 成员1 AtlasIndex 演示扩展：好项目也给 LOW 小问题
    chain6 = {**chain2, "doc_progress_pct": 60, "chain_progress_pct": 75}
    cs6 = cross_check_agent(doc2, chain6)
    check("AtlasIndex 检测到 DOC_LAG", any(c["category"] == "DOC_LAG" for c in cs6), str(cs6))
    doc_lag = next(c for c in cs6 if c["category"] == "DOC_LAG")
    check("DOC_LAG 为低优先级配置分", doc_lag["risk_weight"] == DOC_LAG_RISK_WEIGHT == 2, str(doc_lag))


# ---------------------------------------------------------------
# ④ RiskAgent：打分与等级边界
# ---------------------------------------------------------------
def test_risk():
    print("\n[4] RiskAgent 打分与等级边界")
    check("29 -> LOW", _score_to_level(29) == "LOW")
    check("30 -> MEDIUM", _score_to_level(30) == "MEDIUM")
    check("59 -> MEDIUM", _score_to_level(59) == "MEDIUM")
    check("60 -> HIGH", _score_to_level(60) == "HIGH")
    check("89 -> HIGH", _score_to_level(89) == "HIGH")
    check("90 -> CRITICAL", _score_to_level(90) == "CRITICAL")

    r = risk_agent({"high_yield_promise": False}, {}, [])
    check("无矛盾 -> 0 分 LOW", r["risk_score"] == 0 and r["risk_level"] == "LOW", str(r))
    check("无矛盾时仍有默认依据", len(r["risk_reasons"]) >= 1)

    many = [{"severity": "CRITICAL", "title": "x", "description": "y"}] * 10
    r2 = risk_agent({"high_yield_promise": True, "yield_pct": 300}, {}, many)
    check("分数封顶 100", r2["risk_score"] == 100, str(r2["risk_score"]))


# ---------------------------------------------------------------
# ⑤ 集成：对齐分工.md 示例口径（85 / HIGH）
# ---------------------------------------------------------------
def test_run_agent_process():
    print("\n[5] run_agent_process 集成（对齐分工.md 示例 85/HIGH）")
    high = {
        "task_id": "task_demo_001",
        "whitepaper_text": "Project XYZ 白皮书：团队持有 10% 代币，锁仓 2 年。已由 CertiK 完成审计。APY 30%。",
        "chain_data": {"team_wallet_pct": 82, "top_wallet_concentration_pct": 82,
                       "has_timelock": False, "contract_verified": True},
    }
    r = run_agent_process(high)
    check("risk_score == 85", r["risk_score"] == 85, f"got {r['risk_score']}")
    check("risk_level == HIGH", r["risk_level"] == "HIGH", f"got {r['risk_level']}")
    check("contradictions 3 条", len(r["contradictions"]) == 3, f"got {len(r['contradictions'])}")
    check("reasoning_log 3 条", len(r["reasoning_log"]) == 3)
    check("step_index 0/1/2", [l["step_index"] for l in r["reasoning_log"]] == [0, 1, 2])
    check("step_hashes 0x 开头且 66 字符",
          all(h.startswith("0x") and len(h) == 66 for h in r["step_hashes"]), str(r["step_hashes"]))
    check("顶层字段齐全",
          all(k in r for k in ("task_id", "meta", "risk_score", "risk_level", "risk_reasons",
                               "contradictions", "reasoning_log", "step_hashes",
                               "doc_result", "chain_data_used", "disclaimer")))
    check("log_entry 字段对齐 SSE",
          all(all(k in l for k in ("agent", "current_step", "message",
                                   "timestamp", "step_index", "step_hash"))
              for l in r["reasoning_log"]))

    # 合规用例
    compliant = {
        "task_id": "task_demo_002",
        "whitepaper_text": "Project ABC：核心团队占比 10%，锁仓 12 个月。已通过 SlowMist 审计。无收益承诺。",
        "chain_data": {"team_wallet_pct": 12, "top_wallet_concentration_pct": 30,
                       "has_timelock": True, "contract_verified": True},
    }
    r2 = run_agent_process(compliant)
    check("合规用例 -> LOW", r2["risk_level"] == "LOW", f"got {r2['risk_level']} {r2['risk_score']}")

    # 成员1两套演示样例的目标口径
    novapay = {
        "task_id": "task_novapay_demo",
        "whitepaper_text": "NovaPay 白皮书：团队持有 10% 代币，锁仓 2 年。已由 CertiK 完成安全审计。预计 APY 30%，收益稳定。",
        "chain_data": {
            "team_wallet_pct": 82,
            "top_wallet_concentration_pct": 82,
            "has_timelock": False,
            "contract_verified": True,
            "liquidity_locked": False,
            "source_similarity_pct": 92,
            "audit_report_available": False,
            "abnormal_fund_flow": True,
            "demo_profile": "novapay_high_risk",
            "suppress_wallet_concentration": True,
        },
    }
    r3 = run_agent_process(novapay)
    check("NovaPay 扩展样例 -> 85/HIGH", r3["risk_score"] == 85 and r3["risk_level"] == "HIGH", str((r3["risk_score"], r3["risk_level"])))
    check("NovaPay 扩展样例 -> 6 findings", len(r3["contradictions"]) == 6, str(len(r3["contradictions"])))

    atlas = {
        "task_id": "task_atlas_demo",
        "whitepaper_text": "Atlas Index：团队 15%，锁仓 12 个月，链上 TimeLock 可查。已通过 SlowMist 审计。不承诺固定收益。",
        "chain_data": {
            "team_wallet_pct": 15,
            "top_wallet_concentration_pct": 30,
            "has_timelock": True,
            "contract_verified": True,
            "liquidity_locked": True,
            "audit_report_available": True,
            "abnormal_fund_flow": False,
            "doc_progress_pct": 60,
            "chain_progress_pct": 75,
        },
    }
    r4 = run_agent_process(atlas)
    check("AtlasIndex 扩展样例 -> 2/LOW", r4["risk_score"] == 2 and r4["risk_level"] == "LOW", str((r4["risk_score"], r4["risk_level"])))


# ---------------------------------------------------------------
# ⑥ 哈希链自洽 + 篡改可检测（可验证卖点）
# ---------------------------------------------------------------
def test_hash_chain():
    print("\n[6] step_hash 哈希链自洽与篡改检测")
    payload = {
        "task_id": "task_hash_001",
        "whitepaper_text": "团队持有 10% 代币。",
        "chain_data": {"team_wallet_pct": 10, "top_wallet_concentration_pct": 30,
                       "has_timelock": True, "contract_verified": True},
    }
    r1 = run_agent_process(dict(payload))
    r2 = run_agent_process(dict(payload, whitepaper_text="团队持有 90% 代币。"))
    check("篡改一个字后 step_hashes 全部变化", r1["step_hashes"] != r2["step_hashes"])

    # 按公式 H_i = keccak256(H_{i-1} || content_i || ts_i) 重算验证
    prev = "0x" + "0" * 64
    ok = True
    for l in r1["reasoning_log"]:
        content = _canonical(l["output"]) + "|" + l["message"]
        if _hash_step(prev, content, l["timestamp"]) != l["step_hash"]:
            ok = False
            break
        prev = l["step_hash"]
    check("按公式重算哈希链自洽", ok)


# ---------------------------------------------------------------
# ⑦ 兜底与异常：空输入、缺字段
# ---------------------------------------------------------------
def test_fallback():
    print("\n[7] Mock 兜底与异常输入")
    r = run_agent_process({"task_id": "t1", "whitepaper_text": ""})
    check("chain_data 缺省用 MOCK", r["chain_data_used"] == MOCK_CHAIN_DATA)

    check("task_id 缺省 -> task_unknown",
          run_agent_process({"whitepaper_text": "x"})["task_id"] == "task_unknown")

    r3 = run_agent_process({})
    check("完全空输入不崩溃", r3["risk_score"] >= 0
          and r3["risk_level"] in ("LOW", "MEDIUM", "HIGH", "CRITICAL"))

    # P1-1 回归：存在 CRITICAL 矛盾时等级不应是 LOW（修复 risk_agent 后应 PASS）
    r5 = run_agent_process({"task_id": "t5", "whitepaper_text": "",
                            "chain_data": dict(MOCK_CHAIN_DATA)})
    has_critical = any(c["severity"] == "CRITICAL" for c in r5["contradictions"])
    check("存在 CRITICAL 矛盾时等级 >= MEDIUM",
          not has_critical or r5["risk_level"] != "LOW",
          f"has_critical={has_critical}, level={r5['risk_level']}, score={r5['risk_score']}")


if __name__ == "__main__":
    test_keccak_known_vector()
    test_canonical_json_browser_compatibility()
    test_doc_agent()
    test_cross_check()
    test_risk()
    test_run_agent_process()
    test_hash_chain()
    test_fallback()
    print("\n" + "=" * 60)
    print(f"TOTAL: {PASS} PASS, {FAIL} FAIL")
    if FAIL == 0:
        print("结论：✔ 全部通过，成员3部分可以交付成员4联调")
        raise SystemExit(0)
    else:
        print("结论：✘ 存在问题，对照上一轮 P0/P1 清单修复后再跑")
        raise SystemExit(1)
