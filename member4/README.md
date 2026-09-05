# FluxAudit（流审）· 成员4 交付物

> **角色**：后端与链上数据工程师 / 总集成与技术负责人（分工.md 第四、七节）
> **赛道**：C — 可验证的 AI 推理审计工具 / 尽调助手
> **技术栈**：Python · FastAPI · pycryptodome（Ethereum keccak256）· Etherscan / Alchemy RPC

---

## 0. 一句话交付

一条命令启动的后端服务，打通 **`POST /start` → SSE 推演流 → `GET /report`** 闭环；
负责 **ChainAgent 链上数据抓取**、**Mock 兜底防 AI 超时**，并在 **每一步都生成 Ethereum keccak256 哈希**，
向成员5 交付 `merkle_root` + `report_hash` 上链锚定，向成员2 交付 SSE 流与报告 schema。

---

## 1. 哈希强制约定（keccak-v1）

> **警告**：哈希函数必须是 **Ethereum keccak256**（以太坊原生，非 FIPS SHA3-256）。
> 每一个推理 / 编排步骤都必须产生一个 `step_hash`，形成一条连续哈希链。

- 实现：`hashing.py` 使用 `pycryptodome` 的 `Crypto.Hash.keccak(digest_bits=256)`。
- 成员4按最终事件顺序统一重算整条证明链，避免成员3的内部哈希从零重新起链。
- `hash_vectors.json` 提供单步骤、双步骤与奇数步骤固定向量，成员2/5必须逐字节通过。

### 连续哈希链规则

```text
H_(-1) = 0x0000000000000000000000000000000000000000000000000000000000000000
H_i    = keccak256(UTF8(H_(i-1) + "|" + hash_content_i + "|" + timestamp_ms_i))
input_hash_i  = keccak256(UTF8(canonical_json(input_i)))
output_hash_i = keccak256(UTF8(canonical_json(output_i)))
hash_content_i = canonical_json({task_id, step_index, source, agent, current_step,
                                 message, evidence, input_hash, output_hash})
```

`canonical_json` 递归按 key 排序、保留 UTF-8、使用紧凑分隔符，并在序列化前递归把整数型浮点数规范成整数（例如 `2.0 → 2`、`-0.0 → 0`）。这是为了匹配浏览器 `JSON.parse` / `JSON.stringify` 的数字表示；字符串 `"2.0"`、布尔值、`null` 和非整数小数保持不变。完成数字规范化后再执行 `json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))`。

### 证明链构成

| 步骤 | 产生方 | step_hash |
|---|---|---|
| INPUT_VALIDATED | 成员4后端 | H0 |
| CHAIN_FETCHED | 成员4后端 | H1（链自 H0） |
| DocAgent 解析 | 成员3输出 / 成员4重哈希 | H2（链自 H1） |
| CrossCheckAgent 交叉核验 | 成员3输出 / 成员4重哈希 | H3（链自 H2） |
| RiskAgent 打分 | 成员3输出 / 成员4重哈希 | H4（链自 H3） |
| REPORT_ASSEMBLED | 成员4后端 | H5（链自 H4） |
| PROOF_MANIFEST_COMPILED | 成员4后端 | H6（链自 H5） |

- `step_hashes` 是完整顺序的唯一真相，`merkle_root` 由全部步骤构建。
- `PROOF_MANIFEST_COMPILED` 不是占位步骤：它校验前六步顺序，承诺前六个真实哈希与业务报告正文哈希，并声明最终七步清单。
- `report_payload_hash` 是对 `task_id/meta/summary/findings/disclaimer` 的 canonical JSON 做 Ethereum keccak256；它不替代最终 `report_hash`。
- `reasoning_step_hashes` / `backend_step_hashes` 只是兼容视图，不用于推断顺序。
- `report_hash` 仅排除 `proof_data.report_hash` 自身；步骤、Merkle Root 与哈希版本全部受保护。
- Merkle 叶子为 `keccak256(UTF8(step_hash_hex))`，父节点为 `keccak256(leftBytes || rightBytes)`；奇数层复制末节点。

