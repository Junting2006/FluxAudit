# 成员 4 后端包联调审查

> source: `member4.zip`（2026-09-03 收到）
> reviewed copy: `/member4`
> reviewer scope: 成员 2 前端接入、SSE 状态机、逐步哈希复核、报告验伪

## 结论

**2026-09-04 已在当前工作区完成修复，可以进入成员 2 的前端契约联调。**

包内基础结构完整，三个核心 API、Mock 兜底、Ethereum Keccak-256 实现与测试均已提供。隔离环境实测结果：

- `tests/test_hashing.py`：27 PASS / 0 FAIL
- `tests/test_chain_agent.py`：26 PASS / 0 FAIL
- `tests/test_api.py`：39 PASS / 0 FAIL
- Python 编译检查：通过

原始测试只能证明包内自洽。修复后新增了完整链、逐步重算、全部步骤 Merkle、报告证明保护、SSE 终态、CORS、失败报告和跨端固定向量断言；成员4当前结果为 92 PASS / 0 FAIL，并已通过真实 Uvicorn HTTP/SSE 与成员2浏览器闭环。

## 修复状态

| 项目 | 状态 | 落点 |
|---|---|---|
| B1 完整连续哈希链 | 已修复 | 成员4按最终事件顺序统一重算 |
| B2 唯一连续索引 | 已修复 | `step_index` 为 `0..N-1` |
| B3 SSE 可重算字段 | 已修复 | `input/output/hash_content/previous_step_hash` 全部输出 |
| B4 Merkle 覆盖全部步骤 | 已修复 | `proof_data.steps` 与 `step_hashes` 是唯一顺序 |
| B5 报告保护证明数据 | 已修复 | 只排除自引用 `proof_data.report_hash` |
| B6 SSE 明确终态 | 已修复 | 最终事件为 `COMPLETED` 或 `FAILED` |
| B7 CORS | 已修复 | 默认允许本地前端，可用环境变量覆盖 |

## 已确认可复用

1. API 路径与成员 2 预期一致：`POST /api/v1/audit/start`、`GET /api/v1/audit/stream/{task_id}`、`GET /api/v1/audit/report/{task_id}`。
2. `Crypto.Hash.keccak(digest_bits=256)` 是正确的 Ethereum Keccak-256，不是 NIST SHA3-256。
3. Mock 模式可独立跑通审计和报告生成，适合作为现场兜底。
4. SSE 会重放既有事件，迟到订阅者能够看到已生成步骤。
5. 报告的 `summary`、`findings`、`proof_data`、`disclaimer` 基础结构可用于前端开发。

## 原 P0 阻断项（均已修复）

### B1｜实际事件不是一条连续哈希链

`app.py` 先从零哈希生成 `INPUT_VALIDATED` 与 `CHAIN_FETCHED`，随后调用成员 3；但 Mock/成员 3 的首个 AI 步骤再次从零哈希开始。`last_agent_hash` 只取 AI 链末端，因此 AI 链没有绑定前面的后端步骤。

**修复结果：** 由成员4按真实事件顺序统一重算整条链。最终业务步骤唯一且连续：

```text
INPUT_VALIDATED → CHAIN_FETCHED → DOC_PARSING → CROSS_CHECKING
→ RISK_SCORING → REPORT_ASSEMBLED → PROOF_MANIFEST_COMPILED
```

第七步校验前六步顺序，并承诺前六个真实 `step_hash` 与业务报告正文 `report_payload_hash`；它自身再续接哈希链。Merkle Root 与最终 report hash 覆盖完整七步，且不会把尚未生成的最终证明字段循环纳入自身输入。

### B2｜`step_index` 重复，前端会丢步骤

`INPUT_VALIDATED` 和 `CHAIN_FETCHED` 都发送 `step_index=-1`，成员 2 按索引去重后只能保留一条。

**修复要求：** 所有事件按最终展示顺序使用连续唯一整数 `0..N-1`；重连重放时同一步保留相同索引。

### B3｜SSE 缺少前端重算哈希的原始材料

当前 SSE 只有 `agent`、`message`、`timestamp`、`step_index`、`step_hash`。后端实际哈希还使用了 `previous_hash` 与 `content`，前端无法从现有事件重算。

**最低兼容结构：**

