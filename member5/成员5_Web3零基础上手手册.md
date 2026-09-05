> 2026-09-05 更新：当前 SDK 为 0.2.0，七步协议以 HASH_SPEC.md 为准。Sepolia 真实部署与浏览器钱包验收尚未完成。

# FluxAudit 成员 5：Web3 零基础上手手册

适用角色：成员 5｜Web3 与可验证逻辑工程师<br>
目标：不追求成为“全栈区块链专家”，先成为团队里能把“可验证”真正跑通、解释清楚、守住边界的人。

---

## 0. 先记住你的角色

你负责的不是判断一个项目有没有风险，而是证明：

> 这份报告是不是原来的版本、它的推理步骤有没有被替换、是谁在什么时间把它登记到了链上。

你可以把自己称为：

> FluxAudit 的数字证据与链上验真负责人。

你与其他成员的边界：

| 成员 | 对方负责 | 你需要从对方取得或交给对方 |
| --- | --- | --- |
| 成员 2｜前端 | 页面、钱包按钮、验证结果展示 | 你交付 SDK、ABI、可信合约地址和状态判断规则 |
| 成员 3｜AI | Agent 输出与推理日志 | 你需要稳定的步骤内容、顺序和时间戳 |
| 成员 4｜后端 | 汇总数据、生成最终报告 JSON | 你需要真实报告；双方必须统一哈希字段和算法 |
| 成员 1｜路演 | PPT、话术、截图和合规材料 | 你提供交易链接、验证截图和准确的能力边界 |

---

## 1. 用五个生活比喻理解你的工作

### 1.1 Hash：数字指纹

一份报告经过哈希函数后，会得到一个固定长度的值：

```text
0x35ed273d3f9bdff1e5f7fa110fff49c51c28e52525a6708ea9cca1e7bf5e200b
```

原文只改一个字，结果通常也会完全不同。

FluxAudit 必须使用：

```text
Ethereum keccak256
```

不能替换成名字相似的 NIST `SHA3-256`。

### 1.2 钱包：签字笔

钱包不仅用于放资产，也代表一个可验证的链上身份。团队钱包发出交易，相当于用这支签字笔确认：

> 我们在这个时间登记了这组报告证据。

私钥就是签字笔的唯一控制权。任何拿到私钥的人都可以冒充这个钱包，所以绝不能把私钥发群、提交仓库或放进截图。

### 1.3 智能合约：公开登记簿

`Attestation.sol` 是放在 Sepolia 测试网上的公开登记簿。它保存：

- `reportHash`：报告正文指纹；
- `merkleRoot`：推理步骤集合指纹；
- `riskScore`：风险分；
- `timestamp`：登记时间；
- `auditor`：登记钱包。

### 1.4 SDK：翻译员

前端页面不应自己随意拼哈希和合约调用。SDK 把规则封装起来，帮助成员 2：

- 重新计算哈希；
- 检查报告格式；
- 向合约提交交易；
- 读取链上记录；
- 对比本地与链上的结果。

### 1.5 验证：重新算一遍再对答案

真正的验证不是看页面有没有绿色勾，而是：

```text
读取报告
   ↓
重新计算 reportHash 与 merkleRoot
   ↓
读取可信 Sepolia 合约的记录
   ↓
逐项比较 Hash、Root、风险分和审计钱包
   ↓
全部一致才显示通过
```

---

## 2. 你需要认识的三种 Hash

### 2.1 `stepHash`：一个步骤的指纹

FluxAudit 每一步使用：

```text
stepHash = keccak256(UTF8(prevHash + "|" + content + "|" + timestamp))
```

这里最容易出错的是：

- `prevHash` 是带 `0x` 的文本；
- 中间的 `|` 不能丢；
- `timestamp` 必须一致；
- 拼接完成后按 UTF-8 字节计算；
- 每一步都必须使用前一步的 Hash。

### 2.2 Hash Chain：步骤之间的封条

```text
Step 1 Hash → Step 2 的 prevHash
Step 2 Hash → Step 3 的 prevHash
Step 3 Hash → Step 4 的 prevHash
```

中间一步被替换，后面的连接就会断裂。

