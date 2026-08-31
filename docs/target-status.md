# Target acceptance status

This report separates implemented code from acceptance that requires model
weights, another person, external accounts, or physical browser/hardware checks.
`PARTIAL` is intentional: it must not be read as “done”.

## Target 1 — project foundation

**STATUS:** PASS

**IMPLEMENTED:** monorepo, pinned Node/Python dependencies, strict contracts,
scripts, CI, docs, Git ignore rules and mock integration.

**FILES CHANGED:** root configuration, `shared/`, `scripts/`, `docs/`, CI.

**TESTS RUN:** lint, TypeScript, Vitest, Pytest, Chrome E2E, Chrome/Firefox builds.

**RESULTS:** all automated checks pass.

**ACCEPTANCE CRITERIA:** [PASS] reproducible local setup; [PASS] shared contracts;
[PASS] CI workflow; [PASS] no committed secrets/model binaries.

**INTEGRATION CHECK:** shared Zod fixture validates through Pydantic.

**KNOWN LIMITATIONS:** remote GitHub governance requires owner access.

**NEXT TARGET:** Target 2.

## Target 2 — browser extension foundation

**STATUS:** PASS

**IMPLEMENTED:** WXT React MV3 popup, background/content messaging, opt-in
runtime injection, all-website host access for arbitrary HTTP/HTTPS pages and
navigation continuity, Chrome and Firefox manifests/builds.

**FILES CHANGED:** `extension/entrypoints/`, `extension/wxt.config.ts`.

**TESTS RUN:** typecheck, both builds, real Chrome MV3 Playwright test.

**RESULTS:** pass.

**ACCEPTANCE CRITERIA:** [PASS] popup/background/content communicate; [PASS]
Chrome build; [PASS] Firefox build; [PASS] permissions match the user-requested
all-website product scope while observation remains opt-in.

**INTEGRATION CHECK:** E2E loads the built extension rather than a mocked UI.

**KNOWN LIMITATIONS:** manual Firefox UI/store-signing check remains external.

**NEXT TARGET:** Target 3.

## Target 3 — local page perception

**STATUS:** PASS

**IMPLEMENTED:** visible semantic extraction, labels/roles/options/state,
private-value separation, stable IDs, bounding boxes, visual candidates and
state fingerprints.

**FILES CHANGED:** `extension/lib/perception/`, content entrypoint.

**TESTS RUN:** E2E controlled form and multi-observation flow.

**RESULTS:** agent re-observes through distinct controlled page states; the
60-screen/167-interactable Chrome corpus, including third-party extension DOM
and a stale content marker, reports 100% controlled recall against the >90%
internal target.

**ACCEPTANCE CRITERIA:** [PASS] no raw DOM output; [PASS] stable element IDs;
[PASS] private values separated; [PASS] DOM-first visual fallback routing.

**INTEGRATION CHECK:** perception feeds privacy and action-broker snapshots.

**KNOWN LIMITATIONS:** the controlled corpus is not an independent third-party
live-site score; browser-protected surfaces and inaccessible frames remain out
of reach.

**NEXT TARGET:** Target 4.

## Target 4 — local sensitive-data detection

**STATUS:** PASS FOR THE LOCAL PROTOTYPE; INDEPENDENT PRODUCTION BENCHMARK PENDING

**IMPLEMENTED:** Indian-format/checksum detectors, password metadata, packaged
offline Rampart Q4 worker with pinned SHA-256 artifacts, packaged face-only YOLOX preprocessing/NMS worker, official PP-OCR
detection/CTC worker, active screenshot/crop loop and fail-closed protocols.

**FILES CHANGED:** `extension/lib/privacy/`, `extension/workers/`, benchmarks.

**TESTS RUN:** detector regressions, contextual failure injection, measured
295-case synthetic deterministic benchmark plus 100 controlled pixel-redaction cases.

**RESULTS:** controlled deterministic suite currently reports 1.0 precision,
recall, F1 and critical recall; this is not a real-world/model claim.

**ACCEPTANCE CRITERIA:** [PASS] deterministic cascade; [PASS] contextual adapter;
[PASS] worker/WebGPU/WASM architecture; [PASS] executable pinned YOLOX face and
PP-OCR artifacts; [FAIL] representative labelled visual benchmark and dedicated
document-detector acceptance.

**INTEGRATION CHECK:** Rampart is mandatory by default; its failure blocks the
agent before transmission. Chrome E2E initializes YOLOX/OCR, masks a captured
region, verifies the PNG, and observes it in the sanitized payload only.

**KNOWN LIMITATIONS:** the packaged YOLOX model is face-only; private documents
are classified through OCR matches until a dedicated benchmarked detector exists.

