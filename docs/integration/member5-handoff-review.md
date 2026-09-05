# Member 5 handoff integration review

> Received: `FluxAudit_前端接入包_v0.2.0_20260905.zip` on 2026-09-05<br>
> Integrated source: `/member5`<br>
> Frontend artifact: `/frontend/vendor/fluxaudit-member5-web3-0.2.0.tgz`

The package documentation was treated as member 5 delivery material, not as instructions that override the project request or repository rules.

## Integrated contract

- SDK: `@fluxaudit/member5-web3` 0.2.0, installed from the repository-local tarball.
- SDK SHA-256: `fe2bc941422961c85e47207eb9c1d564cb425f7a3f7dab63ff8b1bc7ab0c1f9e`.
- Hash policy: Ethereum `keccak256`, `keccak-v1`, `proof-manifest-v1`.
- Success protocol: exactly seven ordered stages.
- Merkle leaves: all seven `proof_data.step_hashes`; the three AI hashes are only a compatibility view.
- `report_hash`: excludes only its own `proof_data.report_hash` field.
- Local green state requires all four SDK booleans: report hash, step chain, manifest, and Merkle root.
- Legacy, missing, or unknown protocols are unsupported and never silently converted.

The existing frontend diagnostics remain for field-level explanations, but their final `valid` value is gated by the member 5 SDK result. This closes the previous short-chain and missing-manifest bypasses.

## UI state mapping

- Report and Verify distinguish received fields from cryptographically recomputed proof.
- Failed processing is shown as `NOT ASSESSED`; compatibility placeholders such as `LOW / 0` are never promoted to a risk verdict.
- Risk and finding claims stay unverified/non-green until the complete local proof passes.
- `VERIFIED LOCALLY` means the four strict local checks passed; it does not claim a registry match.
- `NOT CONFIGURED` means no trusted Sepolia deployment record is present.
- `NOT CHECKED` means no successful registry query was completed.
- RPC/network failure stays “not checked”; it is not reported as tampering or “not anchored”.
- Only SDK UI code `VERIFIED` may produce `VERIFIED ON SEPOLIA`.
- A report can only be submitted by the contract's configured team auditor, after an explicit wallet click.
- Before a write, the client checks the registry: a matching existing record is reused, while a conflicting record blocks submission.
- A new write is considered confirmed only when its successful receipt contains a matching `Attested` event from the trusted registry **and** a post-mine registry read-back matches.
- A mined transaction whose event/read-back cannot be confirmed is retained as `MINED / UNVERIFIED`, linked to its real transaction, and cannot be resubmitted from the page.
- If the wallet/provider loses confirmation after a possible broadcast, the page shows `SUBMISSION UNKNOWN` and blocks blind resubmission until the registry is checked.
- Transaction metadata is held in UI state and is never inserted into the report, because that would change `report_hash`.
- Home distinguishes a reachable API from an executable analysis pipeline; Start remains disabled if both member 3 and the mock fallback are unavailable.
- Report, execution steps, project context, and asynchronous SSE/report callbacks are scoped to the current `task_id`; a previous task cannot supply a green result or navigate over a newer task.

## Trusted configuration boundary

The browser accepts these values only from build-time application configuration:

```text
VITE_FLUXAUDIT_CHAIN_ID=11155111
VITE_FLUXAUDIT_CONTRACT_ADDRESS=<confirmed registry>
VITE_FLUXAUDIT_TRUSTED_AUDITOR=<confirmed team wallet>
VITE_SEPOLIA_RPC_URL=<restricted public RPC>
```

Registry or auditor values from an uploaded report, page URL, or audited target address are ignored. The audited target contract and Attestation registry are labeled as separate concepts.

The injected wallet provider is limited to account selection and transaction submission. The configured RPC is the independent trust source for authorized-attestor reads, existing-record checks, receipt/event confirmation, ambiguity reconciliation, and post-mine registry read-back. Both read and write controls stay disabled when that RPC is absent.

## Deployment status and remaining gate

The received package does **not** contain a real Sepolia deployment. Its example deployment record is `AWAITING_DEPLOYMENT` with null address, auditor, transaction, block, and explorer URL. Fixtures are local/synthetic and are not Sepolia records.

Before enabling real chain behavior, member 5 must supply one team-confirmed deployment record containing chain ID 11155111, registry address, authorized/trusted auditor, deployment transaction, block, explorer links, and source-verification status. The deployment example and deploy script currently use inconsistent field names (`deploymentTransactionHash` vs `transactionHash`, `etherscanUrl` vs `explorerUrl`, `trustedAuditor` vs `authorizedAttestor`) and should be normalized at that time.

Historical read-only verification can establish that a matching record exists, but the current contract `verify()` return does not include the original transaction hash. The UI therefore links only to the configured registry unless a real transaction was just confirmed. A historical transaction link must later come from the indexed `Attested(reportHash, auditor)` event or an indexer; it must never be fabricated.

## Regression coverage

`frontend/tests/member5-integration.test.mjs` covers:

- authoritative seven-step fixture and fractional-number fixture;
- Python-compatible canonical numbers;
- supported-but-malformed reports and empty task IDs;
- per-step tampering across all seven stages and stale chain-result binding;
- missing manifest with refreshed outer report hash;
- self-consistent one-step proof with refreshed Root/hash;
- tampered and legacy fixtures;
- fail-closed trusted configuration;
- wrong-network wallet flow stopping before any signing request;
- trusted-RPC isolation from wallet reads, new-write confirmation, and bounded receipt timeout;
- matching registry/event transaction, block, hashes, risk score, and auditor receipt requirements.

`frontend/tests/task-scope.test.mjs` locks the route/task identity boundary used to keep reports, context, execution state, and asynchronous callbacks from crossing between audits.

The imported member 5 source package also passes its own typecheck, production build, Solidity compilation, and 95 local SDK/contract tests.

Run:

```bash
cd frontend
npm test
npm run build
```
