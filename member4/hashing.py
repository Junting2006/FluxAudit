"""
FluxAudit（流审）· 成员4 哈希核心模块（全队唯一哈希口径）
=================================================================
【强制约定（来自成员3）】
1. 哈希函数必须是 Ethereum keccak256（以太坊原生，非 FIPS SHA3-256）。
2. 每一个推理 / 编排步骤都必须产生一个 step_hash，形成连续哈希链。

本模块是成员3 / 成员4 / 成员5 三方共享的"唯一真相"哈希库：
- 成员3 的 agent_process.py 内部使用完全相同的 pycryptodome keccak256 + 链式规则；
- 成员4 的后端编排步骤、Merkle Root、report_hash 全部复用本模块；
- 成员5 的 JS / ethers 端需用 ethers.keccak256 复现同一结果（已知向量见测试）。

已知向量（任何实现都必须输出它们，否则三端口径不一致）：
  keccak256("")                 = 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
  keccak256("fluxaudit-test")   = 0xcce8555ed74ef8887a1250c7048b9910d0e5fdd755836f4ffe4f4059a7fef103
"""

import copy
import json
import time

try:
    from Crypto.Hash import keccak

    def keccak256(data: bytes) -> bytes:
        k = keccak.new(digest_bits=256)
        k.update(data)
        return k.digest()

except ImportError as exc:  # pragma: no cover
    raise RuntimeError(
        "FluxAudit 需要 pycryptodome 以生成与 ethers.js 一致的 Ethereum keccak256，"
        "请执行: pip install pycryptodome"
    ) from exc


# 哈希链起点：H_(-1) = 0x000...0
ZERO_HASH = "0x" + "0" * 64
HASH_ALGORITHM = "ethereum-keccak256"
HASH_VERSION = "keccak-v1"


def keccak256_hex(data: bytes) -> str:
    """返回 0x 前缀的 64 字符十六进制字符串。"""
    return "0x" + keccak256(data).hex()


def _normalize_integral_floats(obj):
    """递归把 2.0 规范成 2，以匹配浏览器 JSON.parse/Stringify。"""
    if isinstance(obj, float) and obj.is_integer():
        return int(obj)
    if isinstance(obj, dict):
        return {key: _normalize_integral_floats(value) for key, value in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_normalize_integral_floats(value) for value in obj]
    return obj


def canonical_json(obj) -> str:
    """keccak-v1 JSON：排序键、紧凑 UTF-8，并统一整数型浮点数。"""
    normalized = _normalize_integral_floats(obj)
    return json.dumps(normalized, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def now_ms() -> int:
    return int(time.time() * 1000)


def hash_step(prev_hash: str, content: str, timestamp_ms: int) -> str:
    """
    连续哈希链规则（成员3 / 成员4 共用）：
        H_i = keccak256(H_{i-1} || "|" || content_i || "|" || timestamp_ms_i)
    其中 content_i 通常为 canonical_json(step_output) 拼接 step message。
    """
    payload = f"{prev_hash}|{content}|{timestamp_ms}".encode("utf-8")
    return keccak256_hex(payload)


def verify_step(prev_hash: str, content: str, timestamp_ms: int,
                expected_hash: str) -> bool:
    """按 keccak-v1 重算单步哈希。"""
    return hash_step(prev_hash, content, timestamp_ms) == expected_hash


def merkle_root(hashes_hex: list) -> str:
    """
    由一组 step_hash（0x... 字符串）构建 Merkle Tree，返回 32 字节 keccak256 root。
    算法（成员2 / 成员5 需用 ethers.keccak256 复现）：
      - 叶子 = keccak256(hex_string.encode("utf-8"))
      - 自下而上两两 keccak256(left || right)；奇数层复制最后一个节点。
    """
    if not hashes_hex:
        return ZERO_HASH
    level = [keccak256(h.encode("utf-8")) for h in hashes_hex]
    while len(level) > 1:
        if len(level) % 2 == 1:
            level.append(level[-1])
        level = [
            keccak256(level[i] + level[i + 1])
            for i in range(0, len(level), 2)
        ]
    return "0x" + level[0].hex()


def compute_report_hash(report: dict) -> str:
    """
    报告全文哈希：仅排除自引用的 proof_data.report_hash，再做 keccak256。
    steps、step_hashes、merkle_root 与哈希版本均受 report_hash 保护。
    """
    body = copy.deepcopy(report)
    proof_data = body.get("proof_data")
    if isinstance(proof_data, dict):
        proof_data.pop("report_hash", None)
    return keccak256_hex(canonical_json(body).encode("utf-8"))