### 2.3 `merkleRoot`：全部步骤的总指纹

Merkle Tree 把多个 `stepHash` 汇总成一个 `merkleRoot`。步骤内容、顺序或数量变化，Root 都应变化。

它的价值是：链上不需要保存全部推理日志，只保存一个 32 字节 Root，就能承诺当时使用的是哪一组步骤。

### 2.4 `reportHash`：完整报告的指纹

SDK 0.2.0 已接入成员 4 七步协议：

```text
只删除 proof_data.report_hash 自身
→ 对完整报告（包括七步、清单和 Merkle Root）做 canonical JSON
→ UTF-8 → Ethereum keccak256
```

正文和证明数据都受到保护。格式化空格、键顺序、2/2.0 等规范化等价写法不视为内容篡改。完整性证明不保证 AI 正确，也不证明原白皮书真实。当前后端尚未提交原白皮书的摘要绑定。

---

## 3. 为什么需要 Canonical JSON

下面两个 JSON 对人来说一样，但原始文本不同：

```json
{"a":1,"b":2}
```

```json
{ "b": 2, "a": 1 }
```

如果直接对原始字符串计算 Hash，它们会产生不同结果。为保证 Python 后端和 JavaScript 前端算出相同结果，双方要先按统一规则序列化：

```python
json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
```

你不需要背代码，只需要记住方法论：

> 跨语言计算 Hash 时，必须先统一“每一个字节”，仅仅数据看起来一样是不够的。

---

## 4. 链下与链上分别做什么

### 链下保存

- PDF、JSON 和完整报告；
- AI 输出与推理日志；
- 证据详情；
- Hash 计算过程。

### 链上保存

- 最终 `reportHash`；
- `merkleRoot`；
- `riskScore`；
- 时间和审计钱包。

不把完整报告放到链上的原因：

- 链上写入需要 Gas；
- 数据完全公开；
- 更新和展示不方便；
- AI 与文档处理适合在链下完成。

这个架构叫：

> 链下计算与保存，链上承诺与存证。

---

## 5. “链上验证通过”究竟证明了什么

可以证明：

- 当前报告正文与登记版本一致；
- 当前 reasoning steps 与登记的 Merkle Root 一致；
- 该记录在某个区块时间已经存在；
- 记录来自配置中的可信合约和团队审计钱包。

不能证明：

- AI 结论一定正确；
- 输入数据一定真实完整；
- 被审计协议一定安全；
- 页面显示绿色就代表计算真的执行过。

你的标准回答：

> 我们证明的是报告完整性、步骤承诺和发布者身份，不直接证明报告结论的事实真实性。

---

## 6. 你最需要认识的项目文件

第一次只读这六个文件，不要试图读完整项目：

| 文件 | 用途 | 初学者先看什么 |
| --- | --- | --- |
| `HASH_SPEC.md` | 三端统一的哈希规则 | Step Hash、Merkle、Report Hash 三节 |
| `contracts/Attestation.sol` | 链上登记簿 | `attest()` 和 `verify()` |
| `src/hashing.ts` | JavaScript 哈希实现 | `hashStep()`、`merkleRoot()`、`verifyReportLocally()` |
| `src/attestation.ts` | SDK 链上交互 | `attestReport()`、`verifyReportOnChain()` |
| `fixtures/golden-report.json` | 正确报告样例 | `summary` 与 `proof_data` |
| `fixtures/tampered-report.json` | 被修改的样例 | 找出它与正确报告的差异 |

项目目录：

```text
<解压后的 FluxAudit 测试包>/member5
```

---

## 7. 第一次实际操作：只跑，不改代码

打开终端：

```bash
cd member5
npm ci --ignore-scripts
npm test
npm run demo:local
```

你应该看到：

- 25 项测试通过；
- 原始报告 `isVerified: true`；
- 篡改报告 `isVerified: false`；
- 输出一个本地模拟合约地址和交易 Hash。

这次操作不连接真实 Sepolia，也不会花测试币。

完成后，你只需要能够解释：

> Demo 先将正确报告锚定到本地测试链，再使用相同规则验证原报告和篡改报告；原报告通过，篡改报告失败。

