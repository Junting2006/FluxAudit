# -*- coding: utf-8 -*-
"""
ChainAgent / onchain 自测：默认 Mock，真实路径无 Key 自动降级
运行：python tests/test_chain_agent.py
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("USE_MOCK_DATA", "true")

from chain_agent import ChainAgent
from onchain import get_token_holders

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} -> {detail}")


def test_mock():
    print("\n[1] 默认 Mock 链上数据")
    a = ChainAgent(use_mock=True)
    addr = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F"
    d = a.fetch(addr)
    for k in (
        "team_wallet_pct", "top_wallet_concentration_pct", "has_timelock",
        "contract_verified", "liquidity_locked", "source_similarity_pct",
        "audit_report_available", "abnormal_fund_flow",
    ):
        check(f"含字段 {k}", k in d, str(d))
    check("NovaPay 固定为高风险演示 profile",
          d.get("demo_profile") == "novapay_high_risk", str(d))
    check("默认标注 _mock", d.get("_mock") is True)
    check("Mock 来源逐字段标注", all(v == "mock" for v in d.get("provenance", {}).values()))
    d2 = a.fetch(addr)
    check("同地址结果可复现", d == d2)
    d3 = a.fetch("0x0000000000000000000000000000000000000001")
    check("不同地址结果不同", d != d3)


def test_real_fallback():
    print("\n[2] 真实路径无 Key -> 自动降级 Mock")
    a = ChainAgent(use_mock=False, api_key="")
    d = a.fetch("0x71C7656EC7ab88b098defB751B7401B5f6d8976F")
    for k in ("team_wallet_pct", "top_wallet_concentration_pct", "has_timelock", "contract_verified"):
        check(f"降级后含字段 {k}", k in d)
    check("无 Key 降级明确标注", d.get("_mock") is True and d.get("_mode") == "mock")
    check("ChainAgent 状态明确为 mock", a.status() == "mock", a.status())


def test_member1_known_cases():
    print("\n[3] 成员1 NovaPay / AtlasIndex 固定样例")
    a = ChainAgent(use_mock=True)
    nova = a.fetch("0x71C7656EC7ab88b098defB751B7401B5f6d8976F")
    atlas = a.fetch("0xA2b8C9d4E7f1029384756A1B2C3D4E5F60718293")
    check("NovaPay team_wallet_pct=82", nova.get("team_wallet_pct") == 82, str(nova))
    check("NovaPay liquidity_locked=False", nova.get("liquidity_locked") is False, str(nova))
    check("AtlasIndex team_wallet_pct=15", atlas.get("team_wallet_pct") == 15, str(atlas))
    check("AtlasIndex has_timelock=True", atlas.get("has_timelock") is True, str(atlas))
    check("AtlasIndex 含文档滞后输入",
          atlas.get("doc_progress_pct") == 60 and atlas.get("chain_progress_pct") == 75,
          str(atlas))


def test_holder_lookup_placeholder():
    print("\n[4] 持币榜单接口占位行为")
    check("非空地址返回空列表",
          get_token_holders("0x71C7656EC7ab88b098defB751B7401B5f6d8976F", "") == [])
    try:
        get_token_holders("", "")
    except ValueError as exc:
        check("空地址抛出明确 ValueError", "non-empty token contract address" in str(exc), str(exc))
    else:
        check("空地址应抛出 ValueError", False)


if __name__ == "__main__":
    test_mock()
    test_real_fallback()
    test_member1_known_cases()
    test_holder_lookup_placeholder()
    print("\n" + "=" * 60)
    print(f"TOTAL: {PASS} PASS, {FAIL} FAIL")
    raise SystemExit(0 if FAIL == 0 else 1)