```json
{
  "event": "STEP",
  "task_id": "task_xxx",
  "current_step": "CHAIN_FETCHED",
  "log_entry": {
    "agent": "ChainAgent",
    "message": "链上数据已拉取",
    "evidence": [],
    "timestamp_ms": 1788382805000,
    "step_index": 1,
    "previous_step_hash": "0x...",
    "hash_content": "CHAIN_FETCHED|{...}",
    "step_hash": "0x...",
    "hash_algorithm": "ethereum-keccak256",
    "hash_version": "keccak-v1"
  }
}
```

`hash_content` 必须是实际参与哈希的完整原文，不能由展示文案近似恢复。

### B4｜Merkle Root 没有覆盖“每一步”

当前 `merkle_root` 只由 `reasoning_step_hashes` 构建，即只覆盖 3 个 AI 步骤；入参校验、链数据抓取和报告阶段都不在 Merkle 中。`backend_step_hashes` 也只保存最后 3 个报告步骤，没有保存前两个后端步骤。

**修复要求：** 报告增加单一有序数组 `proof_data.steps` 与 `proof_data.step_hashes`，包含全部步骤；`merkle_root` 必须由完整 `step_hashes` 构建。前端不再拼接 `reasoning_step_hashes` 与 `backend_step_hashes` 猜测顺序。

### B5｜报告哈希没有保护 `proof_data`

当前 `compute_report_hash` 排除整个 `proof_data`。包内测试甚至把“修改 Merkle Root 后报告哈希不变”当作预期，因此攻击者可以替换步骤哈希或 Merkle Root 而不改变 `report_hash`。

**修复要求：** 计算 `report_hash` 时只排除自引用字段 `proof_data.report_hash`，保留 `proof_data.steps`、`proof_data.step_hashes`、`proof_data.merkle_root` 与哈希版本字段。

### B6｜SSE 没有明确完成/失败事件

任务完成后只关闭连接，没有发送 `COMPLETED`；异常时同样只关闭连接。前端无法区分正常完成、服务端错误和网络中断。

**修复要求：** SSE 最后一条必须为：

```json
{ "event": "COMPLETED", "task_id": "task_xxx", "status": "COMPLETED" }
```

或：

```json
{ "event": "FAILED", "task_id": "task_xxx", "status": "FAILED", "error_code": "...", "message": "..." }
```

### B7｜浏览器跨端口调用缺少 CORS

FastAPI 没有配置 `CORSMiddleware`。Next.js 前端与后端使用不同端口时，浏览器会拦截 REST 请求；SSE 也无法建立。

**修复要求：** 开发环境允许明确的前端 origin，例如 `http://localhost:3000`；不要在真实模式下无条件使用 `*`。

## 原 P1 修复项

1. 已增加 Pydantic 请求模型、Ethereum 地址、chain id 与文本/文件大小校验。
2. `file_base64` 仍只接受、不解析；前端 P0 使用 `whitepaper_text`，PDF/文件解析继续保留为 P1。
3. 已增加 `_mode` 与逐字段 `provenance`，混合数据不会再伪装成全真实。
4. 已加入 `python-dotenv`，`.env` 会自动加载。
5. SSE 已改为先订阅后重放，并用事件键消除重叠。
6. `FAILED` 报告现在可由 `/report` 正常读取。

## 成员 4 必须补的测试

1. `test_full_chain_continuity`：按 SSE 顺序重算全部步骤，每一步的 `previous_step_hash` 等于前一步 `step_hash`。
2. `test_step_indices_are_unique_and_monotonic`：索引严格为 `0..N-1`。
3. `test_merkle_covers_every_step`：修改任意前端/AI/报告步骤后 root 改变。
4. `test_report_hash_protects_proof_data`：修改步骤哈希或 Merkle Root 后 `report_hash` 改变。
5. `test_sse_terminal_events`：成功发送 `COMPLETED`，失败发送 `FAILED`。
6. `test_cors_preflight`：允许配置的前端 origin，拒绝未配置 origin。
7. `test_cross_language_vectors`：Python 与 viem/ethers 对单步骤、双步骤、奇数步骤向量完全一致。

## 联调接收标准

以下接收条件已在成员4本地实现中通过；成员2可以从 fixture 开始切换到后端：

- 全部步骤连续、唯一索引且可由 SSE 内容重算。
- Merkle Root 覆盖全部步骤。
- `report_hash` 保护除自身外的完整报告与证明数据。
- 成功/失败终态明确，浏览器 CORS 实测通过。
- 成员5仍需用 viem/ethers 运行 `member4/hash_vectors.json`；这是上链联调前唯一外部 Gate。
