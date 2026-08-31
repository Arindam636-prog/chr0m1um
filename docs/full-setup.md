# Full setup in plain language

## Normal use

Double-click `START.command`, or run:

```bash
cd "/Users/arindam/Documents/SIH 2026/contextshield" && ./START.sh
```

That launcher does the setup work for you: installs project packages when needed,
creates a stable extension release once, installs/starts llama.cpp, downloads and starts Qwen3-VL,
starts the FastAPI backend, starts the demo site, and opens it. The first Qwen
download is about 3 GB and may take several minutes. It is cached for later runs.

Load `release/ContextShield-Chrome` once at `chrome://extensions`, open
<http://127.0.0.1:4173>, choose **Checkout Demo**, add an Email to the extension
vault, enter `Choose the cheapest morning fare, fill my email, continue, and
place the order.`, and press **Start agent**. Click **Allow once** when the final
Place order action asks for local confirmation.

The launcher returns after startup and the services stay alive in the background.
Stop with `STOP.command` or `./STOP.sh`. Check all three services at any time
with `./STATUS.sh`.

## What each local component does

1. The content script creates a small semantic description of buttons, fields,
   labels, and suspicious visual regions. It never sends raw HTML.
2. Deterministic validators and the packaged offline Rampart model detect private text inside browser
   workers. Private values become abstractions or memory-only `LOCAL_*` handles.
3. Chrome captures the visible tab only after you invoke the extension. An
   offscreen extension page runs the packaged YOLOX face detector and official
   PP-OCRv6-tiny detector/recognizer. OCR is targeted to suspicious regions.
4. Face and sensitive-text pixels are blacked out. ContextShield verifies and
   hashes the modified PNG; failure blocks transmission.
5. The local FastAPI service accepts only the strict sanitized schema. It asks
   Qwen3-VL, running locally through llama.cpp, for exactly one typed action.
6. The extension validates that action against the current page, executes it,
   verifies the result, and observes again.
7. Native dropdowns expose both their option list and current selection.
   Checkboxes/radios expose locally sanitized labels and semantic values. This
   lets the planner ground “first dropdown”, “Option 2”, or “Blue” without
   inventing an element ID.
8. If the planner returns ASK_USER, the popup provides a text answer field. The
   answer is kept local until the same privacy pipeline has sanitized it.

## Useful checks

```bash
./scripts/doctor.sh --full
./scripts/check.sh
./VERIFY.sh
```

`./VERIFY.sh` is the full release gate and requires the normal stack to be
running. It executes the clean and extension-injected browser corpus, backend
tests, real Rampart/YOLOX/OCR/Qwen flows, and writes the benchmark report.

`./START.sh --mock` keeps all real privacy, OCR, YOLOX, action, and verification
stages but swaps Qwen for a predictable test planner. Use it for automated demos;
use normal `./START.sh` for the complete local prototype.

## Honest prototype boundary

The shipped YOLOX checkpoint is a face-only prototype checkpoint trained on the
Open Images face class and exported through the official YOLOX code. Identity
documents are classified conservatively from OCR matches for critical Indian ID,
bank, and payment formats; there is not yet a separately benchmarked two-class
face/document YOLOX checkpoint. Suspicious regions fail closed, and declared face
regions are fully masked. Before production, build a labelled representative
visual test set and replace/benchmark the detector for the intended deployment.

Artifact revisions and hashes are recorded in
`extension/public/models/README.md`.