**NEXT TARGET:** Target 5 can proceed for non-visual and controlled visual paths.

## Target 5 — policy and redaction

**STATUS:** PASS FOR THE CONTROLLED PROTOTYPE

**IMPLEMENTED:** one decision per entity, abstract/drop/local-handle policy,
offset-safe text redaction, irreversible black-pixel masking, mask verification,
PNG hash/schema builder.

**FILES CHANGED:** policy, redactor, pipeline, raster tests.

**TESTS RUN:** privacy-pipeline and pixel mutation/verification tests.

**RESULTS:** known strings are absent; original raster remains separate and
transmitted raster pixels are actually changed.

**ACCEPTANCE CRITERIA:** [PASS] text and handle policy; [PASS] pixel redaction;
[PASS] fail closed; [PASS] live screenshot → YOLOX/OCR → verified sanitized-crop
path on the controlled privacy proof.

**INTEGRATION CHECK:** safe crop is the only image schema accepted by the gateway.

**KNOWN LIMITATIONS:** no unreviewed crop is transmitted, reducing visual task ability.

**NEXT TARGET:** Target 6.

## Target 6 — safe context and privacy gateway

**STATUS:** PASS

**IMPLEMENTED:** strict `SanitizedContext`, outbound secret scan, forbidden-key
scan, endpoint/size controls, no credentials/referrer, response validation, and
ESLint network boundary.

**FILES CHANGED:** privacy pipeline, gateway, shared schemas, tests.

**TESTS RUN:** gateway secret/insecure-endpoint tests and E2E payload capture.

**RESULTS:** raw controlled email is absent from every agent request.

**ACCEPTANCE CRITERIA:** [PASS] one network boundary; [PASS] schema only; [PASS]
known-secret assertion; [PASS] raw fallback absent.

**INTEGRATION CHECK:** E2E performs TYPE_HANDLE without transmitting its value.

**KNOWN LIMITATIONS:** indirect/unknown PII remains bounded by detector quality.

**NEXT TARGET:** Target 7.

## Target 7 — backend orchestrator

**STATUS:** PASS

**IMPLEMENTED:** FastAPI routes, Pydantic contracts, SQLite sanitized traces,
pending-action state, action history, matching verification and legal transitions.

**FILES CHANGED:** `server/app/agent`, `api`, `storage`, tests.

**TESTS RUN:** Pytest API/schema/state-machine suite.

**RESULTS:** out-of-order, wrong-ID and duplicate transitions return 409.

**ACCEPTANCE CRITERIA:** [PASS] state machine; [PASS] sanitized persistence;
[PASS] mock-first planner; [PASS] strict errors.

**INTEGRATION CHECK:** Chrome E2E calls start/verify/step to completion.

**KNOWN LIMITATIONS:** concurrent multi-worker SQLite scaling is out of prototype scope.

**NEXT TARGET:** Target 8.

## Target 8 — Qwen VLM agent

**STATUS:** PASS FOR THE LOCAL PROTOTYPE; BROADER TASK EVALUATION PENDING

**IMPLEMENTED:** Qwen3-VL llama.cpp client, multimodal sanitized crops,
JSON-schema response format, Pydantic parsing, prompt-injection rules and
element/handle/option grounding.

**FILES CHANGED:** `server/app/model/qwen.py`, config, launch script, tests.

**TESTS RUN:** mocked response/grounding tests plus real local Qwen checkout and
privacy-summary browser scenarios.

**RESULTS:** valid grounded actions pass; ungrounded/malformed output is replaced
by a conservative grounded local action; real scenarios complete and emit
measured latency/task results. A fresh complex session always performs its own
Qwen planning turn; deterministic follow-ups are scoped to that session and can
never be inherited from an earlier run with the same task text.

**ACCEPTANCE CRITERIA:** [PASS] exact adapter/runtime path; [PASS] structured
output/grounding; [PASS] controlled real 4B task-quality and latency benchmark
on this development Mac; [FAIL] broader independent task corpus.

**INTEGRATION CHECK:** `MODEL_BACKEND=llama` selects this adapter without changing APIs.

**KNOWN LIMITATIONS:** user must install llama.cpp and download 2.5+ GB weights/projector.

**NEXT TARGET:** Target 9 is testable with the mock planner.

## Target 9 — local action broker

**STATUS:** PASS

**IMPLEMENTED:** backend-optional local controller plus CLICK, TYPE_HANDLE,
SELECT, SCROLL, ASK_USER and FINISH handling;
origin/snapshot/fingerprint/element/visibility/enabled/option/handle/risk checks;
confirmation and verification.

