"""
FluxAudit（流审）· 成员4 ChainAgent
=================================================================
封装 onchain.fetch_chain_data，输出成员3 所需的 chain_data，
并生成可解释的中文摘要（供 SSE 推演日志展示）。
"""

from config import USE_MOCK_DATA, ETHERSCAN_API_KEY, DEFAULT_CHAIN_ID
from onchain import fetch_chain_data


class ChainAgent:
    def __init__(self, use_mock: bool = None, api_key: str = None, chain_id: int = None):
        self.use_mock = USE_MOCK_DATA if use_mock is None else use_mock
        self.api_key = ETHERSCAN_API_KEY if api_key is None else api_key
        self.chain_id = DEFAULT_CHAIN_ID if chain_id is None else chain_id

    def fetch(self, contract_address: str, chain_id: int = None) -> dict:
        cid = chain_id or self.chain_id
        return fetch_chain_data(
            contract_address or "",
            chain_id=cid,
            api_key=self.api_key,
            use_mock=self.use_mock,
        )

    def status(self) -> str:
        """返回当前配置路径，供健康检查和演示界面诚实展示。"""
        return "mock" if self.use_mock or not self.api_key else "real"

    def summarize(self, data: dict) -> str:
        return (
            f"团队钱包 {data.get('team_wallet_pct')}%，"
            f"头部集中度 {data.get('top_wallet_concentration_pct')}%，"
            f"Timelock={data.get('has_timelock')}，"
            f"合约已验证={data.get('contract_verified')}"
            + ({
                "mock": "（合成数据）",
                "hybrid": "（部分真实 / 部分合成）",
                "fallback": "（接口降级为合成数据）",
            }.get(data.get("_mode"), ""))
        )
