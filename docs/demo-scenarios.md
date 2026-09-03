# Demo scenarios

Start the mock backend and controlled pages:

```bash
./scripts/start-server.sh
./scripts/start-demo.sh
```

Build/load the extension as described in the README, then open
`http://127.0.0.1:4173`.

## Demo 1 — privacy proof

Open `privacy-proof.html` and ask “Summarize what is safe on this page without
exposing personal or sensitive information.” Show:

1. the raw synthetic name, email, phone, UPI ID, password and fictional portrait on the page;
2. locally detected categories in the popup;
3. the actual `SanitizedContext` under **Actual server view**;
4. the `/v1/agent/start` request in DevTools, with all source values absent.

The image is a generated fictional test fixture. Its face pixels are detected
and dropped locally, not covered with a reversible CSS overlay.

## Demo 2 — autonomous agent

Open `checkout.html`. Add a synthetic email to the local vault and ask:

> Choose the cheapest morning fare, fill my email, continue, and place the order.

With the mock planner, the sequence is deterministic: `TYPE_HANDLE`, `SELECT`,
`CLICK`, confirmed `CLICK`, then `FINISH`. With `MODEL_BACKEND=llama`, Qwen selects
the action. Show each observe, sanitize, plan, validate, execute and verify event.

## Demo 3 — local secret handle

Use the checkout flow and inspect agent requests. The server receives
`LOCAL_EMAIL_1`, returns `TYPE_HANDLE`, and never receives the actual email. The
content script resolves the handle locally immediately before typing.

This path is also automated by `extension/tests/popup.spec.ts`, which captures
every API payload and asserts the source email is absent.

## Demo 4 — fail closed

Available demonstrations:

- open `fail-closed.html` and ask `Click Arm stale-state mutation, then click
  Continue to finish task.`; the page reveals a target and repeatedly replaces
  it while the next action is prepared. The
  first stale action is rejected and the run ends immediately with `Page changed
  after planning; the stale action was blocked.`;
- deny the **Place order** confirmation; the action is not executed;
- disconnect the backend or block Rampart initialization; no raw fallback request
  is made;
- use the prompt-injection backend test; unsupported action/code output is invalid.

Automated evidence is in the action-broker, privacy-pipeline, gateway, server
schema/state-machine, and Chrome E2E tests.

## Demo 5 — general website controls

Open `general-controls.html` and ask:

> Select Python from the first dropdown, select Option 2, select the Blue radio button, and stop.

The planner receives the dropdown's current selection, ordered exact options,
checkbox/radio state, and locally sanitized semantic values. It should execute
`SELECT`, `CLICK`, `CLICK`, then `FINISH` without asking the user for an element
ID. This flow is automated against the local fixture.

## Public fixture

Open Selenium's official form at
`https://www.selenium.dev/selenium/web/web-form.html` and ask:

> Fill the Text input with ContextShield public test, select Two from the Dropdown, check the Default checkbox, and do not submit.

The final value, selected option, checked state and unchanged URL are covered by
the opt-in external browser regression. The generic text value is represented by
a local handle before the server boundary.
