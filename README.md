# FluxAudit（流审）

FluxAudit 是一个 AI 辅助的链上项目尽调与风险审计原型。它把项目白皮书中的公开声明与链上数据进行交叉核验，输出结构化风险报告，并为每一步生成可验证的哈希证明。

当前工作区已合入成员 1、成员 3、成员 4 的可运行闭环、成员 2 的产品化前端，以及成员 5 的严格验伪 SDK 与 Attestation 合约：

```text
成员1测试数据
    -> 成员4 FastAPI / ChainAgent
    -> 成员3 DocAgent / CrossCheckAgent / RiskAgent
    -> 成员4 SSE、风险报告、Merkle Root、report_hash
    -> 成员5 SDK 0.2.0 严格验证七步、manifest、Root 与 report_hash
    -> 成员2录入、执行、报告、验伪与配置化 Sepolia 接口
```

> 当前演示采用公开、合成或已脱敏数据，并默认启用 Mock 链上数据兜底；报告不构成财务、投资或法律建议。

## 已达成目的

- 让用户不必手工比对长篇白皮书和链上指标，也能快速看到文档承诺与链上事实是否矛盾。
- 将风险结论输出为统一 JSON，包括风险分、风险等级、风险依据、findings 和推演日志。
- 通过 Ethereum keccak256 哈希链、Merkle Root 和 report_hash，让报告被篡改后可以被发现。
- 当 DeepSeek、Etherscan 或其他外部服务不可用时，仍能使用确定性规则和 Mock 数据完成稳定演示。

## 已合入的工作

| 成员 | 做了什么 | 使用的方法 | 达到的结果 |
|---|---|---|---|
| 成员1：产品与材料 | 制作路演 PPT、演讲稿、演示串场词、合规说明、测试数据和提交材料 | 两个合成项目样例、白皮书 PDF、结构化 audit_request JSON、PDPO 与免责声明文档 | 为后端和 Agent 提供可复现输入；定义高风险与合规项目的预期输出 |
| 成员3：AI Agent / 算法 | 实现 DocAgent、CrossCheckAgent、RiskAgent；生成 reasoning_log 和 step_hash | Python、正则与确定性规则、可选 DeepSeek JSON Mode、pycryptodome keccak256 | 将白皮书和 chain_data 转为风险分、等级、证据、findings 和哈希化推演日志 |
| 成员4：后端与链上数据 | 实现 FastAPI API、任务编排、SSE、ChainAgent、报告构造、Mock Fallback 与 Merkle Root | FastAPI、SSE、Etherscan 适配、确定性 Mock、pycryptodome、内存任务队列 | 打通提交任务、实时查看步骤、读取最终报告的后端闭环 |
| 成员2：前端 UI/UX | 实现录入、执行、报告、验伪四个核心界面 | React、Vite、真实 API/SSE 状态流、member5 SDK 0.2.0 | 已接通完整本地闭环；四项本地验证独立可见；Sepolia 未配置时 fail-closed |
| 成员5：Web3 / 合约 | 实现严格七步 SDK、Attestation 合约、ABI、fixtures 与联调规则 | Solidity、Hardhat、ethers、Ethereum keccak256 | SDK 与合约已合入；真实 Sepolia 部署记录、测试 ETH/RPC 和源码验证仍待完成 |

## 成员1：输入与演示资产

成员1提供两套可直接演示的数据：

| 样例 | 路径 | 用途 | 预期输出 |
|---|---|---|---|
| NovaPay | 成员1_测试与材料/02_测试数据/高风险项目_NovaPay/audit_request.json | 展示白皮书与链上数据矛盾 | 85 分，HIGH，6 条 findings |
| AtlasIndex | 成员1_测试与材料/02_测试数据/合规项目_AtlasIndex/audit_request.json | 展示系统不会对所有项目一律判高风险 | 2 分，LOW，1 条 finding |

每份 audit_request JSON 的核心输入为：

```json
{
  "target_type": "HYBRID",
  "contract_address": "0x...",
  "chain_id": 11155111,
  "whitepaper_text": "项目白皮书文本"
}
```

