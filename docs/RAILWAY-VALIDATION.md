# ContextShield 1.5.0 — railway demo validation

Validation date: 18 September 2026. Base checkout: `5416462c8ef2c8427b516a1c8d2abd64744bc537`.
This report records the candidate tested on that date. Its source, demo and tests
are included in this v1.5.0 publication. See [the publication checks](SIH-RELEASE-v1.5.0.md)
for subsequent checks and presentation updates.

## Outcome and scope

**Fixed:** the specific planner-to-vault private-fill authorization bypass described below. **Demo delivered:** a labelled local railway booking simulation and signed local action ledger. This is not a claim of production readiness, universal prompt-injection protection, a pixel-perfect IRCTC clone, live reservations, or a distributed blockchain.

The packaged Chrome extension completed the entire synthetic booking in both Qwen-assisted and local-rehearsal modes. Both tests exercised the actual MV3 extension, local authorization prompts, browser insertion, final ticket, ledger verification, and rejection of a modified ledger copy. The Qwen-assisted test required a non-null server session and at least one context request; rehearsal required zero context requests and no server session. Tests automatically answered consent prompts with synthetic data; their durations are not human task-latency benchmarks.

## Concrete security path

Before the change, a planner-provided `TYPE_HANDLE` reached `executeInTab`, which resolved a vault handle before destination-specific authorization. The broker required confirmation based on the destination being a password field, rather than the value being private. A password handle directed to an unrelated ordinary text field could therefore bypass the password-field confirmation rule. A fresh read-only boundary investigation independently traced and reproduced that path with synthetic data.

Required invariant: knowing or naming a `LOCAL_*` handle must never grant authority to obtain its value. A private fill needs an explicit, current extension-UI approval bound to the run, tab, document, origin, exact target, field type, task purpose, complete action, snapshot and fingerprint. The live destination must still be valid before the value crosses into the content script and again when it is inserted. Local and server planners must use the same boundary.

Legitimate behavior to preserve: approved form filling, ordinary HTTP pages, textareas, typed clarifications, dropdowns/checkboxes/radio buttons, and device-local tasks when the server is offline.

### Patch strategy

The shared `privateFillGate` sits at the existing `executeInTab` dispatch boundary rather than filtering just one model prompt or just the server planner. It validates the action and advertised field-handle binding, refuses resolution before consent, performs a no-write content preflight, and obtains a one-use scoped grant. `SecretVault.resolve` no longer permits an unscoped read. New runs, stopping, vault changes, expiry and attempted use revoke/consume the grants. The content script binds dispatch to a per-document isolated-world nonce; the broker checks the live target before writing. Panel commands have runtime schemas and approval requests carry a matching random nonce.

The evidence ledger is separate from prevention. SHA-256 links the allowlisted non-secret event records; an ephemeral P-256 key signs the session/count/head checkpoint. The exported public key is not an independently trusted identity. Holding a trusted checkpoint outside the journal is necessary to detect wholesale replacement or truncation. A compromised extension/device is outside this guarantee.

## Ordered verification gates

Commands below are run from the repository root unless otherwise stated.

### 1. Syntax, types, build and diff

| Command/check | Result |
| --- | --- |
| `npm run typecheck` | PASS — shared schemas, extension and judge website |
| `npx eslint extension judge-site shared` | PASS — application source and tests |
| `git diff --check` | PASS |
| `bash -n START.sh RAILWAY-DEMO.command` | PASS |
| `npm run release` | PASS — production Chrome/Firefox builds, pinned-model verification, compact Chrome release and ZIP |
| `npm run build:judge` | PASS — homepage and railway multi-page build |
| `npm run lint` | FAIL — five existing lint errors in unrelated `tmp/presentations/chr0m1um-sih-deck/build-deck.mjs`; that presentation artifact was not edited. Type checks were run separately and pass. |

### 2. Security trigger and alternate malicious cases

`npm run test:e2e --workspace @contextshield/extension -- securityBoundary.spec.ts generalForms.spec.ts popup.spec.ts offline.spec.ts` — **PASS, 6 browser tests**. These fixtures temporarily require port 8000; the local backend was stopped for the fixture run and restarted afterward.

The malicious-server regression submits a schema-valid `TYPE_HANDLE` with a password handle and the current ID of an unrelated textarea. It now fails with `PRIVACY_ASSERTION_FAILED`, presents no approval for that mismatched field, leaves the textarea empty, omits the synthetic password from captured planner request bodies, and records `BLOCKED`. This is the direct evidence that the original path no longer reproduces. It is not a claim that every possible injection has been evaluated.

`npm test` — **PASS, 96 unit tests** (4 shared + 92 extension). New/expanded cases cover unapproved local/server release, wrong destination, changed origin/snapshot/target, failed preflight, revoked runs, each grant-scope component, expiration, replay, vault reuse after clearing, password-to-text actions, textarea compatibility, ledger edit/reordering/truncation/replacement against a trusted checkpoint, and restrictive ledger metadata. Railway-controller tests verify dynamic morning-fare comparison, server delegation in assisted mode, exact local fixture restriction, private-handle-only proposals, and completion/mode semantics.

A single independent fresh candidate review found two concrete regressions: `crypto.randomUUID` was unavailable in ordinary HTTP content contexts, and textarea field typing disagreed with the observation. Both were reproduced, corrected (`getRandomValues` document nonce and consistent text field typing), and covered by a passing real-browser HTTP/textarea test. The reviewer did not identify another confirmed bypass in this scoped path. This was a bounded security-fix review, not a repository-wide audit.

### 3. Legitimate behavior and final packaged product