---

## 8. 读懂合约，不要求会从零编写

合约只有两个核心动作。

### `attest()`：登记

输入：

```text
reportHash + merkleRoot + riskScore
```

合约会检查：

- 调用者是不是授权审计钱包；
- Hash 和 Root 是否为零；
- 风险分是否为 0–100；
- 相同报告是否已经登记。

### `verify()`：查询

输入一个 `reportHash`，返回：

```text
是否存在 + merkleRoot + riskScore + timestamp + auditor
```

`verify()` 是只读查询，不会发交易，也不需要 Gas。

`attest()` 会改变链上状态，所以需要钱包签名和 Gas。

---

## 9. 钱包、交易、Gas 与 Sepolia

### 钱包地址

可以公开，相当于账号。

### 私钥

绝不能公开，相当于不可撤销的最高权限密码。

### 交易

调用 `attest()` 会发送一笔交易。交易被区块确认后才算真正写入。

### Gas

执行写入交易所需的网络费用。Sepolia 使用没有真实金融价值的测试 ETH。

### Chain ID

Sepolia 的 Chain ID：

```text
11155111
```

部署脚本会在广播前检查 Chain ID，避免误部署到错误网络。

---

## 10. 现场联调应该怎么做

按以下顺序，不要直接点“上链”：

### 第一步：向成员 4 要真实报告

你需要：

- 完整报告 JSON；
- `proof_data.report_hash`；
- `proof_data.merkle_root`；
- `proof_data.step_hashes`（全部七步）；
- `summary.overall_risk_score`。

还需要确认：完整步骤重放所需的 `content` 与 `timestamp` 是否提供。

### 第二步：先做本地验证

确认：

- `reportHash` 能重新算出；
- `merkleRoot` 能重新算出；
- 步骤数量、顺序和字段名一致；
- 没有把 SHA3-256 当成 keccak256。

本地不通过时，禁止继续上链。上链不能修复错误的 Hash。

### 第三步：部署 Sepolia 合约

只在确认钱包、RPC 和网络后执行：

```bash
export SEPOLIA_RPC_URL='你的 Sepolia RPC'
export SEPOLIA_PRIVATE_KEY='团队测试钱包私钥'
npm run deploy:sepolia
```

需要记录：

- 合约地址；
- 授权审计钱包；
- 部署交易 Hash；
- 区块号；
- Etherscan 链接。

公开这些记录没有问题，但绝不公开私钥和 RPC 密钥。

### 第四步：让成员 2 接入

成员 2 需要从可信应用配置取得：

- `contractAddress`；
- `trustedAuditor`；
- `chainId = 11155111`。

这些值不能从上传报告、URL 参数或用户输入读取。

### 第五步：跑两组验收

正确报告：

```text
本地 Hash 正确 + 链上记录存在 + Root/风险分/钱包一致
→ 验证通过
```

修改正文后的报告：

```text
重新计算的 reportHash 改变
→ 找不到对应链上记录
→ 验证失败
```

---

## 11. 你必须阻止的八类错误

1. 使用 `SHA3-256` 代替 Ethereum `keccak256`。
2. 前端和后端使用不同的 JSON 排序或空格规则。
3. 把带 `0x` 的 Hash 当原始 bytes，而后端把它当 UTF-8 文本。
4. 页面用写死的 Hash，却显示 `VERIFIED`。
5. 本地复算失败仍允许上链。
6. 从报告或 URL 读取所谓的“可信合约地址”。
7. 把“内容完整性”说成“AI 结论绝对真实”。
8. 在群聊、仓库、截图或录屏中暴露私钥。

---

## 12. 当前团队最需要对齐的问题

现在视觉稿展示 7 个公开步骤；成员 4 当前报告的 Merkle Tree 只包含 3 个 reasoning step hashes。

你需要向队长确认：

> 最终承诺的是 3 个 reasoning steps、7 个公开阶段，还是完整 8 步？

推荐原则：

- UI 写几个步骤，就必须真的验证几个步骤；
- Merkle Root 必须由界面所声称的那组步骤计算；
- 每一步都要有确定的 `content`、`timestamp`、`prevHash` 和 `stepHash`；
- 没有真实复算，不显示 `MATCH` 或 `VERIFIED`。

