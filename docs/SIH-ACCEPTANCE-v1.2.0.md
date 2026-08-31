# ContextShield v1.2.0 — measured SIH acceptance

This is the release evidence for the local prototype built on 31 August 2026.
Every number below comes from the checked-in automated harness on the same
development Mac. Controlled or synthetic results are labelled as such and are
not presented as independent production accuracy.

## Release artifact

- Chrome unpacked release: `release/ContextShield-Chrome`
- Chrome ZIP: `release/ContextShield-Chrome-1.2.0.zip`
- ZIP size: 40,274,320 bytes (about 38.4 MiB)
- ZIP SHA-256: `f424537451d7112e86f00d8a5916777daf04084c6c34aea0cbba0789e33a2244`
- Firefox MV3 build: `release/ContextShield-Firefox`

## Official SIH metric evidence

| Published dimension | Measured v1.2.0 result | Scope |
| --- | ---: | --- |
| Visual context | 167/167 relevant interactables, recall 1.00 | 60 controlled screens including dynamic DOM, open Shadow DOM, Canvas, image-heavy, large and 47 unfamiliar generated layouts |
| PII detection | precision 1.00, recall 1.00, F1 1.00 | Synthetic 295-case corpus: 195 labelled sensitive and 100 benign cases |
| Text redaction | entity-removal recall 1.00; leakage 0 | Same controlled PII corpus |
| Pixel redaction | sensitive-pixel recall 1.00; non-sensitive preservation 1.00 | 100 generated raster-mask cases |
| Client package | 104,418,883 unpacked bytes; 25,299,007 model bytes | Compacted Chrome release |
| Browser resources | peak aggregate test-profile RSS 1,356,054,528 bytes; peak GPU-process RSS 157,024,256 bytes | All Chromium processes in the isolated benchmark profile; not extension-only RAM |
| Browser CPU | average aggregate 77.50% | Sum of Chromium process CPU on a 10-logical-core Mac; 100% represents one fully used logical core |
| End-to-end latency | median 3,668.0 ms | Three controlled full-product tasks |
| Local visual/redaction stage | median 282.2 ms | Same full-product runs |
| Local privacy classification | median 596.6 ms | Same full-product runs |
| Task completion | 3/3 | Controlled real-product scenarios; not an independent finale task corpus |

The checkout case was run from a fresh session. It completed five agent steps in
about 14.1 seconds and included a genuine Qwen planning inference; later grounded
steps were resolved without repeatedly invoking Qwen.

## Browser and website evidence

The Chrome release—not only the source build—passed:

- autonomous checkout with a local vault handle and confirmation gate;
- local privacy summary with no backend planning request;
- stale-page fail-closed termination on the first rejected action;
- dropdown, checkbox and radio control completion;
- WebDriver University public controls;
- DemoQA React practice form with a binding “Do not submit” instruction;
- the-internet.herokuapp.com ordinal checkbox state changes;
- Qwen/backend offline completion for an exact local checkbox task.

Both Chrome and Firefox MV3 artifacts build successfully. Chrome received the
automated runtime coverage above. Firefox runtime/UI and store signing still
require a manual browser acceptance pass.

## Privacy invariants exercised

1. The viewport is captured and YOLOX/PP-OCR inference occurs locally.
2. Pixel evidence is fused with DOM/ARIA records by bounding boxes.
3. Pixel-only records are disabled and cannot become arbitrary click targets.
4. Rampart and deterministic detectors run before the only outbound gateway.
5. Raw page DOM, raw screenshots and vault values are absent from the server schema.
6. Known local secrets are searched again immediately before transmission.
7. Invalid, stale, disabled, ungrounded and prohibited actions are rejected.
8. Privacy/model/redaction failure blocks transmission rather than selecting a raw fallback.

## Honest remaining limits

- The packaged YOLOX artifact detects faces; private-document decisions also use
  OCR and deterministic PII evidence. Independent human-reviewed face/document
  detection accuracy is not available and the benchmark reports it as unavailable.
- Controlled 1.00 scores do not predict real-world or SIH-finale accuracy.
- Chrome-protected pages, the Chrome Web Store, closed Shadow DOM, browser-owned
  PDF controls and inaccessible cross-origin frames cannot be automated by a
  normal extension.
- Website UI changes can invalidate any external regression. The system stops
  safely when a requested action cannot be grounded.
- A clean second-machine reproduction and manual Firefox pass are still required
  before calling this a public/store release.

Machine-readable evidence is in `benchmarks/results/latest.json`; rerun the full
gate with `./VERIFY.sh` while `./START.sh` is running.