---

## 2. 给其他成员的接口契约

### 2.1 → 成员3（AI Agent / 算法）

成员4 **调用**成员3 的 `run_agent_process`，仅负责传入 `chain_data`：

```python
from member3.agent_process import run_agent_process   # 经 agent_adapter 自动解析

result = run_agent_process({
    "task_id": "task_xxx",
    "whitepaper_text": "...",
    "chain_data": {                                       # ← 由成员4 ChainAgent 产出
        "team_wallet_pct": 82,
        "top_wallet_concentration_pct": 82,
        "has_timelock": False,
        "contract_verified": False,
    },
})
```

- 成员4 **不重写** AI 逻辑；成员3 不可用时仅在 `USE_MOCK_DATA=true` 下回退到 `mock_fallback`。
- 成员3输出的原始 `step_hashes` 不直接进入最终证明；成员4依据 `reasoning_log` 顺序续接 H1 重算，保证全链连续。

### 2.2 → 成员2（前端 / UI）

**SSE 推演流** `GET /api/v1/audit/stream/:task_id`，每条事件：

```json
{
  "event": "STEP",
  "task_id": "task_xxx",
  "status": "PROCESSING",
  "current_step": "CROSS_CHECKING",
  "log_entry": {
    "agent": "RiskAgent",
    "message": "检测到风险：白皮书承诺锁仓 2 年，但链上合约未发现 TimeLock。",
    "timestamp_ms": 1788382805000,
    "step_index": 2,
    "previous_step_hash": "0x8f2d...",
    "input_hash": "0x...",
    "output_hash": "0x...",
    "hash_content": "{...keccak-v1 canonical JSON...}",
    "step_hash": "0xa3f21183b01934c2...",
    "hash_algorithm": "ethereum-keccak256",
    "hash_version": "keccak-v1"
  }
}
```

- 前端用 `previous_step_hash + hash_content + timestamp_ms` 逐步重算；任一步不一致即阻止上链。
- SSE 最后一条明确为 `COMPLETED` 或 `FAILED`，不能用连接关闭猜测结果。
- **验证页**：先重算全部步骤、Merkle Root 和 `report_hash`，三层一致后再调用成员5合约 `verify(reportHash)`。

**完整报告** `GET /api/v1/audit/report/:task_id`（与分工.md schema 对齐）：

```json
{
  "task_id": "task_xxx",
  "meta": { "model_version": "...", "data_sources": ["..."], "timestamp": 1788382820 },
  "summary": { "overall_risk_score": 85, "risk_level": "HIGH", "verdict": "..." },
  "findings": [
    { "category": "TOKENOMICS_MISMATCH", "severity": "CRITICAL",
      "title": "...", "description": "...", "evidence": "..." }
  ],
  "proof_data": {
    "hash_algorithm": "ethereum-keccak256",
    "hash_version": "keccak-v1",
    "manifest_version": "proof-manifest-v1",
    "steps": [
      { "step_index": 0, "previous_step_hash": "0x...", "hash_content": "...", "step_hash": "0x..." }
    ],
    "step_hashes": ["0x..."],
    "reasoning_step_hashes": ["0x8f2d...", "0xa3f2...", "0xc19b..."],
    "backend_step_hashes": ["0x...", "0x...", "0x...", "0x..."],
    "manifest_step_hash": "0x...",
    "report_payload_hash": "0x...",
    "merkle_root": "0xe21a...",
    "report_hash": "0x7d8a..."
  },
  "disclaimer": "本报告由 FluxAudit 辅助诊断生成，基于测试与公开数据，不构成财务投资建议。"
}
```

### 2.3 → 成员5（Web3 / 可验证逻辑）

成员4 交付两个待上链字段（写入 `Attestation.sol`）：

