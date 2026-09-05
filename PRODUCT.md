# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Primary product user: a person evaluating a Web3 protocol who needs a fast, evidence-backed risk view rather than an opaque AI answer.
- Primary demonstration audience: Web3 hackathon judges who must understand the product mechanism and trust boundary within a two-minute live demo.
- Implementation owner in this workspace: member 2, the frontend UI/UX engineer in a five-person team.

## Product Purpose

FluxAudit turns AI-assisted Web3 due diligence into a reviewable workflow. A user submits a Sepolia contract address and whitepaper material, watches public evidence and analysis stages complete, receives a structured risk report, optionally anchors the report proof on Sepolia, and can later verify a local report independently.

Success means the full input → analysis → report → attestation → verification path can be demonstrated clearly in under two minutes, including an honest recovery path when a live dependency fails.

## Positioning

Every public processing and analysis step is independently hashed with Ethereum Keccak-256 and linked to the previous step. The complete set of step hashes produces a Merkle Root, and the canonical report produces a report hash that can be anchored and checked on Sepolia. The product exposes the proof artifacts and local recomputation instead of asking users to trust an opaque AI conclusion.

## Operating Context

- Desktop-first 1440px live demo, with a usable 390px mobile fallback.
- Inputs: Sepolia contract address plus whitepaper text or file.
- Main flow: create audit, receive SSE analysis events, locally verify every event hash, review the report, attest the report, and independently verify a downloaded JSON report.
- Live and deterministic Mock adapters must use the same UI contract so the demo can recover without pretending a simulated transaction is real.

## Capabilities and Constraints

- All hashes use Ethereum `keccak256`; NIST SHA3-256 is explicitly forbidden.
- Every step contains independently recomputable input, output, payload, and chained step hashes.
- Objects use RFC 8785 JCS, strings use UTF-8, and bytes32 concatenation uses raw bytes rather than hexadecimal text.
- The report includes every step hash and its Merkle Root.
- The frontend does not expose hidden model chain-of-thought. It shows stages, evidence summaries, sources, timestamps, public outputs, and proof data.
- P0 scope is Sepolia only. No mainnet transactions, multi-chain switcher, account system, project history, collaboration, or trading/portfolio analytics.
- Verification is read-only and must not require wallet connection.
- A hash mismatch blocks attestation and names the first broken step.
- On-chain success can only display a real transaction hash and block location returned from an `Attested` event.

## Brand Commitments

- Product name: FluxAudit.
- Binding visual references selected by the user: Neuron crypto AML and AML Aggregator.
- Binding visual direction: dark forensic investigation workspace for live analysis, paired with warm off-white audit/report surfaces for comparison and conclusions.
- Tone: precise, calm, technical without being cryptic, and explicit about limitations.

## Evidence on Hand

- Frontend specification: `docs/sdd/fluxaudit-frontend/spec.md`.
- Visual direction: `docs/sdd/fluxaudit-frontend/design-direction.md`.
- Frontend plan and tasks: `docs/sdd/fluxaudit-frontend/plan.md` and `tasks.md`.
- Backend handoff review: `docs/integration/member4-handoff-review.md`.
- Member 4 backend package: `member4/`.
- Current productized UI comps:
  - `docs/sdd/fluxaudit-frontend/assets/home-page-v9-productized.png`
  - `docs/sdd/fluxaudit-frontend/assets/execution-page-v9-productized.png`
  - `docs/sdd/fluxaudit-frontend/assets/report-page-v9-productized.png`
  - `docs/sdd/fluxaudit-frontend/assets/verify-page-v9-productized.png`
- Project copy, risk scores, hashes, addresses, and transaction data in comps are illustrative unless backed by the runtime contract; future work must not present them as production facts.

## Product Principles

1. Proof state is product state: every counter, label, and action derives from one canonical verification state machine.
2. Show the hash handoff, not merely a green badge.
3. Analytical disagreement and cryptographic integrity are separate dimensions and must be named separately.
4. Failure must remain legible and recoverable during a live demo.
5. Prefer a clear, inspectable evidence trail over decorative Web3 conventions.

## Accessibility & Inclusion

- Core tasks must be keyboard-operable.
- Status is never communicated by color alone.
- Operational body text and muted metadata must remain legible on a projector and at browser zoom.
- Motion respects `prefers-reduced-motion` and cannot hide state changes.
- The 390px layout must not overflow horizontally and must preserve the step → status → hash reading order.
