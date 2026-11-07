# ContextShield 1.5 — railway demo

## What this is

A clearly labelled, IRCTC-style **local simulation**, not an exact copy of the live website and not affiliated with IRCTC. It implements the booking sequence: station/date/class search, visible train/fare comparison, synthetic guest session, passenger form, review, simulated payment, and a printable demo ticket. Fares, availability, passenger data and booking references are fictional. No real login, CAPTCHA solving, OTP, payment processing or reservation is implemented. The same fictional train fixtures serve every selectable route/class.

The new security feature is a **one-device signed action ledger**, not a distributed blockchain. Credentials are not blocks, not placed on-chain, and not hashed into public credential records. A hash chain does not detect prompt injection by itself.

## Start

1. Double-click `RAILWAY-DEMO.command` for the model-free rehearsal. Keep its terminal open. Or use the existing `START.command` for the complete Qwen/vision services.
2. Open Chrome's Extensions page, enable Developer mode and load `release/ContextShield-Chrome` as an unpacked extension. If this folder is already loaded, press **Reload** there. Confirm version **1.5.0**. This does not update an already-installed ZIP automatically.
3. Open <http://127.0.0.1:4173/railway.html>. The project homepage also has a **Railway demo** link and a judge-route card.
4. Open ContextShield → **Railway demo** → **Load synthetic profile**. This replaces the vault with a fictional name, reserved-domain email and demo phone. It also fills the task box with the complete booking request. It does not start the agent. The website fields remain empty. Do not use real data.
5. For the model-free run, enable **Local railway rehearsal**, then **Start agent**. Keep the railway tab active. The agent fills the journey fields and passenger preferences from the prepared request. Approve the three exact-field private fills and the simulated payment when prompted. Selecting a train does not require approval. A fill discloses the value to the destination webpage.

For Qwen, leave rehearsal unchecked and start the full services. The prepared railway task activates a **declared fixture workflow adapter**: Qwen compares a minimized set of sanitized fare buttons; deterministic local steps handle the other screens. Full local vision, OCR and PII checks remain active at each observation. Both Qwen actions and adapter actions use the same gate. Other tasks/sites retain the general agent path. This is not proof of general-site autonomous booking, and the model can still fail closed. Do not describe the deterministic rehearsal as Qwen performance.

## A 2–3 minute presentation

**0:00–0:25 — The task.** “We’re using a railway booking sandbox. The fares and passenger are fictional, but the browser extension, authorization checks and cryptographic evidence are real. In assisted mode, Qwen chooses a train and a local workflow adapter handles the known booking screens.” Start the prepared task. Optionally randomize fares before the run: the rehearsal compares the currently visible morning fares rather than a fixed train ID; assisted mode supplies those options to Qwen.

**0:25–1:20 — The boundary.** Watch search, train selection and the guest step. At each private fill: “The planner has a reference, not the value. The extension asks me to authorize this specific field on this origin. Approval cannot be replayed for another field.” Approve the three synthetic fills. If using rehearsal, explicitly say that planning and privacy checks in this mode are deterministic/DOM-only, with no Qwen or visual inference.

**1:20–1:50 — The consequence.** Review the passenger, train and total. Approve the simulated payment. Show **Booking complete** and the **DEMO BOOKING REFERENCE**. Explain that this is a simulated booking with no real payment. “The agent proposes. The local gate controls whether it can act.”

**1:50–2:30 — The evidence.** Extension → **Action ledger** → **Verify current ledger** → **Tamper with a copy**. Show verification rejecting the edited copy while preserving the original. Export the evidence. “The chain doesn't magically stop a malicious prompt. Authorization prevents the release; the signed chain helps detect alteration of the recorded decisions.”

**Optional negative scenario.** Start a new journey and enable **Show hostile page text** in Presenter controls. This adds a visible instruction asking the agent to disclose vault values into unrelated notes. It must not authorize a release. Qwen's response to this text and the local gate's enforcement are separate things; one page example is not a universal injection-resistance result. A separate integration test injects a schema-valid malicious server action at the gate and checks that the destination stays empty and the ledger records `BLOCKED`.

You can edit the attack instruction and click **Apply attack text** before starting.
The status shows the applied revision. **View applied attack on page** scrolls to
the published instruction. In Qwen mode, Privacy proof records the sanitized
attack supplied in the fare-comparison context and the service's validated action.
An empty notes box alone is not evidence that the model saw or resisted an attack.

The synthetic portrait appears on **Passenger details**. After the run, choose
**Face-redacted observation** in Privacy proof to inspect retained image evidence.
That snapshot can be local-only because the local adapter handles the passenger
form. **Latest server-planned step** shows the actual sanitized planning context.
Rehearsal disables vision, so it does not produce a face-redaction result.

In Action ledger, **Tamper with a copy** exposes the changed block and differing
hashes. Edit the JSON, select **Verify my edit**, then optionally **Rehash copy
and verify**. Restoring the original copy and verifying again demonstrates a
successful check using the same verifier. The retained original is unchanged.

## What the permission binds

A one-use grant includes local run identity, tab, isolated-world document nonce, exact origin, target element, field type, local task purpose, complete structured-action digest, observed snapshot and fingerprint. It expires after 30 seconds from grant creation; consent requests expire after five minutes. Stop, new run and vault changes revoke grants. Approval is a distinct nonce-bearing extension-UI message, not a webpage instruction. Before resolving the handle, the content broker performs a no-write preflight; it repeats the live checks at insertion.

The planner receives suggested handles only for explicitly requested field categories, and ambiguous duplicate same-category empty fields are not automatically mapped. Both local and server planners go through the same release gate.

## Ledger semantics and limits

Each block contains an index, timestamp, allowlisted event/action type, action commitment, previous hash and current SHA-256 hash. The checkpoint signs the session, block count and head with a non-extractable ephemeral P-256 key. Export includes the public key, not the private key. No private values, raw task, URLs, handles or planner prose are recorded as block fields. The action commitment hashes the structured action, not its resolved secret value.

`EXECUTED` means the local broker reported successful execution; it is not independent proof of a real booking or a network audit. Keep a trusted copy of the exported key/checkpoint independently to detect later log substitution or tail deletion. An attacker controlling the extension/device can replace the entire journal and generate a new identity; this is not consensus, remote attestation or a claim of immunity to compromise. Session evidence disappears on worker shutdown/new run unless exported.

## Remaining work before a production/security claim

- Independent network capture and adversarial evaluation on unseen sites and visual-only tasks. A local sanitized preview is not a wire-level audit.
- Realistic model benchmarks, task-success definitions and measured latency including consent policy. Do not reuse old timing/accuracy numbers for this release.
- Stronger webpage isolation/allowlisting if approved sites themselves must be treated as malicious. Once filled, the page can read and send the value.
- Formal assessment of gateway, content, perception and model supply-chain boundaries. This change fixes a specific release boundary, not every injection path.
- Harden the existing page fingerprint beyond its non-cryptographic change detector, and test more DOM/form mutations. It is supplemented by document identity, target identity, field type and explicit consent here.
- Independently governed checkpoint anchoring only if there is an actual multi-party audit requirement. Never publish credentials or reusable capabilities to a blockchain.
- Address the existing dependency audit warnings before production: the installed Transformers/ONNX Node/sharp dependency tree reports four high-severity entries. Reachability in the browser bundle has not been established by this change. No forced dependency upgrades were made.

See `RAILWAY-VALIDATION.md` for verification evidence and known limitations.