---

## 13. 现场故障处理顺序

如果验证失败，按这个顺序查：

1. 网络是不是 Sepolia，Chain ID 是否为 `11155111`；
2. 合约地址是否为团队确认的地址；
3. 报告字段名和步骤数量是否一致；
4. 使用的是不是 Ethereum keccak256；
5. Canonical JSON 是否一致；
6. 时间戳单位是秒还是毫秒；
7. `prevHash` 是否带 `0x` 并作为文本拼接；
8. Merkle 叶子是 Hash 文本的 UTF-8，还是原始 bytes32；
9. 报告正文是否在生成 Hash 后又被修改；
10. 审计钱包是否等于合约的授权钱包。

不要用“重新部署一次试试”代替定位问题。

---

## 14. 评委可能问你的问题

### 为什么不把完整报告放上链？

> 完整报告体积大、可能包含敏感信息，链上写入成本也高。我们链下保存报告，链上只保存报告 Hash、Merkle Root、风险分、时间与发布钱包。

### 区块链证明报告是真的吗？

> 它证明报告完整性、登记时间和发布者身份，不直接证明 AI 结论的事实真实性。

### 为什么要 Merkle Root？

> 它用一个固定长度的值承诺整组推理步骤。任一受承诺步骤或顺序变化，重新计算的 Root 都会改变。

### 为什么只能团队钱包上链？

> 防止任意钱包抢先登记相同报告 Hash，冒充 FluxAudit 官方证明或阻止团队正常登记。

### 这是 zkML 吗？

> 不是。当前是可复核日志、哈希链、Merkle 承诺与测试网锚定，不证明模型在零知识环境中正确执行。

---

## 15. 你的 30 秒自我介绍

> 我负责 FluxAudit 的 Web3 与可验证逻辑。我们在链下生成报告和推理日志，为每一步使用 Ethereum keccak256 建立哈希链，再把步骤汇总为 Merkle Root。最终将 reportHash、merkleRoot 和风险分写入 Sepolia 的 Attestation 合约。验证页会重新计算本地证据，并与可信合约和团队钱包逐项比较。它证明报告完整性和发布记录，不直接证明 AI 判断绝对正确。

---

## 16. 最小学习路线：一次只完成一关

### 第 1 关｜现在

只理解：Hash 是数字指纹；验证必须重新计算。<br>
操作：运行 `npm test` 和 `npm run demo:local`。

### 第 2 关

只理解：钱包是签名身份；私钥不能公开。<br>
操作：认识 Sepolia、Chain ID、交易 Hash 和 Etherscan。

### 第 3 关

只理解：合约是公开登记簿。<br>
操作：阅读 `attest()` 和 `verify()`，能说出写调用与读调用的区别。

### 第 4 关

只理解：Hash Chain 与 Merkle Root 承诺步骤。<br>
操作：对照 `HASH_SPEC.md` 和 Golden Vector。

### 第 5 关

只理解：前后端必须对相同字节做哈希。<br>
操作：与成员 4 核对一次真实 JSON。

### 第 6 关

只理解：链上通过不等于事实真实。<br>
操作：跑正确报告与篡改报告两条演示路径。

不要同时学习六关。完成一关，并能用自己的语言复述，再进入下一关。

---

## 17. 你的完成标准

比赛前，你不需要独立默写全部代码。只要能做到以下事情，就已经能够胜任成员 5：

- 能运行本地测试和 Demo；
- 能辨别 Ethereum keccak256 与 SHA3-256；
- 能解释 `stepHash`、`merkleRoot` 和 `reportHash`；
- 能读懂一次 Sepolia 交易记录；
- 能判断页面的 `VERIFIED` 是否有真实计算依据；
- 能和成员 4 对齐 JSON 字段及步骤口径；
- 能向成员 2 提供可信合约地址、钱包地址、ABI 和 SDK；
- 能保护私钥并准确说明系统边界。

最后记住：

> 你的价值不在于使用了多少 Web3 术语，而在于确保任何“已验证”的结论都有可重算、可比较、可解释的证据。