| Command/check | Result |
| --- | --- |
| The six-test browser command above | PASS — authorized fill/verification, general form controls, clarification sanitization, offline operation, HTTP/textarea compatibility, malicious-action rejection |
| `CONTEXTSHIELD_EXTENSION_PATH=../release/ContextShield-Chrome CONTEXTSHIELD_RAILWAY_QWEN=1 npm run test:e2e --workspace @contextshield/extension -- railway.spec.ts` | PASS — packaged extension, real local Qwen service, complete assisted workflow, correct lowest morning fare, at least four approvals, visible demo ticket, signed ledger and tampered-copy rejection |
| `CONTEXTSHIELD_EXTENSION_PATH=../release/ContextShield-Chrome CONTEXTSHIELD_RAILWAY_EXISTING=1 npm run test:e2e --workspace @contextshield/extension -- railway.spec.ts` | PASS — packaged extension, complete deterministic rehearsal, zero planner context requests, same gate and evidence checks |
| `.venv/bin/pytest server/tests/test_qwen.py server/tests/test_general_forms.py -q` | PASS — 19 backend tests |
| Manual desktop inspection | PASS — search, results, synthetic guest, passenger entry, review, simulated payment and final ticket were traversed and visually inspected; final production page at port 4173 was checked |
| `./START.sh --no-open` | PASS — final demo files synchronized; local Qwen, backend and website running |

Each railway integration test also checks that the page makes no requests outside the local demo origin, and that the final extension preview does not contain the synthetic email. These are deliberately narrow assertions: they are not an independent capture of every extension/model network request.

## Why the railway adapter is explicit

Initial unrestricted Qwen trials did not reliably navigate this multi-screen fixture: an early finish was not a completed booking, and a later response described the correct train but used `SELECT` for a button. Those attempts were not counted as successful tests. An incorrect action was not silently coerced into another action type.

The delivered **Qwen-assisted mode** narrows the model's job to comparing sanitized train buttons and returning a grounded `CLICK`. A declared local workflow adapter handles the remaining known screens through the same gate. Full local vision/OCR/PII processing remains enabled. A visible ticket heading is required before claiming this prepared task completed. The alternate **local rehearsal** is deterministic and DOM-only, explicitly labelled, and does not call Qwen. Neither mode demonstrates general autonomous operation on the real IRCTC website or an unseen website.

## Changed source and artifacts

- Release boundary: `extension/lib/security/privateFillGate.ts`, `extension/lib/vault/secretVault.ts`, `extension/lib/actions/broker.ts`, `extension/entrypoints/background/index.ts`, `extension/entrypoints/content/index.ts`, `extension/lib/messaging/panelCommands.ts`, `extension/lib/messaging/protocol.ts`, `extension/lib/perception/extractObservation.ts`, `extension/lib/privacy/types.ts`, `extension/lib/privacy/pipeline.ts`, `extension/lib/privacy/taskHandles.ts`.
- Evidence/UI: `extension/lib/security/actionLedger.ts`, `extension/entrypoints/popup/LedgerView.tsx`, `extension/entrypoints/popup/App.tsx`, `extension/entrypoints/popup/style.css`.
- Railway workflow/site: `extension/lib/agent/railwayRehearsal.ts`, `judge-site/railway.html`, `judge-site/src/railway/main.tsx`, `judge-site/src/railway/railway.css`, `judge-site/src/App.tsx`, `judge-site/vite.config.ts`; generated `demo/index.html`, `demo/railway.html` and their new hashed assets.
- Tests: new `actionLedger.test.ts`, `privateFillGate.test.ts`, `railwayRehearsal.test.ts`, `securityBoundary.spec.ts`, `railway.spec.ts`; updated `actionBroker.test.ts`, `secretVault.test.ts`, `privacyPipeline.test.ts`, `taskHandles.test.ts`, `popup.spec.ts`, `generalForms.spec.ts` in `extension/tests`.
- Packaging/help: root and extension package versions/lockfile, extension manifest config, `START.sh`, `RAILWAY-DEMO.command`, `docs/RAILWAY-DEMO.md`, this report. No PowerPoint changes were made for this implementation.

Chrome ZIP: `release/ContextShield-Chrome-1.5.0.zip`.

SHA-256: `7320a4c667ad106531e18545dcd4399eb094f3a3964abb052a3387e0b32a386d`.

## Remaining uncertainty and production work

- `npm audit --omit=dev --json` reports **four high-severity dependency entries** through the existing Transformers / ONNX Node / adm-zip / sharp tree. Reachability in the shipped browser bundle was not established. No unrelated forced dependency upgrade was performed. This prevents calling the overall product security-cleared.
- Firefox was built, not runtime-tested. Mobile layouts, accessibility, performance under load, long-running MV3 suspension, and unseen sites need further evaluation.
- The current DOM fingerprint remains a non-cryptographic change detector, supplemented by exact target/document identity and consent. It is not a cryptographic proof of page integrity.
- Approval permits disclosure to the named destination webpage. That webpage can then read/transmit the inserted value. The gate does not make an approved malicious site trustworthy.
- A compromised extension/device, independent checkpoint anchoring, gateway deployment security and model/detector supply-chain auditing remain outside this fix. A self-signed local log does not establish remote attestation or consensus.
- No full network-exfiltration audit, SIH score/accuracy benchmark, live IRCTC integration, real payment, CAPTCHA/OTP automation or live reservation was performed. The simulated ticket is explicitly not valid for travel.
- Grant and ledger data are session-local. Worker shutdown/new runs discard evidence unless exported. Tests prove the listed cases, not zero false positives/negatives or total prompt-injection immunity.

The security-fix skill guided the independent boundary investigation, shared-gate patch, one-cycle regression review and focused verification. The remaining broader product work is intentionally reported rather than represented as completed.