其中 file_base64 是演示 PDF 附件，当前 Agent 的主要文本输入是 whitepaper_text。

## 成员3：AI 与规则方法

成员3的入口函数是：

```python
run_agent_process({
    "task_id": "task_xxx",
    "whitepaper_text": "...",
    "chain_data": {...}
})
```

三段 Agent 流程：

1. DocAgent：从白皮书中提取团队代币占比、锁仓、审计声明、收益承诺等可验证声明。
2. CrossCheckAgent：将文档声明与链上数据比较，找出代币分配不一致、锁仓缺失、流动性未锁、源码高度相似、审计报告不可验证、资金流异常等风险。
3. RiskAgent：根据 findings 的严重程度和规则权重，输出 risk_score、risk_level、risk_reasons。

每一步都有公开输入、输出和 step_hash。最终跨端哈希规则为：

```text
H(-1) = 0x000...000
input_hash_i = keccak256(canonical_json(input_i))
output_hash_i = keccak256(canonical_json(output_i))
content_i = canonical_json({task_id, step_index, source, agent, current_step, message, evidence, input_hash, output_hash})
H_i = keccak256(H_(i-1) + "|" + content_i + "|" + timestamp_ms_i)
```

跨端 canonical JSON 还要求递归把整数型浮点数规范成整数（`2.0 → 2`），再排序对象键并紧凑序列化；字符串、布尔值、`null` 与非整数小数保持不变。这样 Python 与浏览器对同一 JSON 数据可重算出相同 Ethereum keccak256。

DeepSeek 是可选能力：启用后仅负责 DocAgent 的文档结构化解析；交叉校验和风险评分仍使用确定性规则，避免链上硬指标被模型漏报。

## 成员5：严格验伪与可选 Attestation

前端通过仓库内固定版本的 `@fluxaudit/member5-web3` 0.2.0 执行四项本地门禁：

- `isReportHashValid`
- `isStepChainValid`
- `isManifestValid`
- `isMerkleRootValid`

只有四项全部通过才显示 `VERIFIED LOCALLY`。旧三步报告、缺失或未知协议、错误步骤顺序/source/timestamp、缺失 manifest，以及仅重算外层 hash/root 的伪报告都会被拒绝。

链上读取和团队钱包写入已做成可信配置驱动的接口，但接入包没有真实 Sepolia 部署记录。因此默认界面显示 `NOT CONFIGURED`，不会请求 RPC、钱包，也不会伪造交易、区块或浏览器链接。后续只有在团队确认固定的 `(chainId, registryAddress, trustedAuditor, restrictedRpcUrl)` 后才可启用；钱包节点只负责账户与交易提交，写前检查、回执、事件和最终 read-back 均以配置的 RPC 为准。

## 成员4：后端与可验证报告

成员4提供以下 API：

| 接口 | 用途 |
|---|---|
| POST /api/v1/audit/start | 提交审计任务，返回 task_id |
| GET /api/v1/audit/stream/{task_id} | 以 SSE 实时返回推演日志与 step_hash |
| GET /api/v1/audit/report/{task_id} | 获取最终风险报告、Merkle Root 与 report_hash |
| GET /api/v1/health | 检查后端、Mock 模式和成员3连接状态 |

一次任务会产生七个连续、独立、可重算的业务步骤；Merkle Root 与 report hash 是这些步骤的派生证明，并通过 `COMPLETED` 终态返回：

```text
INPUT_VALIDATED
-> CHAIN_FETCHED
-> DOC_PARSING
-> CROSS_CHECKING
-> RISK_SCORING
-> REPORT_ASSEMBLED
-> PROOF_MANIFEST_COMPILED
```

最后一步会校验前六步顺序，并用 Ethereum keccak256 承诺前六个哈希与业务报告正文；它不是复制或伪造的占位哈希。

最终报告包含：

