"""
FluxAudit（流审）· 成员4 链上数据抓取（Etherscan / Alchemy）
=================================================================
真实数据抓取 + 自动降级到 Mock。

说明（诚实边界，避免现场依赖付费 API 导致 Demo 卡顿）：
- 合约是否开源验证（contract_verified）与源码（用于 TimeLock 启发式判断）来自
  Etherscan getsourcecode（免费接口），有 API Key 时真实拉取，否则 Mock。
- 持币分布（team_wallet_pct / top_wallet_concentration_pct）依赖 Etherscan 付费的
  token holder 接口或 Alchemy；本交付物默认以确定性 Mock 生成（标注为合成数据）。
  若队伍有付费 Key，可在此扩展 get_token_holders 真实拉取。
"""

import re

from hashing import keccak256_hex

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None


ETHERSCAN_BASE = {
    1: "https://api.etherscan.io/api",
    11155111: "https://api-sepolia.etherscan.io/api",
}

# 默认合成（Mock）链上数据，与成员3 MOCK_CHAIN_DATA 对齐
MOCK_CHAIN_DATA = {
    "team_wallet_pct": 82,
    "top_wallet_concentration_pct": 82,
    "has_timelock": False,
    "contract_verified": True,
    "liquidity_locked": False,
    "source_similarity_pct": 92,
    "audit_report_available": False,
    "abnormal_fund_flow": True,
    "demo_profile": "novapay_high_risk",
}

# 成员1交付的两套答辩样例。地址只用于选择确定性合成数据，不能视为真实链上事实。
KNOWN_DEMO_PROFILES = {
    "0x71c7656ec7ab88b098defb751b7401b5f6d8976f": {
        "team_wallet_pct": 82,
        "top_wallet_concentration_pct": 82,
        "liquidity_locked": False,
        "source_similarity_pct": 92,
        "audit_report_available": False,
        "abnormal_fund_flow": True,
        "lp_owner": "deployer 0x4f3b...",
        "fund_flow_target": "exchange_hot_wallet",
        "demo_profile": "novapay_high_risk",
        "suppress_wallet_concentration": True,
    },
    "0xa2b8c9d4e7f1029384756a1b2c3d4e5f60718293": {
        "team_wallet_pct": 15,
        "top_wallet_concentration_pct": 30,
        "liquidity_locked": True,
        "source_similarity_pct": 12,
        "audit_report_available": True,
        "abnormal_fund_flow": False,
        "doc_progress_pct": 60,
        "chain_progress_pct": 75,
        "demo_profile": "atlas_low_risk",
    },
}

# TimeLock / 锁仓的源码启发式关键词
TIMELOCK_PATTERNS = re.compile(
    r"timelock|timelocker|vesting|lockup|lock\s*\(|unlock|release\s*\(|cliff",
    re.IGNORECASE,
)


def _get_json(url: str, params: dict, timeout: int = 10):
    if requests is None:
        raise RuntimeError("requests 未安装，请 pip install requests")
    resp = requests.get(url, params=params, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def get_contract_source(address: str, api_key: str, chain_id: int = 11155111) -> dict:
    """返回 {contract_verified, source, name}。无 Key 时抛错触发降级。"""
    if not api_key:
        raise RuntimeError("缺少 ETHERSCAN_API_KEY")
    base = ETHERSCAN_BASE.get(chain_id, ETHERSCAN_BASE[11155111])
    data = _get_json(base, {
        "module": "contract",
        "action": "getsourcecode",
        "address": address,
        "apikey": api_key,
    })
    result = (data.get("result") or [{}])[0]
    source = result.get("SourceCode") or ""
    verified = bool(source) and result.get("ABI") not in (
        None, "Contract source code not verified", ""
    )
    return {
        "contract_verified": bool(verified),
        "source": source,
        "name": result.get("ContractName", ""),
    }


def detect_timelock(source: str) -> bool:
    """源码中出现 TimeLock / 锁仓 / vesting 等关键词即认为存在时间锁约束。"""
    if not source:
        return False
    return bool(TIMELOCK_PATTERNS.search(source))


def mock_holder_stats(address: str) -> dict:
    """
    确定性 Mock 持币分布：由地址哈希派生伪随机数，保证同一地址结果可复现，
    不同地址给出不同但合理的数值。明确标注为合成数据。
    """
    normalized = (address or "0x0").lower()
    if normalized in KNOWN_DEMO_PROFILES:
        return dict(KNOWN_DEMO_PROFILES[normalized])

    digest = keccak256_hex(normalized.encode("utf-8"))[2:]
    seed = int(digest[:8], 16)
    team_pct = 5 + (seed % 90)                       # 5 ~ 94
    top_pct = max(team_pct, 10 + ((seed >> 8) % 85))  # 10 ~ 94
    return {
        "team_wallet_pct": team_pct,
        "top_wallet_concentration_pct": min(99, top_pct),
        "liquidity_locked": top_pct < 70,
        "source_similarity_pct": seed % 70,
        "audit_report_available": True,
        "abnormal_fund_flow": False,
    }


def get_token_holders(address: str, api_key: str, chain_id: int = 11155111):
    """
    持币榜单接口预留。

    当前版本尚未接入付费 holder API。有效地址返回空列表，表示暂未获得
    持有人明细；调用方仍可明确切换到确定性 Mock，而不是把占位异常误报为
    网络失败。地址缺失时给出可诊断的输入错误。
    """
    if not isinstance(address, str) or not address.strip():
        raise ValueError(
            "token holder lookup requires a non-empty token contract address; "
            "holder API is not configured."
        )
    return []


def fetch_chain_data(contract_address: str, chain_id: int = 11155111,
                     api_key: str = "", use_mock: bool = False) -> dict:
    """
    组合链上数据，输出成员3 所需的 chain_data 字典：
        {team_wallet_pct, top_wallet_concentration_pct, has_timelock, contract_verified}
    任何异常（无 Key / 超时 / 限流）都会自动降级为确定性 Mock，保证 Demo 不卡顿。
    """
    # Mock 模式（USE_MOCK_DATA=true 或无 Key）：用确定性 Mock 分布
    if use_mock or not api_key:
        stats = mock_holder_stats(contract_address or "0x0")
        is_atlas = (
            (contract_address or "").lower()
            == "0xa2b8c9d4e7f1029384756a1b2c3d4e5f60718293"
        )
        return {
            **stats,
            "has_timelock": is_atlas,
            "contract_verified": True,
            "_mock": True,
            "_mode": "mock",
            "provenance": {key: "mock" for key in (*stats, "has_timelock", "contract_verified")},
        }

    try:
        src = get_contract_source(contract_address, api_key, chain_id)
        verified = src["contract_verified"]
        timelock = detect_timelock(src["source"]) if verified else False
        # 持币分布：付费接口暂不可用时仍走 Mock，但标注真实合约验证状态
        stats = mock_holder_stats(contract_address)
        return {
            **stats,
            "has_timelock": timelock,
            "contract_verified": verified,
            "_mock": True,
            "_mode": "hybrid",
            "provenance": {
                **{key: "mock" for key in stats},
                "has_timelock": "etherscan",
                "contract_verified": "etherscan",
            },
        }
    except Exception:
        stats = mock_holder_stats(contract_address or "0x0")
        return {
            **stats,
            "has_timelock": False,
            "contract_verified": True,
            "_mock": True,
            "_mode": "fallback",
            "provenance": {key: "mock" for key in (*stats, "has_timelock", "contract_verified")},
        }
