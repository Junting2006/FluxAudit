# FluxAudit 哈希协议 — SDK 0.2.0

适配成员 4 于 2026-09-05 交付的 `ethereum-keccak256 / keccak-v1 / proof-manifest-v1`。此版本不接受旧三步报告；后端应重新生成报告，不能只改字段名或版本号。

## 七步与输入输出

顺序固定为 INPUT_VALIDATED、CHAIN_FETCHED、DOC_PARSING、CROSS_CHECKING、RISK_SCORING、REPORT_ASSEMBLED、PROOF_MANIFEST_COMPILED。

索引为 0..6。2..4 的 source 为 AI，其他为 BACKEND。每步的 task_id 必须与报告一致，timestamp 与 timestamp_ms 必须相等。

```text
input_hash  = keccak256(UTF8(canonicalJson(step.input)))
output_hash = keccak256(UTF8(canonicalJson(step.output)))
hash_content = canonicalJson({task_id, step_index, source, agent, current_step,
                              message, evidence, input_hash, output_hash})
H(-1) = 0x + 64 个 0
H(i) = keccak256(UTF8(previous_step_hash + "|" + hash_content + "|" + timestamp_ms))
```

previous_step_hash 是带 0x 的小写文本，不是原始 bytes32。SDK 重算输入输出及 envelope，不能只信任报告自带的 hash_content。逐步哈希重放证明这些内容相互一致，不证明模型确实执行了对应算法。

## Canonical JSON 与数字

对象键按 Unicode 码点递归排序；数组保持顺序；UTF-8、紧凑分隔符、中文不转义。匹配成员 4 的 Python canonical_json：整数型浮点数规范成整数（2.0 → 2，-0.0 → 0）。

SDK 支持有限 IEEE-754 数字，绝对值不超过 Number.MAX_SAFE_INTEGER；支持 0.5、2.5 等小数。非整数绝对值小于 1e-4 时使用 Python 指数格式（1e-7 → 1e-07，1e-5 → 1e-05）。禁止 NaN、Infinity、不安全大整数、undefined、稀疏数组和孤立 surrogate。链 ID、步骤索引、时间戳、风险分另外要求安全整数。

Python 生成的数字固定向量见 fixtures/python-number-vectors.json；新增数值类型或更大整数须先更新跨端协议，不能通过截断或四舍五入让校验通过。规范化校验针对 JSON 语义，不针对原文件空格、键顺序和 2/2.0 的书写差异。

## Merkle Root

唯一有序叶子列表为 proof_data.step_hashes，必须等于 steps.map(step_hash)，总共七项。

```text
leaf = keccak256(UTF8(step_hash 文本))
parent = keccak256(raw32(left) || raw32(right))
```

每层按原顺序两两组合，奇数时复制末节点；不排序。底层 merkleRoot([]) 返回 ZERO_HASH，但报告资格层拒绝空、不完整或失败流程。

reasoning_step_hashes 必须等于三个 AI 步骤哈希；backend_step_hashes 必须等于四个 BACKEND 步骤哈希。两者只是兼容视图，不用于推断完整顺序。

## 证明清单与报告哈希

业务正文由 task_id、meta、summary、findings、disclaimer 五个字段组成：

```text
report_payload_hash = keccak256(UTF8(canonicalJson(业务正文)))
report_hash = keccak256(UTF8(canonicalJson(仅删除 proof_data.report_hash 的完整报告)))
```

第七步 input 必须包含前六个有序哈希与正文哈希；output 必须准确声明七步名称、prior_step_count=6、final_step_count=7、协议版本与正文哈希。顶层 manifest_step_hash 和 report_payload_hash 必须一致。整个 proof_data 除 report_hash 自身均参与最终报告哈希。

## SDK 判断

verifyReportLocally 返回 isReportHashValid、isMerkleRootValid、isStepChainValid、isManifestValid；全部为 true 才有 isLocallyValid=true。结构错误、未知协议或无法安全序列化的数字抛 TypeError；结构合法但证明不一致返回 false。parseAttestationInput 和 attestReport 在任何一项失败时拒绝上链。

本地完整性通过不等于已存证。最终 VERIFIED 还需要可信合约上的 reportHash、Merkle Root、风险分和可信 auditor 一致。攻击者可以生成一份新的自洽报告，但无法因此冒充团队已经存证的原报告。

## 已知证明边界

证明包含后端提交的七步记录，不是 zkML，也不保证 AI 判断、数据来源或源文件真实。当前成员 4 没有把原白皮书文本/文件摘要纳入 DocAgent input（只有 previous_step_hash），因此不能宣称原始文档与解析结果的绑定已经被证明。Mock/hybrid/fallback 属性应在页面单独展示；存证不改变数据来源。

SDK 不直接验证 PDF 文件；验证格式是后端导出的完整报告 JSON。Sepolia 实际部署与浏览器钱包验收单独完成。
