# FluxAudit Agent Process

成员 3 交付物：`DocAgent -> CrossCheckAgent -> RiskAgent`。

## 运行

```powershell
python -m pip install -r .\requirements.txt
python .\agent_process.py
```

默认走本地规则引擎，无需 LLM Key。需要 DeepSeek DocAgent 时：

```powershell
$env:DEEPSEEK_API_KEY="你的 DeepSeek API Key"
$env:USE_LLM="true"
python .\agent_process.py
```

常用可调参数位于 `config.py`，也可用环境变量覆盖：

```powershell
$env:HIGH_YIELD_THRESHOLD="25"  # 高收益识别阈值，默认 20
$env:LLM_TIMEOUT_SECONDS="15"   # 单次 LLM 调用时限，默认 15 秒
$env:LLM_MAX_RETRIES="0"        # 额外重试次数，默认 0，失败立即走规则兜底
```

也可以按单个任务打开 LLM，不需要重启后端：

```python
result = run_agent_process({
    "task_id": "task_demo_001",
    "use_llm": True,
    "whitepaper_text": "...",
    "chain_data": {...},
})
```

## 成员 4 调用契约

```python
from agent_process import run_agent_process

result = run_agent_process({
    "task_id": "task_demo_001",
    "whitepaper_text": "Project XYZ 白皮书 v1.0：团队持有 10% 代币，锁仓 2 年。已由 CertiK 完成安全审计。预计 APY 30%，收益稳定。",
    "chain_data": {
        "team_wallet_pct": 82,
        "top_wallet_concentration_pct": 82,
        "has_timelock": False,
        "contract_verified": False,
        "liquidity_locked": False,
        "source_similarity_pct": 92,
        "audit_report_available": False,
        "abnormal_fund_flow": True,
    },
})
```

`chain_data` 的基础字段必须有 `team_wallet_pct / top_wallet_concentration_pct / has_timelock / contract_verified`。如果成员4能提供更多链上信号，成员3还会识别这些扩展字段：

| 扩展字段 | 触发 finding |
| --- | --- |
| `liquidity_locked=False` | `LIQUIDITY_UNLOCKED` |
| `source_similarity_pct>=85` | `CODE_FORKED` |
| `audit_report_available=False` | `MISSING_AUDIT` |
| `abnormal_fund_flow=True` | `FUND_FLOW_ABNORMAL` |
| `doc_progress_pct` + `chain_progress_pct` 差距 >= 10 | `DOC_LAG` |
| `demo_profile="novapay_high_risk"` | 对齐成员1 NovaPay 演示口径，避免重复计入钱包集中度 |

核心输出字段：

| 字段 | 用途 |
| --- | --- |
| `risk_score` | 映射到 `summary.overall_risk_score` |
| `risk_level` | 映射到 `summary.risk_level` |
| `risk_reasons` | 可合并成 `summary.verdict` |
| `contradictions` | 可直接映射到 `findings` |
| `reasoning_log` | SSE `/api/v1/audit/stream/:task_id` 逐条推送 |
| `step_hashes` | 映射到 `proof_data.reasoning_step_hashes` |
| `current_step` | 当前最终状态，默认为 `RISK_SCORING` |
| `meta.fallback_reason` | LLM 不可用时记录自动降级原因 |

成员1演示样例目前对齐为：NovaPay 输出 `85 / HIGH / 6 findings`，AtlasIndex 输出 `2 / LOW / 1 finding`。DOC_LAG 是低优先级提示，默认仅计 2 分。

## DeepSeek 设计约束

DeepSeek 只做 DocAgent 文档解析。`CrossCheckAgent` 和 `RiskAgent` 始终走确定性规则引擎，避免链上硬指标漏报，并保证可解释、可复核。

## step_hash 口径

Python 端强制使用 `pycryptodome` 的以太坊 `keccak256`，不做 SHA3 静默降级。

哈希链规则：

```text
H(-1) = 0x0000000000000000000000000000000000000000000000000000000000000000
content_i = canonical_json(step_output_i) + "|" + message_i
timestamp_i = Unix timestamp in milliseconds
H_i = keccak256(H_(i-1) + "|" + content_i + "|" + timestamp_i)
```

canonical JSON 规则：

```python
normalized = recursively_convert_integral_float_to_int(obj)  # 2.0 -> 2
json.dumps(normalized, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
```

数字规范化只转换整数型浮点数，包括嵌套对象和数组；字符串、布尔值、`null` 与非整数小数不变。这样 Python 端的 `lockup_years: 2.0` 与浏览器解析后重序列化的 `lockup_years: 2` 会产生相同哈希。

成员 5 对照测试：

```text
keccak256("fluxaudit-test") = 0xcce8555ed74ef8887a1250c7048b9910d0e5fdd755836f4ffe4f4059a7fef103
```

## 合规提醒

如启用 DeepSeek，`whitepaper_text` 会发送到第三方 LLM API。演示数据必须限定为公开、合成或已脱敏数据，并在提交材料中披露云端依赖、Mock/Fallback 使用情况和数据出境口径。
