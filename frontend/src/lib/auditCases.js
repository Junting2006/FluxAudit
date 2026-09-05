export const AUDIT_CASES = {
  novapay: {
    id: "novapay",
    project: "NovaPay Finance",
    label: "NovaPay · High risk",
    expected: "85 / HIGH / 6 findings",
    contractAddress: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    whitepaperText: "NovaPay Finance 是去中心化支付与收益聚合协议，主打跨链支付网络与年化 18% 的收益聚合器 NovaVault，宣称本金安全、收益稳定。团队核心成员来自国际投行与头部交易所，匿名运营但声称已通过第三方 KYC 认证。代币分配：$NOVA 总量 10 亿枚，团队 10%（锁仓 24 个月线性释放）、生态 25%、流动性 20%（初始流动性锁定 24 个月）、公募 15%、社区激励 30%。锁仓地址与源码已公示。合约声称已通过 SlowMist 审计，报告可于官网 novapay.finance/audit 下载。核心合约由 5/7 多签管理。治理采用 DAO 模式，金库由 5/7 多签管理。",
  },
  atlas: {
    id: "atlas",
    project: "Atlas Index",
    label: "AtlasIndex · Low risk",
    expected: "2 / LOW / 1 finding",
    contractAddress: "0xA2b8C9d4E7f1029384756A1B2C3D4E5F60718293",
    whitepaperText: "Atlas Index 是链上指数投资协议，跟踪市值前 20 蓝筹数字资产加权指数，明确不承诺固定收益，净值来自公开市场表现。团队公开身份。治理采用 5/9 多签 + 时间锁：参数变更须经链上提案、多签执行、24 小时等待期，全程链上留痕。代币分配：$ATLAS 总量 1 亿枚，团队 15%（锁仓 12 个月，链上 TimeLock 可查）、国库 20%（5/9 多签管理）、流动性 25%（初始流动性锁定 36 个月）、社区与生态 40%；白皮书注明分配与链上持仓完全一致。合约已通过两家独立机构审计，报告公开可下载；紧急情况可暂停存入、不可暂停提取。",
  },
};

export const DEFAULT_AUDIT_CASE = AUDIT_CASES.novapay;

export function inferAuditCase(address) {
  return Object.values(AUDIT_CASES).find((item) => item.contractAddress.toLowerCase() === address?.toLowerCase()) || null;
}
