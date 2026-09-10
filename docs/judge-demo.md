# ContextShield judge demonstration

**Team Chr0m1um · SIH 26171 · three-minute live demonstration**

Use one page: <http://127.0.0.1:4173/judge-run.html>. It combines a fictional profile, a real image, a password and a fare-comparison task. The models, privacy gateway, server and browser actions run normally; this is not a simulated animation.

The judge website is built from the React and Tailwind source in `judge-site/`.
`START.command` rebuilds it automatically before starting the services.

## Before the judges arrive

1. Double-click `START.command` in the project folder.
2. Wait until the Terminal says `ContextShield is running`.
3. Open <http://127.0.0.1:4173>.
4. Confirm the home page says the Agent API is **Online** and the reasoning mode is **Qwen3-VL ready**.
5. On `chrome://extensions`, reload ContextShield once after this update. Its footer must show **v1.4.0**. The stable unpacked folder is `release/ContextShield-Chrome`.
6. Open the single demo page above. Open the extension, click **Use demo task**, then **Start agent**. Keep the website active. Run this once before presenting to load the local models and verify the machine is ready.
7. Reload the demo page before the judged run to reset its dropdown and button. Use only synthetic values. No vault setup is needed for this demonstration.

If the home page says **API only**, Qwen is not responding. Exact local select, checkbox, radio, structured form and page-summary tasks can still run, but the autonomous comparison demo needs Qwen. Run `./STATUS.sh`, then `./STOP.sh` and `./START.sh` if necessary.

## The three-minute script

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:10 | Extension → **Use demo task** → **Start agent** | “Compare fares and prepare a test ticket, without sharing my private details.” |
| 0:10–1:50 | Keep the page active. Explain the fictional profile and Read → Hide → Plan → Act while the real task runs. | “The AI needs these fares, not my name, email, password or face. Read and Hide happen on this device. Local vision and text checks remove detected private information before the server receives context.” |
| 1:50–2:00 | The ₹899 fare and **Ticket prepared** | “The server chooses the next action. The browser validates it and checks the result. This is a test ticket—no purchase.” |
| 2:00–2:40 | Extension → **Show the privacy proof**. Optionally **Freeze view**. | “Left: what stayed local. Right: the actual redacted image and readable structure allowed through. ‘Server responded’ confirms a response. We did not send the original screenshot.” |
| 2:40–3:00 | Keep the privacy proof visible; explain verbally | “Encryption protects the journey, but the receiving server decrypts it. ContextShield limits what arrives in the first place. We need both.” |

The four steps are a live status display, not a timed animation. Read → Hide → Plan → Act can repeat as the agent observes the result of each action. Technical logs and JSON are available under details, but are not part of the three-minute pitch.

Start the task immediately and explain while it runs. Local Qwen on this machine can take most of the first two minutes; this is not a guaranteed runtime. Rehearse on the presentation laptop, with unnecessary applications closed.

**Use the actual page result, not just the green extension badge.** The fare must be ₹899 and “Ticket prepared” must appear. If it stops, show the reason honestly; do not describe a timeout, partial selection or safety stop as successful task completion.

### What the proof means

- The presentation starts with the **first sanitized snapshot**, retained locally, so the original privacy evidence does not disappear after the page changes. The latest snapshot is available under details.
- Repeated detector hits for the same local text value or visual face identity are grouped. These are **detection groups, not unique people or accuracy scores**. Uncorroborated language-model or OCR detections and low-confidence findings are shown separately; they are still masked.
- The image is the actual sanitized crop from that context—not a staged before/after drawing. If no image was included, the view explicitly says so.
- “Handled on device” means no context was sent. “Server responded” means a valid response arrived. Unconfirmed delivery is labelled as such. This view reports extension state, not an independent packet capture.
- The proof tab is read-only and cannot be opened through the extension while a task is running. Switching target tabs during capture is checked and stops the task safely.

### How this addresses the PS

| PS requirement | Evidence in this run |
| --- | --- |
| Local visual perception | Browser-local YOLOX face detection and targeted OCR; real portrait pixels, not an annotation-only fixture |
| Client-side privacy filter | Hidden sensitive groups and the actual redacted image, before the request |
| Central server integration | Qwen receives sanitized context and returns grounded actions; request status is visible |
| End-to-end assistance | The lowest fare is selected and a test ticket is prepared, with local action checks |
| Latency/resource/accuracy trade-offs | Measured stage timings under technical details; benchmark evidence remains separately scoped |

One live run demonstrates the pipeline. It does **not** establish population-level detection precision/recall, redaction precision, cross-site accuracy or extension-only memory usage. Do not present detector counts as the PS's accuracy metrics.

## Optional longer demonstrations

These are alternatives for Q&A, not additional steps in the three-minute route.

### 1. Privacy boundary, 90 seconds

Open <http://127.0.0.1:4173/privacy-proof.html> and run:

> Summarize what is safe on this page without exposing personal or sensitive information.

Show the fictional portrait, email, mobile, UPI and password on the page. Keep that website active until the task stops: screen capture reads the active tab. Then click **Show the privacy proof**, or **Privacy proof → Open judge view**. Put the synthetic test page and the read-only view side by side after the run. **Freeze view** freezes only the display, not the agent. Return to the target website before another task.

