---
name: FluxAudit
description: A verifiable Web3 audit workspace where every public step remains inspectable.
colors:
  bg-app: "#070a0c"
  bg-rail: "#0a0f12"
  bg-panel: "#0e1418"
  bg-panel-raised: "#131a1f"
  bg-well: "#070b0e"
  bg-control: "#171e23"
  bg-report: "#f2eee4"
  text-primary: "#f5f6f2"
  text-muted: "#aeb7b5"
  text-ink: "#171a18"
  border: "#263036"
  border-strong: "#37434a"
  border-light: "#d5cec0"
  active: "#a879ff"
  active-deep: "#6e3fc8"
  verified: "#39d77d"
  risk: "#ff5465"
  warning: "#f2bc4d"
  info: "#72cfff"
typography:
  display:
    fontFamily: '"Archivo Variable", "SF Pro Text", "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif'
    fontSize: "42px"
    fontWeight: 665
    lineHeight: 0.98
    letterSpacing: "-0.034em"
  headline:
    fontFamily: '"Archivo Variable", "SF Pro Text", "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif'
    fontSize: "34px"
    fontWeight: 640
    lineHeight: 1.06
    letterSpacing: "-0.032em"
  title:
    fontFamily: '"Archivo Variable", "SF Pro Text", "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif'
    fontSize: "20px"
    fontWeight: 620
    letterSpacing: "-0.022em"
  body:
    fontFamily: '"Archivo Variable", "SF Pro Text", "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: '"Archivo Variable", "SF Pro Text", "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif'
    fontSize: "11px"
    fontWeight: 660
    lineHeight: 1
    letterSpacing: "0.035em"
  mono:
    fontFamily: '"Azeret Mono Variable", "SFMono-Regular", "Cascadia Code", monospace'
    fontSize: "13px"
    fontWeight: 500
rounded:
  sm: "8px"
  md: "13px"
components:
  button-default:
    backgroundColor: "{colors.bg-control}"
    textColor: "{colors.text-primary}"
    rounded: "9px"
    padding: "0 16px"
    height: "43px"
  button-primary:
    backgroundColor: "linear-gradient(145deg, #9869ee 0%, #7445ce 58%, #6037b2 100%)"
    textColor: "#fff"
    rounded: "9px"
    padding: "0 16px"
    height: "43px"
  input:
    backgroundColor: "{colors.bg-well}"
    textColor: "{colors.text-primary}"
    rounded: "7px"
    padding: "0 17px"
    height: "50px"
  panel:
    backgroundColor: "{colors.bg-panel}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
  status-verified:
    backgroundColor: "#0b1d12"
    textColor: "#6dec8e"
    rounded: "999px"
    padding: "2px 9px"
    height: "25px"
  nav-active:
    backgroundColor: "{colors.bg-panel-raised}"
    textColor: "#f3edff"
    padding: "0 18px"
    height: "58px"
  evidence-cartridge:
    backgroundColor: "{colors.bg-report}"
    textColor: "{colors.text-ink}"
    rounded: "12px"
  risk-seal:
    backgroundColor: "#eee6db"
    textColor: "#a9192d"
    rounded: "10px"
    padding: "17px 16px 14px"
---

# Design System: FluxAudit

## Overview

**Creative North Star: "链上取证仪器 × 审计卷宗"**

FluxAudit combines a near-black operational chassis with warm dossier-paper evidence objects. The interface should feel precise, calm, forensic, and technical without becoming cryptic: users operate a trustworthy instrument, then read a reviewable case file rather than receiving an opaque AI verdict.

Product clarity and visual character carry equal weight. Audit execution is the strongest expression of the system, the report is second, and New audit and Verify remain quieter and task-led. The implementation is bound to the Neuron crypto AML × AML Aggregator reference world while retaining FluxAudit's explicit proof-state model.

**Key Characteristics:**

- Near-black chassis with recessed data wells
- Warm dossier-paper evidence objects
- Neural violet for reasoning, selection, and interaction
- Verified green for cryptographic passage, risk crimson for actual risk
- A visible seven-step Ethereum keccak256 proof spine
- Flat by default with localized structural 2.5D

## Colors

The palette separates operational state, evidentiary material, cryptographic validity, and analytical risk instead of collapsing them into a generic Web3 glow.

### Primary

