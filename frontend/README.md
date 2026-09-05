# FluxAudit frontend

Productized four-page hackathon frontend for the FluxAudit deterministic audit flow. The repository vendors member 5's exact SDK 0.2.0 handoff so local setup does not depend on a temporary machine path.

## Run locally

Start the member 4 API first:

```bash
cd ../member4
python -m pip install -r requirements.txt
python app.py
```

Then start the frontend in a second terminal with Node.js >= 22.13:

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 4173
```

Routes:

- `/` — create audit
- `/audit/<task_id>` — seven-stage SSE execution
- `/audit/<task_id>/report` — report and proof manifest
- `/verify` — strict local report verifier and optional read-only Sepolia registry check

## Proof contract

- Hash algorithm: Ethereum `keccak256` through `@fluxaudit/member5-web3` 0.2.0
- Every one of the seven public stages is independently hashed
- Chain invariant: `step_hash[n] → prev_hash[n+1]`
- Merkle leaves: `keccak256(UTF8(step_hash_hex_string))`
- Parent nodes: `keccak256(left_digest_bytes || right_digest_bytes)`; duplicate an odd final node
- Optional attestation is outside the seven-stage Merkle proof chain

The runtime label is read from the backend health/report payload. API reachability and analysis readiness are separate checks: starting is disabled when member 3 is unavailable and the mock fallback is off. Mock, hybrid, fallback, and real provenance are kept distinct; the frontend never infers a live-chain or attestation success.

The current backend emits seven real proof steps. `PROOF_MANIFEST_COMPILED` is the seventh step and commits to the ordered first six step hashes plus the business-report payload hash.

The SDK is the authoritative green-state gate. The UI exposes its four local checks separately: report hash, seven-step chain, proof manifest, and seven-leaf Merkle root. The detailed frontend verifier only explains mismatches; it cannot override an SDK failure.

Risk presentation follows the same trust boundary. A failed backend response is `NOT ASSESSED` even if its compatibility payload contains `LOW / 0`; a report that has not passed the complete local proof is labeled unverified and cannot render a green risk or finding state.

Execution and report state are scoped to the route `task_id`. Switching tasks immediately masks the previous report, context, steps, and events; stale SSE or report callbacks cannot write back or navigate over the current task.

## Optional Sepolia configuration

Copy `.env.example` to `.env.local` only after member 5 supplies a team-confirmed deployment record:

```bash
cp .env.example .env.local
```

Set the fixed Sepolia registry address, trusted team auditor, and a restricted public RPC URL. Until all trusted public values are valid, read and write controls remain disabled and the UI shows `NOT CONFIGURED`. Never place a private key or mnemonic in any `VITE_` variable.

The report page's write control is for the contract's authorized team wallet only. Wallet access starts only after a click. The injected wallet is used for account selection and transaction submission; the configured RPC independently handles the authorized-attestor check, existing-record preflight, receipt, `Attested` event, reconciliation, and final registry read-back. A new write turns green only after those trusted checks match. A mined-but-unverified transaction is preserved for review, and an ambiguous post-broadcast failure becomes `SUBMISSION UNKNOWN`; neither state allows a blind resubmission. The report object is never mutated with transaction metadata.

Vendored SDK checksum:

```text
fe2bc941422961c85e47207eb9c1d564cb425f7a3f7dab63ff8b1bc7ab0c1f9e  vendor/fluxaudit-member5-web3-0.2.0.tgz
```

## Verification

```bash
npm test
npm run build
```
