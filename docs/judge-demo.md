# ContextShield judge demonstration

This is the safe, repeatable order for presenting the complete system. The judge-facing website at <http://127.0.0.1:4173> contains the same route, live service health and measured benchmark evidence.

The judge website is built from the React and Tailwind source in `judge-site/`.
`START.command` rebuilds it automatically before starting the services.

## Before the judges arrive

1. Double-click `START.command` in the project folder.
2. Wait until the Terminal says `ContextShield is running`.
3. Open <http://127.0.0.1:4173>.
4. Confirm the home page says the Agent API is **Online** and the reasoning mode is **Qwen3-VL ready**.
5. Confirm the installed extension footer shows the current release version.
6. Use only synthetic values during the demonstration.

If the home page says **API only**, Qwen is not responding. Exact local select, checkbox, radio, structured form and page-summary tasks can still run, but the autonomous comparison demo needs Qwen. Run `./STATUS.sh`, then `./STOP.sh` and `./START.sh` if necessary.

## Six-minute route

### 1. Privacy boundary, 90 seconds

Open <http://127.0.0.1:4173/privacy-proof.html> and run:

> Summarize what is safe on this page without exposing personal or sensitive information.

Show the fictional portrait, email, mobile, UPI and password on the page. In the extension, show the local category counts and expand **Actual server view**. The source values and face pixels must be absent. Explain that YOLOX, PP-OCR and Rampart ran in browser workers before the only outbound gateway was reached.

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
