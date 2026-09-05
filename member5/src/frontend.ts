import type { VerifyReportResult } from "./attestation.js";

export const MAX_REPORT_JSON_BYTES = 10 * 1024 * 1024;

export type VerificationUiCode =
  | "VERIFIED"
  | "REPORT_HASH_MISMATCH"
  | "REASONING_PROOF_MISMATCH"
  | "NOT_ANCHORED"
  | "ONCHAIN_RECORD_MISMATCH"
  | "UNTRUSTED_AUDITOR"
  | "INCONSISTENT_RESULT";

export interface VerificationUiState {
  code: VerificationUiCode;
  tone: "success" | "warning" | "danger";
  title: string;
  detail: string;
}

/**
 * Converts low-level proof checks into mutually exclusive UI states.
 * The order is security-sensitive: a local mismatch always wins over a green status.
 */
export function toVerificationUiState(result: VerifyReportResult): VerificationUiState {
  if (!result.isReportHashValid) {
    return {
      code: "REPORT_HASH_MISMATCH",
      tone: "danger",
      title: "报告内容已变化",
      detail: "当前报告重新计算出的 reportHash 与报告声明值不一致。",
    };
  }
  if (!result.isStepChainValid || !result.isManifestValid || !result.isMerkleRootValid || !result.isLocallyValid) {
    return {
      code: "REASONING_PROOF_MISMATCH",
      tone: "danger",
      title: "推理证明不一致",
      detail: "七步输入输出、连续哈希链、证明清单或全部步骤的 Merkle Root 校验失败。",
    };
  }
  if (!result.isAnchored) {
    return {
      code: "NOT_ANCHORED",
      tone: "warning",
      title: "尚未找到链上记录",
      detail: "报告本地完整性通过，但可信 Sepolia 合约中没有对应的 reportHash。",
    };
  }
  if (!result.isMerkleRootMatch || !result.isRiskScoreMatch) {
    return {
      code: "ONCHAIN_RECORD_MISMATCH",
      tone: "danger",
      title: "链上记录不一致",
      detail: "链上的 Merkle Root 或风险分与当前报告不一致。",
    };
  }
  if (!result.isAuditorTrusted) {
    return {
      code: "UNTRUSTED_AUDITOR",
      tone: "danger",
      title: "发布钱包不可信",
      detail: "记录钱包或合约授权钱包不是团队配置的 trustedAuditor。",
    };
  }
  if (result.isVerified) {
    return {
      code: "VERIFIED",
      tone: "success",
      title: "链上验证通过",
      detail: "报告正文、推理证明、链上记录和团队审计钱包全部一致。",
    };
  }
  return {
    code: "INCONSISTENT_RESULT",
    tone: "danger",
    title: "验证状态异常",
    detail: "检查项组合不完整，请停止展示 VERIFIED 并联系成员 5。",
  };
}

export type FrontendInputErrorCode =
  | "INVALID_FILE"
  | "UNSUPPORTED_FILE"
  | "FILE_TOO_LARGE"
  | "FILE_READ_FAILED"
  | "INVALID_JSON";

export class FluxAuditFrontendError extends Error {
  readonly code: FrontendInputErrorCode;

  constructor(code: FrontendInputErrorCode, message: string) {
    super(message);
    this.name = "FluxAuditFrontendError";
    this.code = code;
  }
}

/** Structural subset shared by browser File objects and test fixtures. */
export interface ReportJsonFileLike {
  name: string;
  size: number;
  text(): Promise<string>;
}

/** Reads exported report JSON. Verification requires the seven-step manifest protocol. */
export async function parseReportJsonFile(file: ReportJsonFileLike): Promise<unknown> {
  if (
    file === null ||
    typeof file !== "object" ||
    typeof file.name !== "string" ||
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    typeof file.text !== "function"
  ) {
    throw new FluxAuditFrontendError("INVALID_FILE", "请选择有效的报告 JSON 文件");
  }
  if (!file.name.toLowerCase().endsWith(".json")) {
    throw new FluxAuditFrontendError(
      "UNSUPPORTED_FILE",
      "当前链上验伪只接受导出的报告 JSON，不直接接受 PDF",
    );
  }
  if (file.size > MAX_REPORT_JSON_BYTES) {
    throw new FluxAuditFrontendError("FILE_TOO_LARGE", "报告 JSON 不能超过 10 MB");
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new FluxAuditFrontendError("FILE_READ_FAILED", "无法读取报告文件");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new FluxAuditFrontendError("INVALID_JSON", "报告文件不是有效 JSON");
  }
}