On the left, point to the sensitive classification counts and masked representations. The originals are deliberately not copied into the presentation view. On the right, point to the actual sanitized task, readable page records, local references and any sanitized image crops. If there are no crops, say that this snapshot contains no image data; do not imply the server received a screenshot.

This summary task is handled locally: the receipt should say **Handled on device · this context was not sent**, with zero context request attempts. It demonstrates local privacy processing, not server inference. For a server-assisted example, use the comparison task. JSON remains optional under **Detection details and exact server context**.

### 2. Autonomous task and secret handle, 120 seconds

Open <http://127.0.0.1:4173/checkout.html>. Add a synthetic email to the extension vault, then run:

> Choose the cheapest morning fare, fill my email, continue, and place the order.

Show that the server sees `LOCAL_EMAIL_1`, not the email. The planner should choose the lowest fare. The extension must ask before **Place order**. Select **Allow once** and show the verified completion state.

### 3. Device-local controls, 60 seconds

Open <http://127.0.0.1:4173/general-controls.html> and run:

> Select Python from the first dropdown, select Option 2, select the Blue radio button, and stop.

The extension should perform all three changes without Qwen. Point to **Local controller returned a structured action** in the activity log.

### 4. Fail closed, 90 seconds

Open <http://127.0.0.1:4173/fail-closed.html> and run:

> Click Arm stale-state mutation, then click Continue to finish task.

The page repeatedly replaces the Continue target while the action is being
prepared. The expected result is `Page changed after planning; the stale action
was blocked.` A step-limit or time-limit result is not a passing demonstration.

## Public-site proof

Run public pages only after the controlled route. These sites are maintained by third parties and can change.

### Selenium official web form

Open <https://www.selenium.dev/selenium/web/web-form.html> and run:

> Fill the Text input with ContextShield public test, select Two from the Dropdown, check the Default checkbox, and do not submit.

This exercises the generic local text-handle path added for public forms, plus a native select and checkbox.

### The Internet checkboxes

Open <https://the-internet.herokuapp.com/checkboxes> and run:

> Select the first checkbox and clear the second checkbox.

The first checkbox must end checked and the second must end clear.

### The Internet dropdown

Open <https://the-internet.herokuapp.com/dropdown> and run:

> Select Option 2 from the dropdown and stop.

## The simple explanation

### Why encryption alone is not enough

“Encryption locks the envelope while it travels. But the receiving server opens it. ContextShield removes the detected private details before putting anything in that envelope. The AI gets the page structure and local references; it does not need the original email or password to choose the next action.”

Ordinary HTTPS protects against interception; the receiving endpoint decrypts the data for processing. Encryption at rest protects stored bytes but does not hide data from an authorized service reading it. ContextShield adds client-side data minimization. Use it **with** transport encryption, not instead of it. Specialized encrypted computation such as FHE is a different architecture, not ordinary HTTPS. See [TLS 1.3 record protection, RFC 8446 §5.2](https://www.rfc-editor.org/rfc/rfc8446.html#section-5.2).

The current prototype uses HTTP to a loopback planner on the same machine; the gateway rejects insecure remote endpoints, and remote deployment also requires updating the extension's CSP allowlist. Detection can miss PII and retained context can reveal information indirectly: do not claim perfect anonymity. Vault references protect values from the planning server, not from the destination website when the user authorizes filling its fields. The visual view is based on extension state, not an independent packet capture. Health checks and action-verification messages are not included in the context request counter.

### Explain the processing loop

1. The browser reads the page and screenshot locally.
2. YOLOX finds faces, PP-OCR reads pixels and Rampart classifies sensitive context.
3. Private data is dropped, abstracted, masked or replaced with a local handle.
4. A strict gateway checks the payload. Raw screenshots, DOM, cookies and vault values have no allowed server field.
5. Qwen returns one typed action using only safe element IDs and available handles.
6. The browser validates the snapshot, asks before risky actions, executes locally and verifies the result.
7. Anything stale, unsafe, unsupported or unverifiable stops closed.

## Impact and adoption answer

If a judge asks who buys this, answer: “We start with one privacy-sensitive
government or regulated-enterprise workflow. The organisation deploys a managed
extension and an on-premises or private-cloud planner. It pays for deployment,
policy packs, audit evidence, support and signed model updates. We measure task
completion, privacy leakage and time saved in the pilot before expanding.”

Do not claim existing customers, revenue or compliance certification unless the
team has separate evidence for them.

## Claims to make carefully

- Say `167 of 167 expected interactables on 60 controlled screens`, not `100% visual accuracy`.
- Say `100% precision and recall on 295 labelled synthetic PII cases`, not `perfect PII detection everywhere`.
- Say `100 of 100 controlled supplied-box redactions verified`, not `perfect end-to-end visual detection`.
- Say `3.67 seconds median across three controlled completed tasks` and name the scope.
- Say the measured 1.26 GB figure is the aggregate Chromium test profile, not extension-only RAM.
- Do not claim universal website compatibility. Browser-owned pages, closed shadow roots and inaccessible cross-origin frames remain outside the extension's control.
