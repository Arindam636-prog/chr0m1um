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
4. Confirm that the popup footer says **v1.3.0**.
5. Open <http://127.0.0.1:4173> and select **Run the 6-minute proof**.
6. Click the ContextShield extension icon.
7. Add an Email to the memory-only local vault.
8. Enter `Choose the cheapest morning fare, fill my email, continue, and place the order.`
9. Click **Start agent**, then **Allow once** when it asks before Place order.

Normal `./START.sh` runs rebuild the React judge website but do not rebuild or
modify the installed extension. Reload the extension only after intentionally
creating a new release with `npm run release`.

### Public-site proof

For the most complete public proof, open
<https://www.selenium.dev/selenium/web/web-form.html> and enter:

`Fill the Text input with ContextShield public test, select Two from the Dropdown, check the Default checkbox, and do not submit.`

ContextShield should fill the generic text field through a local `LOCAL_TEXT_1`
handle, select Two, check the Default checkbox, leave the page unsubmitted, and
finish. This exact task and final state are covered by the opt-in external
regression test.

Open <https://the-internet.herokuapp.com/checkboxes> and enter:

`Select the first checkbox and clear the second checkbox.`

ContextShield should check the first box, clear the second box, and finish in
well under the two-minute safety deadline. This exact URL and final state are
covered by the release regression suite.

The control room at <http://127.0.0.1:4173> contains two more public fixtures,
copy-ready prompts and the complete judge route. Third-party pages can change,
so always run the controlled route first.

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

The latest completed measured baseline is recorded in
[docs/SIH-ACCEPTANCE-v1.2.0.md](docs/SIH-ACCEPTANCE-v1.2.0.md). The v1.3.0
release adds the judge control room and public-form compatibility improvements. This is a broad
prototype, not a truthful guarantee that every control on every future website
will be automatable.

For a fast predictable test without Qwen, use `./START.sh --mock`. The normal
`./START.sh` command uses real local Qwen.
