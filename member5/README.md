# FluxAudit · 成员 5 SDK 0.2.0

接入成员 4 七步报告：验证步骤输入输出、连续哈希链、证明清单、七叶 Merkle Root 与完整报告哈希，然后执行合约存证及验伪。合约 ABI 保持 attest(reportHash, merkleRoot, riskScore)。

## 已完成与下一步

已通过成员 4 调用成员 3 生成的本地报告（Mock 链上数据、本地规则引擎）、小数锁仓报告和本地模拟链测试。实际测试记录见交付包的交付验证记录.md。

尚需团队测试钱包、Sepolia 测试 ETH/RPC、实际部署及成员 2 浏览器钱包验收。fixture 中的报告不是已经登记在 Sepolia 的报告。

## 安装与验证

要求 Node.js >=22.13.0。

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run demo:local
npm pack
```

前端安装：

```bash
npm install ./fluxaudit-member5-web3-0.2.0.tgz ethers@6.17.0 --ignore-scripts
```

```ts
import { verifyReportLocally, attestReport, verifyReportOnChain,
  parseReportJsonFile, toVerificationUiState } from "@fluxaudit/member5-web3";

const report = await parseReportJsonFile(file);
const local = verifyReportLocally(report);
if (!local.isLocallyValid) throw new Error("报告完整性校验失败");
// 此时只显示“本地完整性通过，链上未检查”。
const result = await verifyReportOnChain({ report, provider,
  contractAddress: TRUSTED_CONTRACT_ADDRESS,
  trustedAuditor: TRUSTED_TEAM_AUDITOR, expectedChainId: 11155111 });
const ui = toVerificationUiState(result);
// 只有 ui.code === "VERIFIED" 才显示绿色链上验证通过。
```

attestReport({report, signer, contractAddress, expectedChainId:11155111}) 会先验证完整证明，再检查网络与授权钱包，等待一次交易确认后返回 transactionHash/blockNumber。仅在用户点击上链时请求钱包。

contractAddress 与 trustedAuditor 必须来自团队可信配置，不能取自上传报告或 URL。网络错误应显示“链上未检查”，不能误报篡改。PDF 是分析输入；SDK 验伪只接受不超过 10 MB 的报告 JSON。

## 从 0.1.1 升级

这是协议不兼容升级。旧包仍可归档；0.2.0 明确拒绝旧三步报告，后端必须重新生成七步报告。

- reportHash 只排除 proof_data.report_hash，不再排除整个 proof_data。
- Merkle 使用 proof_data.step_hashes 全七项。
- 本地结果增加 isStepChainValid、isManifestValid。
- 可安全表示的小数参与完整跨端哈希复算。
- fixtures/golden-report.json 已替换为成员 4 生成的七步报告；legacy-report.json 仅用于拒绝旧协议测试。

完整规范和边界见 HASH_SPEC.md。新增两项检查必须接入 UI，不能只看 reportHash 与 Root。

## Sepolia 部署

在本机安全环境配置 SEPOLIA_RPC_URL、SEPOLIA_PRIVATE_KEY 后运行 npm run deploy:sepolia。脚本强制链 ID 11155111。私钥不能进入聊天、源码、前端、交付包或截图。

保存部署返回的合约地址、authorizedAttestor、交易号、区块与浏览器链接，并由团队确认配置。源码链上验证与浏览器钱包演示仍需单独执行。

## 目录

- src/canonical.ts：Python 数字和 JSON 序列化规则。
- src/hashing.ts：七步、清单、Merkle、报告验证。
- src/attestation.ts：合约写入和可信记录检查。
- src/frontend.ts：报告文件和 UI 状态边界。
- fixtures/：后端生成的正确、小数、篡改、旧版和数字向量。
- test/：合约、协议、篡改、SDK、前端状态与 npm 包入口测试。
- scripts/：本地 Demo、Sepolia 部署、报告 CLI 验证。
