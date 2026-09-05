import {
  Contract,
  getAddress,
  type Provider,
  type Signer,
} from "ethers";

import {
  extractReportProof,
  verifyReportLocally,
  type Hex32,
  type LocalVerificationResult,
} from "./hashing.js";

export const SEPOLIA_CHAIN_ID = 11155111;

export const ATTESTATION_ABI = [
  "function authorizedAttestor() view returns (address)",
  "function attest(bytes32 reportHash, bytes32 merkleRoot, uint8 riskScore)",
  "function verify(bytes32 reportHash) view returns (bool isVerified, bytes32 merkleRoot, uint8 riskScore, uint256 timestamp, address auditor)",
  "event Attested(bytes32 indexed reportHash, bytes32 merkleRoot, uint8 riskScore, uint256 timestamp, address indexed auditor)",
] as const;

export interface AttestReportOptions {
  report: unknown;
  signer: Signer;
  contractAddress: string;
  expectedChainId?: number;
}

export interface AttestReportResult {
  transactionHash: string;
  blockNumber: number;
  contractAddress: string;
  reportHash: Hex32;
  merkleRoot: Hex32;
  riskScore: number;
}

export interface VerifyReportOptions {
  report: unknown;
  provider: Provider;
  contractAddress: string;
  /** Team-controlled address from trusted application configuration. */
  trustedAuditor: string;
  expectedChainId?: number;
}

export interface VerifyReportResult extends LocalVerificationResult {
  isVerified: boolean;
  isAnchored: boolean;
  isMerkleRootMatch: boolean;
  isRiskScoreMatch: boolean;
  isAuditorTrusted: boolean;
  onChainTimestamp: bigint;
  onChainAuditor: string;
}

function parseContractAddress(contractAddress: string): string {
  try {
    return getAddress(contractAddress);
  } catch {
    throw new TypeError("contractAddress must be a valid EVM address");
  }
}

function parseTrustedAuditor(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("trustedAuditor must be a valid EVM address from trusted configuration");
  }
  try {
    return getAddress(value);
  } catch {
    throw new TypeError("trustedAuditor must be a valid EVM address from trusted configuration");
  }
}

async function assertExpectedNetwork(provider: Provider, expectedChainId?: number): Promise<void> {
  if (expectedChainId === undefined) return;
  if (!Number.isSafeInteger(expectedChainId) || expectedChainId <= 0) {
    throw new TypeError("expectedChainId must be a positive safe integer");
  }
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(expectedChainId)) {
    throw new Error(`Expected chain ${expectedChainId}, connected to ${network.chainId}`);
  }
}

async function assertContractCode(provider: Provider, contractAddress: string): Promise<void> {
  const code = await provider.getCode(contractAddress);
  if (code === "0x" || code === "0x0") {
    throw new Error(`no contract code at ${contractAddress}`);
  }
}

export async function attestReport(options: AttestReportOptions): Promise<AttestReportResult> {
  const { report, signer, expectedChainId } = options;
  const contractAddress = parseContractAddress(options.contractAddress);
  const provider = signer.provider;
  if (provider === null) throw new Error("signer must be connected to a provider");

  const input = extractReportProof(report);
  const local = verifyReportLocally(report);
  if (!local.isLocallyValid) {
    throw new Error("report failed local seven-step chain, manifest, reportHash or merkleRoot verification");
  }

  await assertExpectedNetwork(provider, expectedChainId ?? SEPOLIA_CHAIN_ID);
  await assertContractCode(provider, contractAddress);

  const contract = new Contract(contractAddress, ATTESTATION_ABI, signer);
  const signerAddress = getAddress(await signer.getAddress());
  const authorizedAttestor = getAddress(await contract.authorizedAttestor());
  if (signerAddress !== authorizedAttestor) {
    throw new Error(`${signerAddress} is not the contract's authorized attestor`);
  }

  const transaction = await contract.attest(input.reportHash, input.merkleRoot, input.riskScore);
  const receipt = await transaction.wait(1);
  if (receipt === null) throw new Error("attestation transaction was not mined");

  return {
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    contractAddress,
    reportHash: input.reportHash,
    merkleRoot: input.merkleRoot,
    riskScore: input.riskScore,
  };
}

export async function verifyReportOnChain(options: VerifyReportOptions): Promise<VerifyReportResult> {
  const { report, provider, expectedChainId } = options;
  const contractAddress = parseContractAddress(options.contractAddress);
  const trustedAuditor = parseTrustedAuditor(options.trustedAuditor);
  const proof = extractReportProof(report);
  const local = verifyReportLocally(report);

  await assertExpectedNetwork(provider, expectedChainId ?? SEPOLIA_CHAIN_ID);
  await assertContractCode(provider, contractAddress);

  const contract = new Contract(contractAddress, ATTESTATION_ABI, provider);
  const [isAnchored, onChainMerkleRoot, onChainRiskScore, onChainTimestamp, onChainAuditor] =
    await contract.verify(local.computedReportHash);
  const contractAttestor = getAddress(await contract.authorizedAttestor());

  const normalizedAuditor = getAddress(onChainAuditor);
  const isMerkleRootMatch = isAnchored && onChainMerkleRoot === local.computedMerkleRoot;
  const isRiskScoreMatch = isAnchored && onChainRiskScore === BigInt(proof.riskScore);
  const isAuditorTrusted =
    isAnchored &&
    contractAttestor === trustedAuditor &&
    normalizedAuditor === trustedAuditor;
  const isVerified =
    local.isLocallyValid &&
    isAnchored &&
    isMerkleRootMatch &&
    isRiskScoreMatch &&
    isAuditorTrusted;

  return {
    ...local,
    isVerified,
    isAnchored,
    isMerkleRootMatch,
    isRiskScoreMatch,
    isAuditorTrusted,
    onChainTimestamp,
    onChainAuditor: normalizedAuditor,
  };
}
