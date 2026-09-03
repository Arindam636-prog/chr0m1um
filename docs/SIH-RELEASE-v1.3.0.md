# ContextShield v1.3.0 release verification

**Verified:** 3 September 2026  
**Purpose:** judge-facing control room and safer public-form compatibility

## Delivered

- A rebuilt judge control room at `http://127.0.0.1:4173` with live planner
  readiness, the five-stage privacy loop, measured evidence, an exact six-minute
  route, architecture, impact, adoption path, public tests and honest limits.
- A generated fictional portrait for real local face-detection demonstration.
- Browser-local handles for generic text and username values supplied in tasks.
- Support for visually hidden native checkbox and radio controls that expose a
  visible associated label.
- A planner-aware health check, so a running API no longer falsely reports an
  unavailable Qwen service as ready.
- Synced judge metrics generated from `benchmarks/results/latest.json`.

## Fresh automated verification

`./scripts/check.sh` completed successfully:

- 4 shared-schema unit tests passed.
- 44 extension unit tests passed.
- Chrome MV3 and Firefox MV3 production builds completed.
- 5 default real-Chromium extension suites passed; 9 opt-in live tests were
  skipped by the default gate as designed.
- 30 server tests passed.
- Python lint, JavaScript lint and both TypeScript type checks passed.

The packaged v1.3.0 release passed the opt-in external Selenium regression in
4.5 seconds. It filled
the official form's generic text input, selected `Two`, checked the default
checkbox, did not submit, and reached `COMPLETE`.

The packaged release also passed the exact fail-closed mutation scenario in 3.1
seconds. It rejected the replaced Continue target with `Page changed after
planning; the stale action was blocked.` rather than reaching a step or time
limit.

With the normal local Qwen3-VL stack running, the packaged release completed the
controlled autonomous checkout in 16.0 seconds and the privacy proof in 3.6
seconds. The privacy run detected the generated fictional portrait as `FACE`
through the packaged YOLOX model; the page does not declare or inject a face
classification. The same real-stack run also passed the stale-action guard and
general-control flow.

## Release artifacts

- Chrome unpacked release: 102,036 KiB.
- Chrome ZIP: 40,274,806 bytes.
- Chrome ZIP SHA-256: `b2dec2c7bf94cc9877f1b225795e8030606741c7f9c3e3635ba237ba60a5dfea`.
- Firefox unpacked release: 343,144 KiB.
- Chrome manifest: MV3, version 1.3.0, all-sites host permission present.

## Evidence boundary

The control room intentionally keeps the accepted 31 August benchmark snapshot:
167 of 167 expected interactables on 60 controlled screens, 100% precision and
recall on 295 synthetic PII cases, 100 of 100 controlled supplied-box redactions,
and 3.67 seconds median across three completed controlled tasks. These are not
independent real-world accuracy claims.

The complete historical live benchmark file remains the 31 August reasoning
baseline because this release verification intentionally ran the judge-critical
subset rather than overwriting it with a smaller sample.

## Judge-safe limitation

This is a broad working prototype, not a guarantee of universal website
compatibility. Browser-owned pages, closed shadow roots, inaccessible
cross-origin frames and third-party page changes remain outside its control.
