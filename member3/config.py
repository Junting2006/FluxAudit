"""成员3 Agent 的可调参数。

这些值可用环境变量覆盖，便于不同演示或部署环境调整，无需修改算法代码。
"""

import os


def _int_env(name: str, default: int, minimum: int = 0) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except ValueError:
        return default


def _float_env(name: str, default: float, minimum: float = 0.0) -> float:
    try:
        return max(minimum, float(os.getenv(name, str(default))))
    except ValueError:
        return default


# 文档收益率达到该百分比时，视为高收益承诺。
HIGH_YIELD_THRESHOLD = _int_env("HIGH_YIELD_THRESHOLD", 20)

# LLM 仅用于文档结构化。15 秒内失败时立即交由规则引擎继续处理。
LLM_TIMEOUT_SECONDS = _int_env("LLM_TIMEOUT_SECONDS", 15, minimum=1)
LLM_MAX_RETRIES = _int_env("LLM_MAX_RETRIES", 0)
LLM_RETRY_BACKOFF_SECONDS = _float_env("LLM_RETRY_BACKOFF_SECONDS", 1.0)

# 文档进度与链上开发进度不一致仅作低优先级提示。
DOC_LAG_RISK_WEIGHT = _int_env("DOC_LAG_RISK_WEIGHT", 2)
