import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ATTESTATION_ABI,
  computeReportHash,
  merkleRoot,
  verifyReportLocally,
} from "@fluxaudit/member5-web3";
import { Interface } from "ethers";
import {
  AttestationSubmissionUnknownError,
  anchorReportWithBrowserWallet,
  classifyAttestationError,
  confirmAttestedReceipt,
  describeAttestationError,
  getAttestationConfig,
  isCurrentAnchorResult,
  isCurrentVerifiedChainResult,
} from "../src/lib/attestationClient.js";
import {
  canonicalJson,
  computeReportPayloadHash,
  hashCanonicalValue,
  hashStep,
  parseAuditReportJson,
  verifyAuditReport,
} from "../src/lib/proof.js";

function fixture(name = "seven-step-report.json") {
  return JSON.parse(
    readFileSync(new URL(`../../member5/fixtures/${name}`, import.meta.url), "utf8"),
  );
}

async function withJsonRpcServer(handleMethod, run) {
  const methods = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const payloads = Array.isArray(body) ? body : [body];
    const replies = payloads.map((payload) => {
      methods.push(payload.method);
      try {
        return {
          jsonrpc: "2.0",
          id: payload.id,
          result: handleMethod(payload.method, payload.params || []),
        };
      } catch (error) {
        return {
          jsonrpc: "2.0",
          id: payload.id,
          error: { code: -32601, message: error.message },
        };
      }
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(Array.isArray(body) ? replies : replies[0]));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    return await run(`http://127.0.0.1:${address.port}`, methods);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function createSubmissionWallet({ trustedAuditor, contractAddress, transactionHash, onSubmit }) {
  const methods = [];
  let submittedTransaction = null;
  return {
    methods,
    wallet: {
      request: async ({ method, params = [] }) => {
        methods.push(method);
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [trustedAuditor];
        if (method === "eth_chainId") return "0xaa36a7";
        if (method === "eth_blockNumber") return "0x29";
        if (method === "eth_estimateGas") return "0x186a0";
        if (method === "eth_sendTransaction") {
          submittedTransaction = params[0];
          onSubmit?.();
          return transactionHash;
        }
        if (method === "eth_getTransactionByHash") {
          if (!submittedTransaction) return null;
          return {
            hash: transactionHash,
            type: "0x2",
            accessList: [],
            blockHash: null,
            blockNumber: null,
            transactionIndex: null,
            from: trustedAuditor,
            gas: submittedTransaction.gas || "0x186a0",
            gasPrice: null,
            maxPriorityFeePerGas: "0x3b9aca00",
            maxFeePerGas: "0x77359400",
            input: submittedTransaction.data,
            nonce: "0x0",
            to: contractAddress,
            value: "0x0",
            chainId: "0xaa36a7",
            yParity: "0x0",
            r: `0x${"55".repeat(32)}`,
            s: `0x${"66".repeat(32)}`,
          };
        }
        throw new Error(`unexpected wallet submission method ${method}`);
      },
    },
  };
}

function resignReport(report) {
  const steps = report.proof_data.steps;
  const payloadHash = computeReportPayloadHash(report);
  let previousStepHash = `0x${"0".repeat(64)}`;
  const signStep = (step) => {
    step.task_id = report.task_id;
    step.input_hash = hashCanonicalValue(step.input);
    step.output_hash = hashCanonicalValue(step.output);
    step.hash_content = canonicalJson({
      task_id: step.task_id,
      step_index: step.step_index,
      source: step.source,
      agent: step.agent,
      current_step: step.current_step,
      message: step.message,
      evidence: step.evidence,
      input_hash: step.input_hash,
      output_hash: step.output_hash,
    });
    step.previous_step_hash = previousStepHash;
    step.step_hash = hashStep(previousStepHash, step.hash_content, step.timestamp_ms);
    previousStepHash = step.step_hash;
  };
  for (const step of steps.slice(0, 6)) {
    signStep(step);
  }

  steps[6].input = {
    ordered_prior_step_hashes: steps.slice(0, 6).map((step) => step.step_hash),
    report_payload_hash: payloadHash,
  };
  steps[6].output = {
    manifest_version: "proof-manifest-v1",
    hash_algorithm: "ethereum-keccak256",
    hash_version: "keccak-v1",
    ordered_steps: [
      "INPUT_VALIDATED",
      "CHAIN_FETCHED",
      "DOC_PARSING",
      "CROSS_CHECKING",
      "RISK_SCORING",
      "REPORT_ASSEMBLED",
      "PROOF_MANIFEST_COMPILED",
    ],
    prior_step_count: 6,
    final_step_count: 7,
    report_payload_hash: payloadHash,
  };
  signStep(steps[6]);

  const stepHashes = steps.map((step) => step.step_hash);
  report.proof_data.step_hashes = stepHashes;
  report.proof_data.reasoning_step_hashes = steps
    .filter((step) => step.source === "AI")
    .map((step) => step.step_hash);
  report.proof_data.backend_step_hashes = steps
    .filter((step) => step.source === "BACKEND")
    .map((step) => step.step_hash);
  report.proof_data.manifest_step_hash = steps[6].step_hash;
  report.proof_data.report_payload_hash = payloadHash;
  report.proof_data.merkle_root = merkleRoot(stepHashes);
  report.proof_data.report_hash = computeReportHash(report);
  return report;
}

test("member 5 SDK is the authoritative gate for the seven-step report", () => {
  const report = fixture();
  const sdk = verifyReportLocally(report);
  const diagnostics = verifyAuditReport(report);

  assert.equal(sdk.isLocallyValid, true);
  assert.equal(diagnostics.valid, true);
  assert.equal(diagnostics.isReportHashValid, true);
  assert.equal(diagnostics.isStepChainValid, true);
  assert.equal(diagnostics.isManifestValid, true);
  assert.equal(diagnostics.isMerkleRootValid, true);
  assert.equal(diagnostics.computedReportHash, sdk.computedReportHash);
  assert.equal(diagnostics.computedMerkleRoot, sdk.computedMerkleRoot);
});

test("canonical numbers follow JSON value semantics and Python exponent formatting", () => {
  assert.equal(canonicalJson(parseAuditReportJson('{"value":0.500}').report), '{"value":0.5}');
  assert.equal(canonicalJson(parseAuditReportJson('{"value":5e-1}').report), '{"value":0.5}');
  assert.equal(canonicalJson(parseAuditReportJson('{"value":1e-5}').report), '{"value":1e-05}');
  assert.equal(verifyReportLocally(fixture("fractional-report.json")).isLocallyValid, true);
});

test("malformed supported reports fail closed without throwing or partial success", () => {
  const report = fixture();
  delete report.proof_data.steps[2].agent;

  const result = verifyAuditReport(report);
  assert.equal(result.valid, false);
  assert.equal(result.protocolSupported, true);
  assert.equal(result.isReportHashValid, false);
  assert.equal(result.stepsPassed, 0);
  assert.match(result.verificationError, /agent must be a string/);
});

test("an otherwise self-consistent proof with an empty task ID remains ineligible", () => {
  const report = fixture();
  report.task_id = "";
  resignReport(report);

  const sdk = verifyReportLocally(report);
  const diagnostics = verifyAuditReport(report);
  assert.equal(sdk.isReportHashValid, true);
  assert.equal(sdk.isMerkleRootValid, true);
  assert.equal(sdk.isManifestValid, true);
  assert.equal(sdk.isStepChainValid, false);
  assert.equal(sdk.isLocallyValid, false);
  assert.equal(diagnostics.valid, false);
  assert.equal(diagnostics.firstMismatch?.reason, "task_id");
});

test("a missing manifest cannot be hidden by refreshing the outer report hash", () => {
  const report = fixture();
  report.summary.overall_risk_score = 10;
  report.proof_data.manifest_step_hash = "";
  report.proof_data.report_hash = computeReportHash(report);

  const sdk = verifyReportLocally(report);
  const diagnostics = verifyAuditReport(report);
  assert.equal(sdk.isReportHashValid, true);
  assert.equal(sdk.isManifestValid, false);
  assert.equal(sdk.isLocallyValid, false);
  assert.equal(diagnostics.valid, false);
  assert.equal(diagnostics.isManifestValid, false);
});

test("tampering any one of the seven steps stays red even after refreshing the outer hash", () => {
  for (let index = 0; index < 7; index += 1) {
    const report = fixture();
    report.proof_data.steps[index].message += " altered";
    report.proof_data.report_hash = computeReportHash(report);

    const sdk = verifyReportLocally(report);
    const diagnostics = verifyAuditReport(report);
    assert.equal(sdk.isReportHashValid, true, `step ${index} outer report hash`);
    assert.equal(sdk.isStepChainValid, false, `step ${index} chain gate`);
    assert.equal(sdk.isLocallyValid, false, `step ${index} SDK gate`);
    assert.equal(diagnostics.valid, false, `step ${index} UI gate`);
  }
});

test("a self-consistent one-step proof is never accepted as the seven-step protocol", () => {
  const report = fixture();
  const firstStep = report.proof_data.steps[0];
  report.proof_data.steps = [firstStep];
  report.proof_data.step_hashes = [firstStep.step_hash];
  report.proof_data.reasoning_step_hashes = [];
  report.proof_data.backend_step_hashes = [firstStep.step_hash];
  report.proof_data.manifest_step_hash = "";
  report.proof_data.merkle_root = merkleRoot(report.proof_data.step_hashes);
  report.proof_data.report_hash = computeReportHash(report);

  assert.equal(verifyReportLocally(report).isLocallyValid, false);
  assert.equal(verifyAuditReport(report).valid, false);
});

test("tampered and legacy fixtures never produce a local green state", () => {
  assert.equal(verifyReportLocally(fixture("tampered-report.json")).isLocallyValid, false);
  assert.equal(verifyAuditReport(fixture("tampered-report.json")).valid, false);
  assert.throws(() => verifyReportLocally(fixture("legacy-report.json")), /unsupported proof protocol/);
  assert.equal(verifyAuditReport(fixture("legacy-report.json")).valid, false);
});

test("attestation configuration fails closed until every trusted public value exists", () => {
  const missing = getAttestationConfig({});
  assert.equal(missing.deploymentConfigured, false);
  assert.equal(missing.canRead, false);
  assert.equal(missing.canWrite, false);

  const placeholders = getAttestationConfig({
    VITE_FLUXAUDIT_CHAIN_ID: "11155111",
    VITE_FLUXAUDIT_CONTRACT_ADDRESS: "0x_REPLACE_AFTER_SEPOLIA_DEPLOYMENT",
    VITE_FLUXAUDIT_TRUSTED_AUDITOR: "0x_REPLACE_WITH_TEAM_AUDITOR",
    VITE_SEPOLIA_RPC_URL: "https://REPLACE_WITH_RESTRICTED_TEST_RPC",
  });
  assert.equal(placeholders.canRead, false);

  const missingRpc = getAttestationConfig({
    VITE_FLUXAUDIT_CHAIN_ID: "11155111",
    VITE_FLUXAUDIT_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000011",
    VITE_FLUXAUDIT_TRUSTED_AUDITOR: "0x0000000000000000000000000000000000000022",
  });
  assert.equal(missingRpc.deploymentConfigured, true);
  assert.equal(missingRpc.canRead, false);
  assert.equal(missingRpc.canWrite, false);
  assert.match(missingRpc.issues.join("; "), /restricted Sepolia RPC URL/);

  const ready = getAttestationConfig({
    VITE_FLUXAUDIT_CHAIN_ID: "11155111",
    VITE_FLUXAUDIT_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000011",
    VITE_FLUXAUDIT_TRUSTED_AUDITOR: "0x0000000000000000000000000000000000000022",
    VITE_SEPOLIA_RPC_URL: "https://rpc.sepolia.invalid",
  });
  assert.equal(ready.deploymentConfigured, true);
  assert.equal(ready.canRead, true);
  assert.equal(ready.canWrite, true);
});

test("the wallet write path fails before signing when configuration or network is wrong", async () => {
  const trustedAuditor = "0x0000000000000000000000000000000000000022";
  const calls = [];
  const wallet = {
    request: async ({ method }) => {
      calls.push(method);
      if (method === "eth_requestAccounts") return [trustedAuditor];
      if (method === "eth_chainId") return "0x1";
      throw new Error(`unexpected wallet method ${method}`);
    },
  };

  await assert.rejects(
    anchorReportWithBrowserWallet(fixture(), wallet, getAttestationConfig({})),
    /missing|configured/i,
  );
  assert.deepEqual(calls, []);

  const configured = getAttestationConfig({
    VITE_FLUXAUDIT_CHAIN_ID: "11155111",
    VITE_FLUXAUDIT_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000011",
    VITE_FLUXAUDIT_TRUSTED_AUDITOR: trustedAuditor,
    VITE_SEPOLIA_RPC_URL: "https://rpc.sepolia.invalid",
  });
  await assert.rejects(
    anchorReportWithBrowserWallet(fixture(), wallet, configured),
    /Switch the connected wallet to Sepolia/,
  );
  assert.deepEqual(calls, ["eth_requestAccounts", "eth_chainId"]);
  assert.equal(describeAttestationError(new Error("secret RPC detail")), "Sepolia RPC, wallet, or registry operation could not be completed.");

  const unknown = new AttestationSubmissionUnknownError("provider disconnected after submit");
  assert.equal(classifyAttestationError(unknown), "submission-unknown");
  assert.match(describeAttestationError(unknown), /status is unknown.*before any retry/i);
});

test("write preflight and authorized-attestor reads use the configured RPC, not the wallet provider", async () => {
  const report = fixture();
  const local = verifyReportLocally(report);
  const contractAddress = "0x0000000000000000000000000000000000000011";
  const trustedAuditor = "0x0000000000000000000000000000000000000022";
  const contractInterface = new Interface(ATTESTATION_ABI);
  const walletMethods = [];
  const wallet = {
    request: async ({ method }) => {
      walletMethods.push(method);
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [trustedAuditor];
      if (method === "eth_chainId") return "0xaa36a7";
      throw new Error(`wallet provider must not handle trusted read method ${method}`);
    },
  };

  await withJsonRpcServer((method, params) => {
    if (method === "eth_chainId") return "0xaa36a7";
    if (method === "eth_getCode") return "0x6000";
    if (method === "eth_call") {
      const data = params[0]?.data;
      if (data === contractInterface.getFunction("authorizedAttestor").selector) {
        return contractInterface.encodeFunctionResult("authorizedAttestor", [trustedAuditor]);
      }
      if (data?.startsWith(contractInterface.getFunction("verify").selector)) {
        return contractInterface.encodeFunctionResult("verify", [
          true,
          local.computedMerkleRoot,
          report.summary.overall_risk_score,
          1_788_576_928,
          trustedAuditor,
        ]);
      }
    }
    throw new Error(`unexpected trusted RPC method ${method}`);
  }, async (rpcUrl, trustedMethods) => {
    const config = getAttestationConfig({
      VITE_FLUXAUDIT_CHAIN_ID: "11155111",
      VITE_FLUXAUDIT_CONTRACT_ADDRESS: contractAddress,
      VITE_FLUXAUDIT_TRUSTED_AUDITOR: trustedAuditor,
      VITE_SEPOLIA_RPC_URL: rpcUrl,
    });

    const result = await anchorReportWithBrowserWallet(report, wallet, config);
    assert.equal(result.alreadyAnchored, true);
    assert.equal(result.reportHash, local.computedReportHash);
    assert.ok(trustedMethods.includes("eth_getCode"));
    assert.ok(trustedMethods.filter((method) => method === "eth_call").length >= 2);
  });

  assert.ok(walletMethods.includes("eth_requestAccounts"));
  assert.ok(walletMethods.includes("eth_accounts"));
  assert.ok(walletMethods.every((method) => ["eth_requestAccounts", "eth_accounts", "eth_chainId"].includes(method)));
});

test("a new write is confirmed from the configured RPC receipt and read-back", async () => {
  const report = fixture();
  const local = verifyReportLocally(report);
  const contractAddress = "0x0000000000000000000000000000000000000011";
  const trustedAuditor = "0x0000000000000000000000000000000000000022";
  const transactionHash = `0x${"33".repeat(32)}`;
  const blockHash = `0x${"44".repeat(32)}`;
  const contractInterface = new Interface(ATTESTATION_ABI);
  const encodedEvent = contractInterface.encodeEventLog("Attested", [
    local.computedReportHash,
    local.computedMerkleRoot,
    report.summary.overall_risk_score,
    1_788_576_928,
    trustedAuditor,
  ]);
  let anchored = false;
  const { wallet, methods: walletMethods } = createSubmissionWallet({
    trustedAuditor,
    contractAddress,
    transactionHash,
    onSubmit: () => { anchored = true; },
  });

  await withJsonRpcServer((method, params) => {
    if (method === "eth_chainId") return "0xaa36a7";
    if (method === "eth_blockNumber") return "0x2a";
    if (method === "eth_getCode") return "0x6000";
    if (method === "eth_call") {
      const data = params[0]?.data;
      if (data === contractInterface.getFunction("authorizedAttestor").selector) {
        return contractInterface.encodeFunctionResult("authorizedAttestor", [trustedAuditor]);
      }
      if (data?.startsWith(contractInterface.getFunction("verify").selector)) {
        return contractInterface.encodeFunctionResult("verify", anchored
          ? [
            true,
            local.computedMerkleRoot,
            report.summary.overall_risk_score,
            1_788_576_928,
            trustedAuditor,
          ]
          : [false, `0x${"00".repeat(32)}`, 0, 0, "0x0000000000000000000000000000000000000000"]);
      }
    }
    if (method === "eth_getTransactionReceipt") {
      if (!anchored) return null;
      return {
        transactionHash,
        transactionIndex: "0x0",
        blockHash,
        blockNumber: "0x2a",
        from: trustedAuditor,
        to: contractAddress,
        cumulativeGasUsed: "0x5208",
        gasUsed: "0x5208",
        contractAddress: null,
        logsBloom: `0x${"00".repeat(256)}`,
        effectiveGasPrice: "0x3b9aca00",
        status: "0x1",
        type: "0x2",
        logs: [{
          address: contractAddress,
          topics: encodedEvent.topics,
          data: encodedEvent.data,
          blockNumber: "0x2a",
          transactionHash,
          transactionIndex: "0x0",
          blockHash,
          logIndex: "0x0",
          removed: false,
        }],
      };
    }
    throw new Error(`unexpected trusted RPC method ${method}`);
  }, async (rpcUrl, trustedMethods) => {
    const config = getAttestationConfig({
      VITE_FLUXAUDIT_CHAIN_ID: "11155111",
      VITE_FLUXAUDIT_CONTRACT_ADDRESS: contractAddress,
      VITE_FLUXAUDIT_TRUSTED_AUDITOR: trustedAuditor,
      VITE_SEPOLIA_RPC_URL: rpcUrl,
    });

    const result = await anchorReportWithBrowserWallet(report, wallet, config);
    assert.equal(result.alreadyAnchored, false);
    assert.equal(result.transactionHash, transactionHash);
    assert.equal(result.blockNumber, 42);
    assert.equal(result.verification.isVerified, true);
    assert.ok(trustedMethods.includes("eth_getTransactionReceipt"));
    assert.ok(trustedMethods.filter((method) => method === "eth_call").length >= 4);
  });

  assert.ok(walletMethods.includes("eth_sendTransaction"));
  assert.ok(!walletMethods.includes("eth_call"));
  assert.ok(!walletMethods.includes("eth_getCode"));
  assert.ok(!walletMethods.includes("eth_getTransactionReceipt"));
});

test("a configured-RPC receipt timeout becomes submission-unknown", async () => {
  const report = fixture();
  const contractAddress = "0x0000000000000000000000000000000000000011";
  const trustedAuditor = "0x0000000000000000000000000000000000000022";
  const transactionHash = `0x${"77".repeat(32)}`;
  const contractInterface = new Interface(ATTESTATION_ABI);
  const { wallet } = createSubmissionWallet({
    trustedAuditor,
    contractAddress,
    transactionHash,
  });

  await withJsonRpcServer((method, params) => {
    if (method === "eth_chainId") return "0xaa36a7";
    if (method === "eth_blockNumber") return "0x2a";
    if (method === "eth_getCode") return "0x6000";
    if (method === "eth_getTransactionReceipt") return null;
    if (method === "eth_call") {
      const data = params[0]?.data;
      if (data === contractInterface.getFunction("authorizedAttestor").selector) {
        return contractInterface.encodeFunctionResult("authorizedAttestor", [trustedAuditor]);
      }
      if (data?.startsWith(contractInterface.getFunction("verify").selector)) {
        return contractInterface.encodeFunctionResult("verify", [
          false,
          `0x${"00".repeat(32)}`,
          0,
          0,
          "0x0000000000000000000000000000000000000000",
        ]);
      }
    }
    throw new Error(`unexpected trusted RPC method ${method}`);
  }, async (rpcUrl) => {
    const config = getAttestationConfig({
      VITE_FLUXAUDIT_CHAIN_ID: "11155111",
      VITE_FLUXAUDIT_CONTRACT_ADDRESS: contractAddress,
      VITE_FLUXAUDIT_TRUSTED_AUDITOR: trustedAuditor,
      VITE_SEPOLIA_RPC_URL: rpcUrl,
    });

    await assert.rejects(
      anchorReportWithBrowserWallet(report, wallet, config, { receiptTimeoutMs: 10 }),
      (error) => error instanceof AttestationSubmissionUnknownError
        && classifyAttestationError(error) === "submission-unknown",
    );
  });
});

test("a chain green state is bound to the exact locally verified report hash", () => {
  const local = verifyReportLocally(fixture());
  const current = {
    status: "complete",
    reportHash: local.computedReportHash,
    ui: { code: "VERIFIED" },
    result: { computedReportHash: local.computedReportHash },
  };
  assert.equal(isCurrentVerifiedChainResult(local, current), true);
  assert.equal(isCurrentVerifiedChainResult({ ...local, isLocallyValid: false }, current), false);
  assert.equal(isCurrentVerifiedChainResult(local, {
    ...current,
    reportHash: `0x${"77".repeat(32)}`,
  }), false);
  assert.equal(isCurrentVerifiedChainResult(local, {
    ...current,
    result: { computedReportHash: `0x${"88".repeat(32)}` },
  }), false);
});

test("an anchor result cannot stay green after content tampering preserves the declared hash", () => {
  const report = fixture();
  const valid = verifyAuditReport(report);
  const anchorResult = { reportHash: report.proof_data.report_hash };
  assert.equal(isCurrentAnchorResult(valid, report.proof_data.report_hash, anchorResult), true);

  report.summary.verdict += " altered";
  const tampered = verifyAuditReport(report);
  assert.equal(tampered.isLocallyValid, false);
  assert.notEqual(tampered.computedReportHash, report.proof_data.report_hash);
  assert.equal(
    isCurrentAnchorResult(tampered, report.proof_data.report_hash, anchorResult),
    false,
  );
});

test("a write is accepted only when the confirmed receipt contains the matching Attested event", () => {
  const contractAddress = "0x0000000000000000000000000000000000000011";
  const trustedAuditor = "0x0000000000000000000000000000000000000022";
  const reportHash = `0x${"11".repeat(32)}`;
  const merkleRootHash = `0x${"22".repeat(32)}`;
  const transactionHash = `0x${"33".repeat(32)}`;
  const contractInterface = new Interface(ATTESTATION_ABI);
  const encoded = contractInterface.encodeEventLog("Attested", [
    reportHash,
    merkleRootHash,
    85,
    1_788_576_928,
    trustedAuditor,
  ]);
  const anchored = {
    contractAddress,
    reportHash,
    merkleRoot: merkleRootHash,
    riskScore: 85,
    transactionHash,
    blockNumber: 42,
  };
  const receipt = {
    status: 1,
    hash: transactionHash,
    blockNumber: 42,
    logs: [{ address: contractAddress, topics: encoded.topics, data: encoded.data }],
  };

  const event = confirmAttestedReceipt(receipt, anchored, trustedAuditor);
  assert.equal(event.reportHash, reportHash);
  assert.equal(event.riskScore, 85);
  assert.throws(
    () => confirmAttestedReceipt({ ...receipt, logs: [] }, anchored, trustedAuditor),
    /did not emit Attested/,
  );

  for (const invalidReceipt of [
    { ...receipt, status: 0 },
    { ...receipt, hash: `0x${"44".repeat(32)}` },
    { ...receipt, blockNumber: 43 },
    { ...receipt, logs: [{ ...receipt.logs[0], address: "0x0000000000000000000000000000000000000044" }] },
  ]) {
    assert.throws(() => confirmAttestedReceipt(invalidReceipt, anchored, trustedAuditor));
  }

  const mismatchedEvents = [
    [`0x${"55".repeat(32)}`, merkleRootHash, 85, 1_788_576_928, trustedAuditor],
    [reportHash, `0x${"55".repeat(32)}`, 85, 1_788_576_928, trustedAuditor],
    [reportHash, merkleRootHash, 84, 1_788_576_928, trustedAuditor],
    [reportHash, merkleRootHash, 85, 0, trustedAuditor],
    [reportHash, merkleRootHash, 85, 1_788_576_928, "0x0000000000000000000000000000000000000066"],
  ];
  for (const fields of mismatchedEvents) {
    const wrongEvent = contractInterface.encodeEventLog("Attested", fields);
    assert.throws(
      () => confirmAttestedReceipt({
        ...receipt,
        logs: [{ address: contractAddress, topics: wrongEvent.topics, data: wrongEvent.data }],
      }, anchored, trustedAuditor),
      /event fields do not match/,
    );
  }

  try {
    confirmAttestedReceipt({ ...receipt, logs: [] }, anchored, trustedAuditor);
    assert.fail("Expected receipt confirmation to fail");
  } catch (error) {
    assert.equal(error.minedResult.transactionHash, transactionHash);
    assert.equal(error.minedResult.blockNumber, 42);
    assert.match(error.minedResult.transactionExplorerUrl, new RegExp(transactionHash));
    assert.match(describeAttestationError(error), /was mined.*Do not resubmit/i);
  }
});
