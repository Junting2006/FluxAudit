"""
FluxAudit（流审）· 成员4 全局配置
=================================================================
角色：后端与链上数据工程师 / 总集成与技术负责人（分工.md 第四、七节）

本文件只放"环境相关、可覆盖"的配置。哈希口径、链上抓取、报告组装均不在此处。
"""

import os

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:  # pragma: no cover - 仍可由 shell 注入环境变量
    pass

# 全局兜底开关（分工.md：USE_MOCK_DATA = true 时自动切入静态 JSON 数据源）
USE_MOCK_DATA = os.getenv("USE_MOCK_DATA", "true").lower() in ("1", "true", "yes", "y")

# 是否默认走成员3 的 LLM（按任务可覆盖）。成员4 不强制，交由成员3 控制。
DEFAULT_USE_LLM = os.getenv("USE_LLM", "false").lower() in ("1", "true", "yes", "y")

# 链上数据源
DEFAULT_CHAIN_ID = int(os.getenv("CHAIN_ID", "11155111"))  # Sepolia 测试网
ETHERSCAN_API_KEY = os.getenv("ETHERSCAN_API_KEY", "")
ALCHEMY_API_KEY = os.getenv("ALCHEMY_API_KEY", "")
ALCHEMY_RPC_URL = os.getenv("ALCHEMY_RPC_URL", "")  # 形如 https://eth-sepolia.g.alchemy.com/v2/<key>

# 成员3 模块路径（指向 member3/agent_process.py）。可用环境变量 MEMBER3_PATH 覆盖。
MEMBER3_PATH = os.getenv("MEMBER3_PATH", "")

# 浏览器联调来源，使用逗号分隔。生产环境应配置为实际前端域名。
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]

# 模型版本号（映射到报告 meta.model_version）
MODEL_VERSION = os.getenv("MODEL_VERSION", "FluxAudit-Backend-v1")

# 数据来源声明（写入报告 meta.data_sources）
DATA_SOURCES_REAL = ["Sepolia RPC", "Whitepaper", "Etherscan API"]
DATA_SOURCES_MOCK = ["Mock Chain Data", "Whitepaper", "Rule Engine"]

# 免责声明（必须和成员1 / 成员3 完全一致）
DISCLAIMER = "本报告由 FluxAudit 辅助诊断生成，基于测试与公开数据，不构成财务投资建议。"
