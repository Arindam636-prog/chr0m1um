# ContextShield 1.5.0 publication

Publication date: 19 September 2026.

## Included in this version

- Labelled railway booking sandbox, synthetic profile, assisted workflow and
  deterministic local rehearsal.
- Shared one-use private-fill authorization gate for local and server proposals.
- Local non-secret event hash chain with a signed checkpoint, export and
  tampered-copy verification.
- Regression tests for unauthorized secret release, changed destinations,
  consent replay, ordinary HTTP/textarea compatibility and railway completion.
- [Current SIH presentation](presentation/SIH.pptx), with linked academic sources
  and a clear separation between dated test results and planned evaluation.
- [Demo instructions](RAILWAY-DEMO.md) and the
  [18 September validation report](RAILWAY-VALIDATION.md).

This is a local simulation, not live IRCTC integration. Qwen compares the prepared
fare options in assisted mode; a declared local adapter handles the other known
screens. Rehearsal is DOM-only and makes no Qwen requests. The event ledger is not
a distributed blockchain and does not identify prompt injection by itself.

## Checks rerun before publication

| Check | Result |
| --- | --- |
| `npm run lint` | Passed, including all three workspace type checks |
| `npm test` | Passed: 4 shared + 92 extension unit tests |
| `.venv/bin/ruff check server` | Passed |
| `.venv/bin/pytest server/tests -q` | Passed: 35 backend tests |
| `npm run build:judge` | Passed: homepage and railway site |
| `npm run build` | Passed: production Chrome extension |
| `npm run build:firefox` | Passed: Firefox build only |
| `npm run test:e2e --workspace @contextshield/extension` | 9 passed, 12 skipped |
| `git diff --check` | Passed |

The nine browser cases cover observation compatibility, form controls,
clarification sanitization, offline operation, private-handle approval,
privacy-proof rendering, the complete railway rehearsal and the two
security-boundary cases. The twelve opt-in tests require live models, external
sites or the full-model audit and were not enabled for this publication. A new
real-Qwen railway run, latency benchmark or independent network audit was not
performed. Historical assisted-mode evidence remains dated in the linked report.

Publication maintenance excludes archived presentation build scripts under
`tmp/presentations/` from application ESLint and fixes existing Python lint
formatting without changing the tested planner behaviour. Application lint rules
remain enabled. Basic secret-pattern and file-scope checks were applied to the
new publication files; these do not constitute a security audit.

The presentation retains six slides and a blank Team ID. Its links point to the
public source, demo guide and validation report. The running application, local
model and browser extension still require local installation.

## Known limitations

The validation report's deployment limitations still apply, including its
dependency advisories, untested Firefox runtime, unseen-site evaluation and
independent checkpoint retention. Passing these checks does not establish
universal prompt-injection resistance or production readiness. Approved webpages
can read the values inserted into them.

Credentials, local runtime data, dependencies, generated extension installations,
large local Qwen weights and private slide-build/backup files are excluded from
this source publication. Model provisioning instructions remain in the setup
scripts. To generate the extension packages locally, run `npm run release` after
installing prerequisites.
