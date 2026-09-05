# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## FluxAudit V10 product baseline

- Source-of-truth screens live in `../docs/sdd/fluxaudit-frontend/assets/*-v10-strict-2-5d-final-aligned.png`.
- Desktop shell uses a 192px rail: content `x=0–188`, divider `x=189–191`, main workspace from `x=192` on a 1536×1024 canvas.
- Visual world is the strict “Anodized Evidence Console”: matte black chassis, recessed read-only wells, raised controls only, and one warm ivory Z2 evidence object per page.
- Every one of the seven public stages must be independently hashed with Ethereum `keccak256`; NIST `SHA3-256` is forbidden.
- The runtime seven-step contract is `INPUT_VALIDATED → CHAIN_FETCHED → DOC_PARSING → CROSS_CHECKING → RISK_SCORING → REPORT_ASSEMBLED → PROOF_MANIFEST_COMPILED`; render its data dynamically and never synthesize a missing step.
- Preserve `step_hash[n] → prev_hash[n+1]`. Optional attestation is after the report and outside the seven-stage Merkle proof chain.
- Deterministic Mock and synthetic provenance must remain explicit. Never show a fake transaction, block, explorer link, or live-chain success.
- Treat `whitepaper_text` as the audited document input. PDF is attachment-only until a parser is implemented; do not imply that attaching a PDF has extracted its contents.
- Keep backend modes `mock`, `real`, `hybrid`, and `fallback` distinct, and read them from health/report payloads rather than a client-side mode toggle.
- Keep Proof integrity, Agent consensus, Final risk, and Anchor status as separate product concepts.

## V11 visual refinement decisions

- Preserve the Neuron × AML Aggregator world and the working four-page flow; this is a system refinement, not a new identity.
- Balance product clarity and visual character equally across typography, layout, component precision, icon treatment, material, and motion rather than concentrating the visual half in effects.
- Give Audit run the strongest visual signature, Report the second strongest, and keep New audit and Verify quieter and task-led.
- Treat the visual thesis as “on-chain forensic instrument × audit dossier”: dark operational chassis, warm evidence objects, and an explicit seven-step proof spine.
- Localize 2.5D to icon plates, selected/current steps, proof handoffs, risk seals, and raised controls. Ordinary panels stay flat. All highlights and shadows share one top-left light source.
- Preserve labeled navigation at common laptop widths; icon-only navigation is reserved for narrower tablet layouts.