| 字段 | 来源 | 计算 |
|---|---|---|
| `reportHash` | 报告 `proof_data.report_hash` | `keccak256(canonical_json(仅排除 report_hash 的完整报告))` |
| `merkleRoot` | 报告 `proof_data.merkle_root` | `merkle_root(step_hashes)` |
| `riskScore` | 报告 `summary.overall_risk_score` | 直接映射 |

- 成员5 只需 `attest(reportHash, merkleRoot, riskScore)`，无需关心内部步骤。
- 三端哈希口径已由 `hashing.py` 统一（见第 1 节），前端重算即可与链上记录一致。

---

## 3. 模块结构（整洁分层）

```
member4/
├── app.py                 # FastAPI 主服务：3 个核心 API + SSE 编排
├── config.py              # 环境变量 / 全局开关（USE_MOCK_DATA 等）
├── hashing.py             # ★ 唯一哈希口径：keccak256 / 哈希链 / Merkle / report_hash
├── hash_vectors.json      # ★ 成员2/5跨语言固定向量
├── onchain.py             # Etherscan 抓取 + 确定性 Mock 持币分布 + 自动降级
├── chain_agent.py         # ChainAgent：输出成员3 所需的 chain_data + 中文摘要
├── agent_adapter.py       # 调用成员3 run_agent_process，缺失时回退 Mock
├── mock_fallback.py       # AI 超时兜底：仍带 keccak256 的完整结构化报告
├── report_builder.py      # 成员3 结果 -> 最终报告 schema + 证明链收口
├── task_queue.py          # 内存任务存储 + SSE 订阅式 fan-out
├── requirements.txt       # 开发依赖范围
├── requirements.lock.txt  # 组测验证过的精确依赖版本
├── .env.example
├── README.md
└── tests/
    ├── test_hashing.py      # 已知向量 + 链式 + Merkle + 篡改检测
    ├── test_chain_agent.py  # Mock / 真实降级
    └── test_api.py          # start -> report 闭环 + 哈希校验
```

---

## 4. 运行（一条命令）

```bash
cd member4
pip install -r requirements.lock.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

`.env` 会由 `python-dotenv` 自动加载。浏览器联调默认允许 `localhost:3000` 与 `127.0.0.1:3000`，可用 `CORS_ORIGINS` 覆盖。

或用环境变量（指向成员3、开启真实链上）：

```bash
export MEMBER3_PATH=/path/to/member3
export USE_MOCK_DATA=false
export ETHERSCAN_API_KEY=your_key
python app.py
```

健康检查：`GET /api/v1/health` 返回 `member3_connected`、`use_mock_data` 与
`chain_agent_status`；后者为 `mock` 时，前端必须明确展示为合成数据。

---

## 5. 测试（0 FAIL 才可交付联调）

```bash
cd member4
python tests/test_hashing.py      # 哈希口径（最关键）
python tests/test_chain_agent.py  # 链上数据 Mock / 降级
python tests/test_api.py          # API 闭环 + proof_data 哈希校验
```

---

## 6. 合规与降级红线（分工.md 第七节）

- 私钥 / API Key 不进仓库、录屏、PPT。
- `USE_MOCK_DATA=true` 时全链路走合成数据，保证 2 分钟 Demo 零卡顿；现场如实披露 Mock / 云端依赖。
- 所有演示数据标注为公开 / 合成 / 已脱敏；不处理真实客户资金。
- 报告保留免责声明（与成员1 / 成员3 完全一致）。
- 任何异常都会兜底为可读报告，不会让 Demo 崩溃。

---

## 7. 联调与每日验收（总集成负责人职责）

- 每日 22:00 牵头端到端验收：`start` → 观察 SSE 推演 → `report` → （成员5）上链 → 成员2 验证页验伪。
- 记录：`日期 / 版本 / 是否跑通 / 总耗时 / 真实 API 或 Mock / 人工干预点 / 失败原因 / 次日修复责任人`。
- 现场保留 **Mock 模式** 与 **真实 API 模式** 两套路径。