- **Neural Violet** (#a879ff): Marks reasoning, selection, current steps, focus, and primary interaction.
- **Deep Neural Violet** (#6e3fc8): Anchors the darker end of violet controls and interaction depth.

### Secondary

- **Verified Green** (#39d77d): Reserved for cryptographic passage, linked hashes, completed proof stages, and local verification success.
- **Risk Crimson** (#ff5465): Identifies actual risk, failed checks, mismatches, and blocked states; it is not decorative emphasis.

### Tertiary

- **Evidence Amber** (#f2bc4d): Identifies medium-risk or attention states.
- **Instrument Cyan** (#72cfff): Identifies supporting system information and non-risk telemetry.

### Neutral

- **Near-black Chassis** (#070a0c): Grounds the full operational workspace.
- **Rail Black** (#0a0f12): Separates persistent navigation from the workspace.
- **Instrument Panel** (#0e1418): Fills ordinary operational containers.
- **Raised Panel** (#131a1f): Marks selected navigation and localized raised assemblies.
- **Recessed Well** (#070b0e): Holds read-only proof values and form data.
- **Control Surface** (#171e23): Fills default raised controls.
- **Warm Dossier Paper** (#f2eee4): Carries report slabs, uploaded report objects, and hash-handoff receipts.
- **Instrument White** (#f5f6f2): Carries primary text on dark surfaces.
- **Muted Instrument Text** (#aeb7b5): Carries secondary operational copy and metadata.
- **Dossier Ink** (#171a18): Carries report and evidence-object copy.
- **Structural Line** (#263036): Separates standard dark assemblies.
- **Strong Structural Line** (#37434a): Provides higher-emphasis dark boundaries.
- **Dossier Divider** (#d5cec0): Separates warm paper records.

### Named Rules

**The Semantic Accent Rule.** Violet means reasoning or interaction, green means cryptographic passage, crimson means genuine risk, amber means attention, and cyan means supporting information.

**The State-Truth Rule.** Never use a successful color to imply a query, anchor, transaction, or verification that did not occur.

## Typography

**Display Font:** Archivo Variable (with system and CJK sans-serif fallbacks)

**Body Font:** Archivo Variable (with system and CJK sans-serif fallbacks)
**Label/Mono Font:** Azeret Mono Variable (with system monospace fallbacks)

**Character:** Archivo keeps the dense operational UI clear across English and Chinese content. Azeret Mono gives hashes, counters, timestamps, chain relations, and step indices a visibly computational register.

### Hierarchy

- **Display** (weight 665, 42px, line-height 0.98, letter-spacing -0.034em): Heavy, tightly tracked page entry titles.
- **Headline** (weight 640, 34px, line-height 1.06, letter-spacing -0.032em): Compact audit, report, and verification titles.
- **Title** (weight 620, 20px, letter-spacing -0.022em): Panel and section headings.
- **Body** (weight 400, 14px, line-height 1.55): Operational explanations, report prose, and evidence summaries; long copy stays within roughly 68–74 characters where implemented.
- **Label** (weight 660, 11px, line-height 1, letter-spacing 0.035em): Small status, provenance, table, and uppercase instrument labels.
- **Mono** (weight 500, 13px): Hashes, timestamps, metrics, step numbers, and cryptographic relations, with tabular numerals where relevant.

### Named Rules

**The Numeric Evidence Rule.** Every hash, counter, timestamp, stage number, and chain relation uses the mono voice; explanatory prose does not.

## Layout

Desktop uses a fixed labeled rail and a minmax-based working grid. The canonical wide rail is 192px; it contracts to 176px on common laptops, becomes icon-only only below the narrower tablet breakpoint, and is replaced by a fixed three-item bottom navigation on mobile. Audit execution uses a three-column instrument layout at full width, Report pairs a document slab with a proof-manifest column, and New audit and Verify use calmer two-column task layouts.

The observed responsive thresholds are 1359px, 1179px, 1050px, 840px, 720px, and 480px. At 390px, content becomes a single reading stream, proof structures become vertical, wide tables become labeled records, and there must be no horizontal page overflow. The reading order remains step → status → hash, while the fixed mobile navigation must not obscure actionable content.

**The Labeled Rail Rule.** Preserve text labels at common laptop widths; icon-only navigation belongs only to narrower tablet layouts.

## Elevation & Depth

The system is flat by default and uses tonal layering, fine borders, and recessed wells for most hierarchy. Structural 2.5D is localized to raised controls, current/selected steps, icon plates, proof handoffs, the warm evidence object, and the report risk seal. Execution carries the most depth, Report the second most, while New audit and Verify stay restrained.

### Shadow Vocabulary

- **Control Lift** (`box-shadow: 0 8px 18px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.1)`): Raises actionable controls from the chassis.
- **Pressed Control** (`box-shadow: 0 2px 7px rgba(0, 0, 0, 0.42), inset 0 2px 3px rgba(0, 0, 0, 0.44)`): Compresses a raised control during active press.
- **Evidence Lift** (`box-shadow: 0 18px 36px rgba(0, 0, 0, 0.34), 0 3px 8px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.82)`): Lifts warm report slabs and evidence cartridges from the dark chassis.

### Named Rules

**The Flat-by-Default Rule.** Ordinary panels remain flat; depth is earned by controls, object evidence, the current proof step, a proof handoff, or a risk seal.

**The One Light Source Rule.** Every highlight and cast or inset shadow implies one light source from the upper left.

## Shapes

The system uses compact, gently machined corners: small controls and icon plates cluster around the small radius, while panels use the medium radius. Recessed wells use tighter 7px corners; buttons use 9px; paper objects use 10–12px. Pills are reserved for terse status badges, and circles are reserved for LEDs and proof-chain nodes.

Hard one-pixel structural borders are more common than floating cards. Contiguous inspector stacks intentionally square their internal corners, while the outer assembly keeps the medium silhouette.

## Components

Components feel tactile and precise. They rise only when they are controls, object evidence, a current step, or a risk seal.

### Buttons

- **Shape:** Compact machined rectangle with a 9px corner and 43px minimum height.
- **Primary:** Neural-violet diagonal gradient, white text, and localized control lift.
- **Hover / Focus:** Hover lifts by 2px; active press moves down by 1px and uses the pressed shadow. Keyboard focus uses a white outline with a violet outer ring.
- **Default / Quiet:** Default controls use the raised control surface; quiet controls are transparent with an inset structural border.

### Status Badges & LEDs

- **Style:** Compact pill badges pair text with semantic color; LEDs are 11px circular indicators.
- **State:** Status is always written in text or accompanied by a label. Pulsing is limited to active connection or processing state.

### Cards / Containers

- **Corner Style:** Panels use the medium radius and a fine structural border.
- **Background:** Ordinary containers use the dark panel surface; read-only values sit in the darker recessed well.
- **Shadow Strategy:** Ordinary panels stay flat. Warm evidence cartridges and report slabs use Evidence Lift.
- **Internal Padding:** Padding varies by information density and is defined by each implemented panel rather than a universal spacing token.

### Inputs / Fields

- **Style:** Recessed near-black wells with a 7px corner, subtle dark border, and inset shadow.
- **Focus:** The global white outline plus violet outer ring is mandatory for keyboard focus.
- **Error / Disabled:** Risk crimson accompanies specific corrective text; disabled controls lose lift and use muted text.

### Navigation

- **Style:** The rail uses labeled 58px rows, a 34px icon plate, and a flat selected surface. The active icon plate alone receives localized violet 2.5D.
- **Responsive:** A three-item bottom bar replaces the rail at mobile widths; active state uses both violet color and a top inset marker.

### Seven-Step Proof Spine

The seven public stages are a product-visible component, not decoration. Current selection uses neural violet; completed, independently recomputable stages use verified green; each stage preserves its explicit index, status, and hash handoff. The algorithm label must read Ethereum keccak256.

### Evidence Cartridge & Report Slab

Warm dossier paper is reserved for evidence-as-object: uploaded/parsed reports, verified hash-handoff receipts, and the report itself. The risk seal is a localized raised object inside the report, while report tables and prose remain paper-flat.

### Anchor State

Anchor is a separate product state outside the seven-stage Merkle proof chain. Until a real registry query or returned Attested event exists, controls remain unavailable and copy must say not queried, not anchored, or not checked as appropriate.

### Named Rules

**The Raised-Only-When-Earned Rule.** Raise controls, object evidence, the current step, proof handoffs, and risk seals—nothing else.

**The Honest Anchor Rule.** Never infer a transaction or anchor from runtime mode, a report payload, or a successful local verification.

## Do's and Don'ts

### Do:

- Do preserve the labeled rail at common laptop widths and the no-overflow single-column flow at 390px.
- Do expose all seven public stages, their status, and their step_hash[n] → prev_hash[n+1] handoff.
- Do label the hashing algorithm Ethereum keccak256 wherever the algorithm is user-visible.
- Do keep proof integrity, agent consensus, final risk, and anchor status visually and semantically separate.
- Do reserve warm dossier paper for report and evidence objects, with one dominant warm object per page.

### Don't:

- Don't present NIST SHA3-256 as equivalent to Ethereum keccak256.
- Don't use green to imply protocol safety, factual truth, or an unqueried on-chain anchor.
- Don't add decorative glow or generic glass cards to ordinary panels.
- Don't apply 2.5D depth uniformly across the interface.
- Don't hide navigation labels at common laptop widths or introduce horizontal scrolling at 390px.
