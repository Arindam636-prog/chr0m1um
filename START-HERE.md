# Start here — one command

On macOS, double-click **START.command**. That is the normal way to run the
whole product. If macOS asks, choose **Open**.

The Terminal equivalent is one command:

```bash
cd "/Users/arindam/Documents/SIH 2026/contextshield" && ./START.sh
```

You can close that Terminal window after it says the system is ready. The local
services continue in the background. On the first run, ContextShield installs anything
missing and downloads the local Qwen3-VL model (about 3 GB), so it may take several
minutes. Later starts reuse the downloaded model.

When Terminal says **ContextShield is running**, install the stable extension
once:

1. Open `chrome://extensions` in Chrome.
2. Remove older ContextShield development builds.
3. Enable **Developer mode**, click **Load unpacked**, and select
   `release/ContextShield-Chrome`.
4. Confirm that the popup footer says **v1.2.0**.
5. Open <http://127.0.0.1:4173> and choose **Checkout Demo**.
6. Click the ContextShield extension icon.
7. Add an Email to the memory-only local vault.
8. Enter `Choose the cheapest morning fare, fill my email, continue, and place the order.`
9. Click **Start agent**, then **Allow once** when it asks before Place order.

Normal `./START.sh` runs do not rebuild or modify the installed extension. Reload
it only after intentionally creating a new release with `npm run release`.

### Public-site proof

Open <https://the-internet.herokuapp.com/checkboxes> and enter:

`Select the first checkbox and clear the second checkbox.`

ContextShield should check the first box, clear the second box, and finish in
well under the two-minute safety deadline. This exact URL and final state are
covered by the release regression suite.

For the reported React-form proof, open
<https://demoqa.com/automation-practice-form> and enter:

`Fill the form with test information: first name Context, last name Shield, email fixture@example.invalid, gender Male, mobile 9000000001, and address Fixture Kolkata. Do not submit it.`

ContextShield should fill exactly those five text fields, select Male, leave all
hobbies unchanged, and finish without clicking Submit. Values written directly
in a structured task are converted to memory-only `LOCAL_*` handles before the
safe page description reaches the backend.

Chrome shows an all-sites permission because ContextShield must work on arbitrary
HTTP/HTTPS pages and retain access after navigation. It does not register an
always-running content script: page observation begins only when you press
**Start agent**.

To stop everything, double-click **STOP.command** or run `./STOP.sh`.

The popup shows **Local + Qwen modes ready** when the full stack is available.
If Qwen is stopped, it shows **Device-local mode ready**: simple form, control,
scroll and screen-summary tasks still work. Double-click `START.command` only
when you need comparison, ranking, research, or other Qwen reasoning.

## What is happening, simply

- The extension captures and analyses the visible viewport on your computer.
- Dropdowns include their current option, and checkbox/radio controls include
  safe labels and values, so requests such as “first dropdown”, “Option 2”, and
  “blue radio button” can be grounded.
- The packaged Rampart model and format checks find private text locally. Rampart
  does not download model files when the extension starts.
- YOLOX detects faces locally. PP-OCR reads viewport pixels and visible image,
  canvas and PDF regions. OCR/vision boxes are fused with DOM controls by their
  bounding boxes; pixel-only records remain non-clickable. Unchanged visual
  surfaces reuse their verified analysis to avoid screenshot throttling.
- Only the safe page description and verified safe image crops can reach the
  backend running on your own Mac.
- A small local controller handles exact selects, checkbox/radio state, local
  handles, scrolling, screen summaries and named navigation buttons without a
  server request. Qwen3-VL is used only when the task needs reasoning. Every
  returned action is checked, performed locally and verified before continuing.
- If Qwen genuinely needs a missing detail, the popup shows a text box. Your
  reply passes through the same local privacy scan before replanning.

Normal websites are supported. Chrome-protected pages (`chrome://`, the Chrome
Web Store), closed Shadow DOM, browser-owned PDF UI, and inaccessible
cross-origin frames cannot be controlled by browser extensions.

The exact tests and measured scope of this release are recorded in
[docs/SIH-ACCEPTANCE-v1.2.0.md](docs/SIH-ACCEPTANCE-v1.2.0.md). This is a broad
prototype, not a truthful guarantee that every control on every future website
will be automatable.

For a fast predictable test without Qwen, use `./START.sh --mock`. The normal
`./START.sh` command uses real local Qwen.
