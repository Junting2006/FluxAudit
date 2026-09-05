import {
  ATTESTATION_ABI,
  SEPOLIA_CHAIN_ID,
  parseAttestationInput,
  toVerificationUiState,
  verifyReportLocally,
  verifyReportOnChain,
} from "@fluxaudit/member5-web3";
import {
  BrowserProvider,
  Contract,
  Interface,
  JsonRpcProvider,
  ZeroAddress,
  getAddress,
  isAddress,
} from "ethers";

const DEFAULT_ENV = import.meta.env ?? {};
const PLACEHOLDER_PATTERN = /replace|your[-_ ]|example|changeme/i;
const TRUSTED_RECEIPT_TIMEOUT_MS = 30_000;

export class AttestationConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "AttestationConfigError";
    this.code = "ATTESTATION_NOT_CONFIGURED";
  }
}

export class AttestationReceiptError extends Error {
  constructor(message, minedResult = null, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AttestationReceiptError";
    this.code = "ATTESTATION_EVENT_MISMATCH";
    this.minedResult = minedResult;
  }
}

export class AttestationSubmissionUnknownError extends Error {
  constructor(message, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AttestationSubmissionUnknownError";
    this.code = "ATTESTATION_SUBMISSION_UNKNOWN";
  }
}

function withExplorerLinks(result) {
  return {
    ...result,
    transactionExplorerUrl: result?.transactionHash
      ? `https://sepolia.etherscan.io/tx/${result.transactionHash}`
      : null,
    contractExplorerUrl: result?.contractAddress
      ? `https://sepolia.etherscan.io/address/${result.contractAddress}`
      : null,
  };
}

export function classifyAttestationError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (error?.minedResult) return "mined-unverified";
  if (error?.code === 4001 || error?.code === "ACTION_REJECTED") return "cancelled";
  if (error instanceof AttestationSubmissionUnknownError) return "submission-unknown";
  if (/Expected chain|Switch the connected wallet/i.test(message)) return "action-required";
  return "failed";
}

export function describeAttestationError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (error?.code === 4001 || error?.code === "ACTION_REJECTED") {
    return "Wallet request was cancelled.";
  }
  if (error instanceof AttestationConfigError) {
    return "Trusted Sepolia deployment configuration is incomplete.";
  }
  if (error instanceof AttestationSubmissionUnknownError) {
    return "The wallet request may have been broadcast, but confirmation status is unknown. Check the registry before any retry.";
  }
  if (/Expected chain|Switch the connected wallet/i.test(message)) {
    return `Connect to Sepolia (${SEPOLIA_CHAIN_ID}) and try again.`;
  }
  if (/no contract code/i.test(message)) {
    return "No attestation registry contract exists at the configured address.";
  }
  if (/authorized attestor|configured team auditor/i.test(message)) {
    return "The connected wallet is not the configured team auditor.";
  }
  if (/already contains a different record|existing registry record/i.test(message)) {
    return "A registry record already exists for this report hash but does not match the report.";
  }
  if (/local seven-step verification/i.test(message)) {
    return "The report did not pass strict local verification.";
  }
  if (/did not emit Attested|event fields do not match|transaction did not succeed|read-back/i.test(message)) {
    return error?.minedResult
      ? "The transaction was mined, but its trusted event or registry read-back could not be verified. Do not resubmit it."
      : "The confirmed transaction did not contain the expected trusted Attested event.";
  }
  if (/wallet/i.test(message) && /not found|compatible/i.test(message)) {
    return "No compatible browser wallet was found.";
  }
  return "Sepolia RPC, wallet, or registry operation could not be completed.";
}

function usableValue(value) {
  return typeof value === "string"
    && value.trim().length > 0
    && !PLACEHOLDER_PATTERN.test(value);
}

function normalizeAddress(value) {
  if (!usableValue(value) || !isAddress(value) || getAddress(value) === ZeroAddress) {
    return null;
  }
  return getAddress(value);
}

