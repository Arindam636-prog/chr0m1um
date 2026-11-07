# ContextShield publication checks, 7 November 2026

This update synchronizes the public repository with the railway demonstration
and the product described in the LinkedIn post. It includes the current extension,
demo website, six-slide PPTX, synthetic evidence and regression tests.
The product is the ContextShield browser extension. Railway booking is its
controlled demonstration, with fictional fares and simulated payment.

[Watch the recorded demo](https://youtu.be/n6stx4sawr4).

## Behavior included

- Journey and passenger fields start empty. Loading the synthetic profile loads
  the local vault and prepared request without starting a run.
- The local railway adapter reads the requested route, date, class, quota and
  passenger preferences. Unavailable values stop the run without substitution.
- Assisted mode uses Qwen for fare comparison. Other prepared railway screens
  use the declared local adapter. Rehearsal disables Qwen and visual inference.
- Exactly three private fills and simulated payment require approval in the
  tested booking. Train selection alone does not request purchase approval.
- The passenger photo appears on the passenger-details page. Privacy proof
  distinguishes retained local image evidence from a server-planned context.
- The page-injection fixture accepts manual edits and reports the applied text.
  Privacy proof shows the sanitized attack and the service's validated action.
- The signed event ledger exposes editable copies, recomputed hashes, checkpoint
  comparison and successful verification after restoring the original copy.
- Generic visual comparisons retain OCR records in the model prompt. The local
  readiness guard stops when privacy filtering removes the comparison criterion.

## Checks run for this publication

| Check | Result |
| --- | --- |
| ESLint and shared, extension and website TypeScript checks | Passed |
| Shared and extension unit tests | 117 passed, 6 shared and 111 extension |
| Python Ruff and backend tests | Passed, 36 tests |
| Production Chrome and Firefox builds | Passed |
| Production judge website build | Passed |
| Default Chromium browser regressions | 9 passed, 13 opt-in cases skipped |
| Real Qwen-assisted railway browser regression | 1 passed, 34.0 seconds for the test runner |
| Git whitespace checks and credential-pattern scan of publication files | Passed |

The assisted run used the locally cached Qwen3-VL-4B Q4_K_M model and vision
projector through llama.cpp, the current source backend and a fresh MV3 Chromium
profile. It reached booking completion and checked four approvals, private-fill
handling, no external railway-page requests and signed-ledger tamper rejection.
The test-runner duration includes setup and is not a median task-latency benchmark.
The manual injection fixture was not enabled in that assisted run. Its context
construction and scope checks are covered by unit tests. A separate browser
regression checks rejection of a malicious password-to-unrelated-field action.

A bounded security diff review covered all 33 changed source files in the
pre-publication snapshot against commit
`39f3962350e11ca05da20e0329aa7e1c1a1f3022`. No introduced reportable security issue
was identified in that review. This is not a full repository audit or a claim of
universal injection resistance. Subsequent publication edits update documentation,
guard the historical evidence exporter and regenerate/select website assets.

## Evidence and limits

The [September benchmark report](FINAL-VALIDATION.md) remains a dated snapshot.
Its 3/6 visual-task result, PII scores, crop checks, memory measurements and
52.74-second median belong to that original dataset and source hashes. They were
not rerun or relabeled as November benchmarks.

Firefox was built but not runtime tested in this publication. The broader live,
external-site and adversarial opt-in suites were not rerun. Existing dependency
audit work, low-end-device profiling and independent unseen-site evaluation remain
open. No new dependency upgrades are included.

The local gate enforces private-release policy. The signed event chain records
decisions and detects edits relative to a retained checkpoint. It is not a
distributed blockchain or a prompt-injection detector. An approved destination
webpage can read the values filled into it. A compromised extension or device is
outside these prototype guarantees.

Normal startup binds services to loopback. The existing optional Docker Compose
configuration publishes port 8000 on the host and is not equivalent to the
loopback-only script deployment. The API does not provide client authentication.

## Reproduce the current checks

```sh
npm ci
npm run lint
npm test
.venv/bin/ruff check server
.venv/bin/pytest server/tests
npm run build
npm run build:firefox
npm run build:judge
npm run test:e2e --workspace @contextshield/extension
```

For the separate assisted regression, start the full local services with
`START.command`, then run:

```sh
CONTEXTSHIELD_RAILWAY_QWEN=1 npm run test:e2e --workspace @contextshield/extension -- tests/railway.spec.ts
```

The default suite owns local fixture ports, so stop other demo services before
running it. The assisted test instead requires the running services on 4173,
8000 and 8080. Both commands use the freshly built `.output/chrome-mv3` extension.

For an existing installed extension, follow the rebuild and reload instructions
in [START-HERE.md](../START-HERE.md). Source changes alone do not replace a
previously installed `release/` build.