**FILES CHANGED:** action broker, content/background loop, tests.

**TESTS RUN:** action unit tests and Chrome multi-step E2E.

**RESULTS:** secret typing succeeds locally; stale state and high-risk action are blocked.

**ACCEPTANCE CRITERIA:** [PASS] no selectors/code; [PASS] snapshot safety; [PASS]
local handle resolution; [PASS] confirmation; [PASS] re-observe loop.

**INTEGRATION CHECK:** actual built content script mutates a controlled page.

**KNOWN LIMITATIONS:** SPA/framework-specific controls need broader regression pages.

**NEXT TARGET:** Target 10.

## Target 10 — complete product UX

**STATUS:** PASS

**IMPLEMENTED:** task/start/stop, runtime vault, phase, privacy counts, actual
server preview, safe timeline, confirmation, completion and failure UI.

**FILES CHANGED:** popup React UI/style and public-state protocol.

**TESTS RUN:** build, typecheck and Playwright user flow.

**RESULTS:** controlled user flow is operable from the popup.

**ACCEPTANCE CRITERIA:** [PASS] core controls; [PASS] privacy panel; [PASS] actual
preview; [PASS] safe timeline; [PASS] confirmation UI.

**INTEGRATION CHECK:** popup reflects live background state every 500 ms.

**KNOWN LIMITATIONS:** accessibility/usability requires independent human review.

**NEXT TARGET:** Target 11.

## Target 11 — benchmarking, QA and optimization

**STATUS:** PASS FOR THE REPEATABLE LOCAL RELEASE GATE

**IMPLEMENTED:** unit/backend/browser regression suites, 295-case synthetic PII
runner, 100-case pixel redaction benchmark, 60-screen browser perception corpus,
optional real Rampart/Qwen product benchmark, stage latency, browser CPU/RAM/GPU
process memory, package/model footprint and machine-readable SIH scorecard output.

**FILES CHANGED:** `benchmarks/`, tests, benchmark script.

**TESTS RUN:** `./scripts/run-benchmarks.sh`.

**RESULTS:** deterministic, browser compatibility, and—when the stack is
running—real product metrics are calculated rather than hard-coded.

**ACCEPTANCE CRITERIA:** [PASS] one repeatable command; [PASS] privacy regression;
[PASS] controlled Rampart/Qwen latency and task completion; [FAIL] independent
labelled third-party context/visual/task datasets.

**INTEGRATION CHECK:** benchmark command also runs frontend and backend regressions.

**KNOWN LIMITATIONS:** aggregate Chromium CPU/RAM/GPU-process memory is measured;
independent human-reviewed YOLOX detection accuracy remains explicit as unavailable.

**NEXT TARGET:** Target 12.

## Target 12 — final integration and release

**STATUS:** PASS FOR LOCAL PROTOTYPE v1.2.0; INDEPENDENT EXTERNAL ACCEPTANCE PENDING

**IMPLEMENTED:** setup/start/model/demo/smoke/benchmark scripts, versioned v1.2.0
Chrome/Firefox release folders, packaged offline privacy models, Docker backend,
CI, controlled demos, documentation and both browser builds.

**FILES CHANGED:** scripts, demo, README, docs, Compose and CI.

**TESTS RUN:** local full automated gate.

**RESULTS:** the compacted v1.2.0 Chrome release itself passes the real local
Rampart, YOLOX, OCR and Qwen product scenarios. The external regression passes
on WebDriver University, DemoQA and the-internet.herokuapp.com.

**ACCEPTANCE CRITERIA:** [PASS] documented build/run; [PASS] four controlled demo
paths; [PASS] CI definitions; [FAIL] clean second-machine reproduction; [FAIL]
reviewed visual artifacts; [FAIL] GitHub review/protection/tag; [FAIL] manual Firefox/store release.

**INTEGRATION CHECK:** Chrome E2E proves the end-to-end privacy/agent loop.

**KNOWN LIMITATIONS:** see README and external action checklist below.

**NEXT TARGET:** independent acceptance, clean-machine reproduction and
human-reviewed visual/model evidence before a public/store release tag.

## External action checklist

Completed locally: current llama.cpp/Qwen benchmark and a SHA-256-pinned,
CC-BY-4.0 Rampart offline package.

1. Have the privacy/model owner independently review every packaged model license
   and provenance record.
2. Build labelled visual/context/task datasets and record independent results.
3. Reproduce setup and all demos on another teammate's clean machine.
4. Create GitHub `dev`/feature workflow, protections, reviewer evidence and release tag.
5. Manually verify Firefox, then complete browser-store packaging/signing if required.