function normalizeRpcUrl(value) {
  if (!usableValue(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.hostname === "127.0.0.1" || url.hostname === "localhost"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** Trusted browser configuration only. Uploaded reports and URL parameters are never read here. */
export function getAttestationConfig(env = DEFAULT_ENV) {
  const declaredChainId = Number(env.VITE_FLUXAUDIT_CHAIN_ID || SEPOLIA_CHAIN_ID);
  const chainId = declaredChainId === SEPOLIA_CHAIN_ID ? declaredChainId : null;
  const contractAddress = normalizeAddress(env.VITE_FLUXAUDIT_CONTRACT_ADDRESS);
  const trustedAuditor = normalizeAddress(env.VITE_FLUXAUDIT_TRUSTED_AUDITOR);
  const rpcUrl = normalizeRpcUrl(env.VITE_SEPOLIA_RPC_URL);
  const deploymentConfigured = Boolean(chainId && contractAddress && trustedAuditor);
  const issues = [];

  if (!chainId) issues.push(`chain ID must be ${SEPOLIA_CHAIN_ID}`);
  if (!contractAddress) issues.push("trusted registry address is missing");
  if (!trustedAuditor) issues.push("trusted auditor address is missing");
  if (!rpcUrl) issues.push("restricted Sepolia RPC URL is missing");

  return {
    chainId: chainId || SEPOLIA_CHAIN_ID,
    contractAddress,
    trustedAuditor,
    rpcUrl,
    deploymentConfigured,
    canRead: deploymentConfigured && Boolean(rpcUrl),
    canWrite: deploymentConfigured && Boolean(rpcUrl),
    issues,
    contractExplorerUrl: contractAddress
      ? `https://sepolia.etherscan.io/address/${contractAddress}`
      : null,
  };
}

function requireReadConfig(config) {
  if (!config?.canRead) {
    throw new AttestationConfigError(config?.issues?.join("; ") || "Sepolia verification is not configured");
  }
}

function requireWriteConfig(config) {
  if (!config?.canWrite) {
    throw new AttestationConfigError(config?.issues?.join("; ") || "Sepolia attestation is not configured");
  }
}

export async function verifyReportOnSepolia(report, config = getAttestationConfig()) {
  requireReadConfig(config);
  const local = verifyReportLocally(report);
  if (!local.isLocallyValid) {
    throw new Error("Local seven-step verification must pass before checking Sepolia");
  }

  const provider = new JsonRpcProvider(config.rpcUrl);
  try {
    const result = await verifyReportOnChain({
      report,
      provider,
      contractAddress: config.contractAddress,
      trustedAuditor: config.trustedAuditor,
      expectedChainId: config.chainId,
    });
    return { result, ui: toVerificationUiState(result) };
  } finally {
    provider.destroy();
  }
}

/** A cached chain result is green only for the exact report currently verified locally. */
export function isCurrentVerifiedChainResult(localVerification, chainCheck) {
  const reportHash = localVerification?.computedReportHash;
  return Boolean(
    localVerification?.isLocallyValid
    && reportHash
    && chainCheck?.status === "complete"
    && chainCheck?.ui?.code === "VERIFIED"
    && chainCheck.reportHash === reportHash
    && chainCheck.result?.computedReportHash === reportHash,
  );
}

export function isCurrentAnchorResult(localVerification, declaredReportHash, anchorResult) {
  return Boolean(
    localVerification?.isLocallyValid
    && declaredReportHash
    && localVerification.computedReportHash === declaredReportHash
    && anchorResult?.reportHash === declaredReportHash,
  );
}

export function confirmAttestedReceipt(receipt, anchored, trustedAuditor) {
  const minedResult = withExplorerLinks(anchored);
  if (!receipt || receipt.status !== 1) {
    throw new AttestationReceiptError("The attestation transaction did not succeed", minedResult);
  }

  const contractAddress = getAddress(anchored.contractAddress);
  const expectedAuditor = getAddress(trustedAuditor);
  const contractInterface = new Interface(ATTESTATION_ABI);
  let attestedEvent = null;

  for (const log of receipt.logs || []) {
    if (!isAddress(log.address) || getAddress(log.address) !== contractAddress) continue;
    try {
      const parsed = contractInterface.parseLog(log);
      if (parsed?.name === "Attested") {
        attestedEvent = parsed;
        break;
      }
    } catch {
      // Ignore unrelated logs from the same transaction.
    }
  }

  if (!attestedEvent) {
    throw new AttestationReceiptError(
      "Confirmed transaction did not emit Attested from the trusted registry",
      minedResult,
    );
  }

  const { reportHash, merkleRoot, riskScore, timestamp, auditor } = attestedEvent.args;
  const matches = reportHash === anchored.reportHash
    && merkleRoot === anchored.merkleRoot
    && riskScore === BigInt(anchored.riskScore)
    && timestamp > 0n
    && getAddress(auditor) === expectedAuditor
    && receipt.hash === anchored.transactionHash
    && receipt.blockNumber === anchored.blockNumber;

  if (!matches) {
    throw new AttestationReceiptError(
      "Attested event fields do not match the locally verified report",
      minedResult,
    );
  }

  return {
    reportHash,
    merkleRoot,
    riskScore: Number(riskScore),
    timestamp,
    auditor: getAddress(auditor),
  };
}

/** Team-attestor write path. Wallet access occurs only after this function is called by a user action. */
export async function anchorReportWithBrowserWallet(
  report,
  walletProvider = globalThis.window?.ethereum,
  config = getAttestationConfig(),
  options = {},
) {
  requireWriteConfig(config);
  if (!walletProvider || typeof walletProvider.request !== "function") {
    throw new Error("No compatible browser wallet was found");
  }

  const local = verifyReportLocally(report);
  if (!local.isLocallyValid) {
    throw new Error("Local seven-step verification must pass before attestation");
  }

  const accounts = await walletProvider.request({ method: "eth_requestAccounts" });
  const selectedAccount = Array.isArray(accounts) ? accounts[0] : null;
  if (!selectedAccount || getAddress(selectedAccount) !== config.trustedAuditor) {
    throw new Error("Connected wallet is not the configured team auditor");
  }

  const currentChainId = await walletProvider.request({ method: "eth_chainId" });
  if (Number(BigInt(currentChainId)) !== config.chainId) {
    throw new Error(`Switch the connected wallet to Sepolia (${config.chainId}) and try again`);
  }

  const provider = new BrowserProvider(walletProvider);
  const signer = await provider.getSigner();
  const signerAddress = getAddress(await signer.getAddress());
  if (signerAddress !== config.trustedAuditor) {
    throw new Error("Connected wallet is no longer the configured team auditor");
  }
  const receiptTimeoutMs = Number.isSafeInteger(options.receiptTimeoutMs)
    && options.receiptTimeoutMs > 0
    ? options.receiptTimeoutMs
    : TRUSTED_RECEIPT_TIMEOUT_MS;
  const trustedProvider = new JsonRpcProvider(config.rpcUrl);
  try {
    const registry = new Contract(config.contractAddress, ATTESTATION_ABI, trustedProvider);
    const contractAttestor = getAddress(await registry.authorizedAttestor());
    if (contractAttestor !== config.trustedAuditor) {
      throw new Error("Trusted registry authorized attestor does not match the configured team auditor");
    }

    const existing = await verifyReportOnChain({
      report,
      provider: trustedProvider,
      contractAddress: config.contractAddress,
      trustedAuditor: config.trustedAuditor,
      expectedChainId: config.chainId,
    });
    if (existing.isAnchored) {
      if (!existing.isVerified) {
        const mismatch = new Error("Existing registry record already contains a different record for this report");
        mismatch.code = "ATTESTATION_EXISTING_MISMATCH";
        throw mismatch;
      }
      return {
        alreadyAnchored: true,
        transactionHash: null,
        blockNumber: null,
        contractAddress: config.contractAddress,
        reportHash: existing.computedReportHash,
        merkleRoot: existing.computedMerkleRoot,
        riskScore: report.summary.overall_risk_score,
        onChainTimestamp: existing.onChainTimestamp,
        verification: existing,
        transactionExplorerUrl: null,
        contractExplorerUrl: config.contractExplorerUrl,
      };
    }

    const submissionAccounts = await walletProvider.request({ method: "eth_accounts" });
    const submissionAccount = Array.isArray(submissionAccounts) ? submissionAccounts[0] : null;
    if (!submissionAccount || getAddress(submissionAccount) !== config.trustedAuditor) {
      throw new Error("Connected wallet is no longer the configured team auditor");
    }
    const submissionChainId = await walletProvider.request({ method: "eth_chainId" });
    if (Number(BigInt(submissionChainId)) !== config.chainId) {
      throw new Error(`Switch the connected wallet to Sepolia (${config.chainId}) and try again`);
    }

    const input = parseAttestationInput(report);
    const writableRegistry = new Contract(config.contractAddress, ATTESTATION_ABI, signer);
    let transaction;
    try {
      transaction = await writableRegistry.attest(
        input.reportHash,
        input.merkleRoot,
        input.riskScore,
      );
    } catch (error) {
      if (error?.code === 4001 || error?.code === "ACTION_REJECTED") throw error;

      // The wallet may fail after broadcasting without returning a transaction
      // hash. Only the configured RPC is allowed to reconcile that ambiguity.
      try {
        const reconciliation = await verifyReportOnChain({
          report,
          provider: trustedProvider,
          contractAddress: config.contractAddress,
          trustedAuditor: config.trustedAuditor,
          expectedChainId: config.chainId,
        });
        if (reconciliation.isVerified) {
          return {
            alreadyAnchored: true,
            transactionHash: null,
            blockNumber: null,
            contractAddress: config.contractAddress,
            reportHash: reconciliation.computedReportHash,
            merkleRoot: reconciliation.computedMerkleRoot,
            riskScore: report.summary.overall_risk_score,
            onChainTimestamp: reconciliation.onChainTimestamp,
            verification: reconciliation,
            transactionExplorerUrl: null,
            contractExplorerUrl: config.contractExplorerUrl,
          };
        }
      } catch {
        // The original submission error remains the important uncertainty.
      }
      throw new AttestationSubmissionUnknownError(
        "Attestation submission or confirmation status is unknown",
        error,
      );
    }

    let receipt;
    try {
      receipt = await trustedProvider.waitForTransaction(transaction.hash, 1, receiptTimeoutMs);
    } catch (error) {
      // A returned hash proves submission, but not confirmation. Reconcile only
      // against the configured RPC and never turn this path green without both
      // its receipt event and registry state.
      try {
        const reconciliation = await verifyReportOnChain({
          report,
          provider: trustedProvider,
          contractAddress: config.contractAddress,
          trustedAuditor: config.trustedAuditor,
          expectedChainId: config.chainId,
        });
        const reconciledReceipt = await trustedProvider.getTransactionReceipt(transaction.hash);
        if (reconciliation.isVerified && reconciledReceipt) {
          receipt = reconciledReceipt;
        }
      } catch {
        // Fall through to the conservative unknown state below.
      }
      if (!receipt) {
        throw new AttestationSubmissionUnknownError(
          "Attestation submission or confirmation status is unknown",
          error,
        );
      }
    }

    const anchored = {
      transactionHash: transaction.hash,
      blockNumber: receipt.blockNumber,
      contractAddress: config.contractAddress,
      reportHash: input.reportHash,
      merkleRoot: input.merkleRoot,
      riskScore: input.riskScore,
    };
    const minedResult = withExplorerLinks(anchored);

    try {
      const event = confirmAttestedReceipt(receipt, anchored, config.trustedAuditor);
      const verification = await verifyReportOnChain({
        report,
        provider: trustedProvider,
        contractAddress: config.contractAddress,
        trustedAuditor: config.trustedAuditor,
        expectedChainId: config.chainId,
      });
      if (!verification.isVerified) {
        throw new AttestationReceiptError(
          "Mined attestation failed trusted registry read-back verification",
          minedResult,
        );
      }
      return {
        ...minedResult,
        alreadyAnchored: false,
        event,
        verification,
      };
    } catch (error) {
      if (error instanceof AttestationReceiptError) throw error;
      throw new AttestationReceiptError(
        "Mined attestation could not complete trusted event and registry read-back verification",
        minedResult,
        error,
      );
    }
  } finally {
    trustedProvider.destroy();
  }
}

export function subscribeToWalletContext(walletProvider, onChange) {
  if (!walletProvider?.on || !walletProvider?.removeListener) return () => {};
  const reset = () => onChange?.();
  walletProvider.on("accountsChanged", reset);
  walletProvider.on("chainChanged", reset);
  return () => {
    walletProvider.removeListener("accountsChanged", reset);
    walletProvider.removeListener("chainChanged", reset);
  };
}
