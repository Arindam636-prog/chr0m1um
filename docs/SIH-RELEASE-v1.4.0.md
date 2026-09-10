# ContextShield v1.4.0 — judge-facing extension

Verified locally on 4 September 2026. Team Chr0m1um / PS 26171.

Follow-up audit: [fresh results, privacy fixes, and remaining limitations](FRESH-AUDIT-RESULTS.md).
That report supersedes the timing observations below for the rebuilt package;
the original observations are retained as release history.

## What changed

- Compact Agent screen: Read → Hide → Plan → Act, plain-language status, a task preset, and a visible privacy-proof button after execution. Vault, logs and stage timings remain available under details.
- Read-only judge view: first sanitized snapshot, original-value groups kept local, actual redacted image crop, readable permitted controls, explicit delivery status and a Freeze view control. JSON is optional.
- Same privacy architecture: local YOLOX, OCR, Rampart, sanitization gateway, server-side Qwen with grounded transitions, browser validation and action verification. No simulated server requests or staged redaction screenshots.
- New single-page fixture at `/judge-run.html`: synthetic profile plus real portrait pixels and a cheapest-fare/test-ticket workflow. No purchase or vault setup required.
- Evidence counts group repeated text values and overlapping visual detections; uncorroborated OCR/contextual and low-confidence findings remain marked for review. Masking is not removed to improve displayed counts.
- Existing redaction markers are not reclassified as fresh personal data; ordinary surrounding text is still scanned.
- Fresh visual analysis at each observation replaces geometry-only reuse of stale screenshots/OCR. Captures are paced for Chrome's quota and checked against the intended active tab.
- Small visual regions receive an additional local face scan. Overlapping detections share an identity, with unioned masks so deduplication cannot shrink the protected area.
- Partial form-state completion no longer lets a server shortcut declare an arbitrary multi-part task finished. Exact named button follow-ups are grounded and negations are checked; the client also rejects a premature FINISH with a requested enabled button remaining.

## Verification performed

| Check | Result |
| --- | --- |
| TypeScript: shared, extension, judge site | Passed |
| Scoped ESLint: extension and new demo JS | Passed |
| Shared unit tests | 4 passed |
| Extension unit tests | 59 passed |
| Server Python tests | 33 passed |
| Chrome and Firefox MV3 builds | Passed; both manifests 1.4.0 |
| Chrome stable-release real-model test | Passed |
| Shipped local controls and stale-action test | Passed |
| Judge UI: delivery states, freeze, no original task, light/dark, narrow/wide | Passed |

The real-model run was tested twice after the capture pacing fix. Task timers
reported **100.38 seconds** using the development build and **58.99 seconds**
using the packaged Chrome release. These are two observations, not a latency
benchmark or a guaranteed runtime. Server planning dominated the latter run
(55.81 seconds); local vision/redaction totaled 0.86 seconds, classification
0.73 seconds, and capture/pacing 0.61 seconds. Stage totals have separate scopes.

The packaged test checked the actual page: ₹899 selected and **Ticket prepared**
visible. It checked real context requests and a server acknowledgement, confirmed
the synthetic raw name/email/password strings were absent from captured request
bodies, and verified black face-center pixels in the actual displayed crop.
The proof displayed one supported name, email, password and face. Three other
possible groups remained visibly marked as uncertain, not relabelled as known
people or UPI accounts.

The local-controls test checked Python, Option 2 and Blue with zero context
requests. The mutation fixture stopped with a stale-action error, not a timeout
or a false success. A new run cleared the preceding proof snapshot.

## Run it

1. Double-click `START.command` if services are not already running.
2. Reload ContextShield in `chrome://extensions`; confirm v1.4.0. Stable folder:
   `release/ContextShield-Chrome`.
3. Open <http://127.0.0.1:4173/judge-run.html> in Chrome.
4. Open the extension, click **Use demo task**, then **Start agent**. Keep that
   page active. After completion, click **Show the privacy proof**.

Use [the three-minute script](judge-demo.md). Start the real task immediately
and explain while it runs. Rehearse on the presentation machine.

## Scope and limits

This validates the controlled demonstration, not universal website compatibility
or the PS's population-level accuracy metrics. Firefox was built, not subjected
to the same live browser test. Detection may miss private information; retained
context can also identify people indirectly. The first-snapshot view is extension
state, not an independent network audit. This local prototype uses loopback HTTP;
remote deployments require HTTPS as well as client-side sanitization.

The prior benchmark reports remain historical, scoped evidence. This UI release
does not update their accuracy, memory or latency scores. Repo-wide ESLint also
has pre-existing presentation-script violations outside the extension scope;
the scoped application checks above passed.