```json
{
  "summary": {
    "overall_risk_score": 85,
    "risk_level": "HIGH",
    "verdict": "..."
  },
  "findings": [],
  "proof_data": {
    "hash_algorithm": "ethereum-keccak256",
    "hash_version": "keccak-v1",
    "manifest_version": "proof-manifest-v1",
    "steps": [],
    "step_hashes": [],
    "reasoning_step_hashes": [],
    "backend_step_hashes": [],
    "manifest_step_hash": "0x...",
    "report_payload_hash": "0x...",
    "merkle_root": "0x...",
    "report_hash": "0x..."
  }
}
```

ChainAgent 当前可提供或模拟以下字段：

- team_wallet_pct、top_wallet_concentration_pct
- has_timelock、contract_verified
- liquidity_locked、source_similarity_pct
- audit_report_available、abnormal_fund_flow
- doc_progress_pct、chain_progress_pct

真实 API 超时、缺少 Key 或受到限流时，系统会明确进入 Mock Fallback，保证演示不中断。

## 快速运行

在项目根目录进入后端：

```powershell
cd .\member4
python -m pip install -r .\requirements.lock.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

打开：

- 健康检查：http://localhost:8000/api/v1/health
- 交互式 API 页面：http://localhost:8000/docs

在 Swagger 页面使用 POST /api/v1/audit/start 提交成员1的 NovaPay 或 AtlasIndex 输入。复制返回的 task_id 后，依次打开：

```text
http://localhost:8000/api/v1/audit/stream/<task_id>
http://localhost:8000/api/v1/audit/report/<task_id>
```

在第二个终端启动成员2前端（Node.js >= 22.13）：

```powershell
cd .\frontend
npm install
npm run dev -- --host 127.0.0.1 --port 4173 --strictPort
```

打开 http://localhost:4173/，可直接选择 NovaPay 或 AtlasIndex，完成 Create → SSE Execution → Report → Local Verify 全流程。

## 已验证结果

| 验证项 | 结果 |
|---|---|
| 成员3 Agent 测试 | 68 PASS，0 FAIL；LLM 回退与成功路径均通过 |
| 成员4 ChainAgent 测试 | 26 PASS，0 FAIL |
| 成员4 Hashing 测试 | 27 PASS，0 FAIL |
| 成员4 API 闭环测试 | 40 PASS，0 FAIL |
| 成员2前端 Proof / Task scope / member5 集成 / Sites 测试 | 7 + 3 + 16 + 4 PASS，0 FAIL；生产构建通过 |
| 成员5 SDK / Solidity 合约 | 95 PASS，0 FAIL；权威七步与小数 fixtures 通过，tampered、legacy、缺 manifest、短链绕过均拒绝 |
| 浏览器真实闭环 | NovaPay、AtlasIndex、七步 SSE、报告与本地 Verify 均通过，无控制台错误 |
| NovaPay 端到端联调 | 85 / HIGH / 6 findings |
| AtlasIndex 端到端联调 | 2 / LOW / 1 finding |

## 当前边界与后续工作

- 当前链上数据优先用于演示，部分字段来自确定性 Mock；生产环境应替换为可追溯的 RPC、区块浏览器和链上索引数据。
- 当前哈希链、Merkle Root、report_hash 和 member5 SDK 已接通；仍需成员5提供经团队确认的 Sepolia 部署记录后，才能开启真实只读查验和团队钱包锚定。
- `Attestation` 只允许部署时的授权钱包写入，不是任意访客自行锚定的合约；普通验证页只做无钱包的只读查询。
- API Key、私钥、助记词不得提交到仓库、PPT、录屏或测试数据中。

## 目录说明

```text
成员1_测试与材料/           路演、测试数据、合规与提交材料
member3/                    DocAgent、CrossCheckAgent、RiskAgent
member4/                    FastAPI、ChainAgent、SSE、报告与哈希
member5/                    Solidity 合约、严格验伪 SDK、ABI、fixtures 与测试
frontend/                   React/Vite 产品前端、固定 SDK 依赖与 Sites 构建配置
docs/                       产品、设计与联调审查文档
```
