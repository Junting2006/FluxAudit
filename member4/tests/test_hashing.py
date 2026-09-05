# -*- coding: utf-8 -*-
"""
成员4 哈希模块自测：已知向量 + 链式自洽 + Merkle + 篡改检测
运行：python tests/test_hashing.py
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from hashing import (
    keccak256, keccak256_hex, canonical_json, hash_step, merkle_root,
    compute_report_hash, verify_step, ZERO_HASH, HASH_ALGORITHM, HASH_VERSION,
)

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} -> {detail}")


def test_known_vectors():
    print("\n[1] Ethereum keccak256 已知向量")
    check("keccak256('') == 以太坊公认值",
          keccak256(b"").hex() == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470")
    check("keccak256('fluxaudit-test') == README 向量",
          keccak256_hex(b"fluxaudit-test") == "0xcce8555ed74ef8887a1250c7048b9910d0e5fdd755836f4ffe4f4059a7fef103")
    check("返回 32 字节", len(keccak256(b"abc")) == 32)


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
          canonical_json({"value": 2.0}) == canonical_json({"value": 2}))
    check("递归规范且不改变字符串/布尔/null/小数",
          canonical_json(payload) == expected, canonical_json(payload))
    check("整数与整数型浮点数产生相同 Ethereum keccak256",
          keccak256_hex(canonical_json({"value": 2.0}).encode("utf-8"))
          == keccak256_hex(canonical_json({"value": 2}).encode("utf-8")))
    check("跨端 canonical JSON 固定向量",
          keccak256_hex(expected.encode("utf-8"))
          == "0xae69b1383574e561399317147549ebb6bdec10e6f5deebcade7893a0802ff8df")
    check("canonical_json 不修改调用方对象",
          payload["lockup_years"] == 2.0 and payload["nested"][0] == 0.0)


def test_hash_chain():
    print("\n[2] 连续哈希链自洽")
    prev = ZERO_HASH
    chain = []
    for i in range(3):
        h = hash_step(prev, f"step{i}", 1000 + i)
        chain.append(h)
        prev = h
        check(f"step{i} 以 0x 开头且 66 字符", h.startswith("0x") and len(h) == 66)
    # 重算自洽
    prev = ZERO_HASH
    ok = True
    for i in range(3):
        if hash_step(prev, f"step{i}", 1000 + i) != chain[i]:
            ok = False
            break
        prev = chain[i]
    check("按公式重算自洽", ok)
    check("固定 step0 向量",
          chain[0] == "0xe42068d3220a57e046d1b1ed228caecc8ee3380d36d3b5cf79a2ad14a43c144f")
    check("verify_step 验证固定向量",
          verify_step(ZERO_HASH, "step0", 1000, chain[0]))
    # 篡改检测：改一步内容，后续哈希全部变化
    tampered = hash_step(ZERO_HASH, "step0-modified", 1000)
    check("篡改内容后哈希变化", tampered != chain[0])


def test_merkle():
    print("\n[3] Merkle Root 确定性")
    leaves = [keccak256_hex(f"h{i}".encode()) for i in range(4)]
    r1 = merkle_root(leaves)
    r2 = merkle_root(leaves)
    check("相同输入 -> 相同 root", r1 == r2)
    check("root 为 0x 66 字符", r1.startswith("0x") and len(r1) == 66)
    r3 = merkle_root(leaves[:-1] + [keccak256_hex(b"hx")])
    check("改动一个叶子 -> root 变化", r3 != r1)
    check("奇数叶子也能计算", merkle_root([leaves[0]]).startswith("0x"))

    vector_hashes = [
        "0xe42068d3220a57e046d1b1ed228caecc8ee3380d36d3b5cf79a2ad14a43c144f",
        "0x19af4ab6f5cc2955a49df1793f56ec5215c92939b4c4e191980e40fa3c40730f",
        "0xbcfac94687060b6108d801a0c9aceb205dc5c9670bdf1c711bf5d9c46b0e25a8",
    ]
    check("单步骤固定 root",
          merkle_root(vector_hashes[:1]) == "0xc8a222989ed17d1216447ec1d713a3da0f57ddd28ee1aeb9ee75d3b6b41211bf")
    check("双步骤固定 root",
          merkle_root(vector_hashes[:2]) == "0x648e69aec6e40d83f9b9f961503814d9e320a7c37321dcf8fd88348699dc4beb")
    check("奇数步骤固定 root",
          merkle_root(vector_hashes) == "0xb49ba32f5172c6f383ced7bfc7dc1ffc847db1427b3807121a975876a7a2d09a")


def test_report_hash():
    print("\n[4] report_hash 与篡改检测")
    report = {"task_id": "t", "summary": {"overall_risk_score": 85}, "findings": [],
              "proof_data": {"merkle_root": "0xabc", "report_hash": ""}, "disclaimer": "x"}
    h1 = compute_report_hash(report)
    report2 = dict(report)
    report2["summary"] = {"overall_risk_score": 10}
    h2 = compute_report_hash(report2)
    check("篡改 summary -> report_hash 变化", h1 != h2)
    check("report_hash 为 0x 66 字符", h1.startswith("0x") and len(h1) == 66)
    # 证明数据必须受保护；只有自引用 report_hash 字段被排除。
    report3 = dict(report)
    report3["proof_data"] = {"merkle_root": "0xdef", "report_hash": ""}
    check("改 merkle_root -> report_hash 变化", compute_report_hash(report3) != h1)
    report4 = dict(report)
    report4["proof_data"] = {"merkle_root": "0xabc", "report_hash": "0xchanged"}
    check("仅改自引用 report_hash -> 重算结果不变", compute_report_hash(report4) == h1)
    check("哈希协议标识固定",
          HASH_ALGORITHM == "ethereum-keccak256" and HASH_VERSION == "keccak-v1")


if __name__ == "__main__":
    test_known_vectors()
    test_canonical_json_browser_compatibility()
    test_hash_chain()
    test_merkle()
    test_report_hash()
    print("\n" + "=" * 60)
    print(f"TOTAL: {PASS} PASS, {FAIL} FAIL")
    raise SystemExit(0 if FAIL == 0 else 1)
