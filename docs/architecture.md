# Architecture

## System boundary

ContextShield divides the system into a trusted local browser boundary and an
untrusted remote planning boundary.

```text
TRUSTED CLIENT
  Browser page
    -> semantic perception
    -> deterministic/contextual/visual privacy detection
    -> policy decisions
    -> redaction and abstraction
    -> SafeContextBuilder
    -> PrivacyAssertion
    -> privacyGateway

NETWORK (SanitizedContext only)

UNTRUSTED PLANNER
  FastAPI schema validation
    -> OBSERVE / PLAN / EXECUTE / VERIFY state machine
    -> mock or Qwen planner adapter
    -> strict AgentAction

TRUSTED CLIENT
  snapshot/origin/element/risk validation
    -> local action execution
    -> local verification
```

The remote planner is treated as curious, compromised, prompt-injected, or
wrong. It cannot access the secret vault, browser credentials, raw DOM, or raw
screenshots. It cannot return source code or selectors.

## Component responsibilities

| Component | Trust | Input | Output |
| --- | --- | --- | --- |
| Content perception | Local | Browser DOM/accessibility tree | `PageObservation` |
| Privacy pipeline | Local | Raw observation and local raster | entities and decisions |
| Safe context builder | Local | decisions plus raw local state | `SanitizedContext` |
| Privacy gateway | Local | `SanitizedContext` and known-secret set | validated HTTP request |
| Agent API | Server | `SanitizedContext` | `AgentAction` |
| Action broker | Local | typed action and current snapshot | execution result |
| Verification | Local | before/after page state | `VerificationResult` |

## No-bypass rules

1. Only `extension/lib/network/privacyGateway.ts` may call agent endpoints.
2. Its public API accepts `SanitizedContext`, not `PageObservation` or image data.
3. Zod rejects unknown properties at the client boundary.
4. Pydantic rejects unknown properties again at the server boundary.
5. Known local secrets are searched before serialization leaves the extension.
6. Raw screenshot capture lives under perception and has no import dependency on
   the network package.
7. ML worker failures return explicit fail-closed results.
8. The manifest grants all-website access so an explicitly started task can
   survive normal navigations. The content script is still injected at runtime
   only after the user presses **Start agent**; there is no always-on page reader.

ESLint forbids `fetch`, `XMLHttpRequest`, and `WebSocket` outside the extension's
network package. Code review and module ownership enforce the matching import
boundary until a dedicated dependency graph check is added.

## State machine

```text
OBSERVE -> PLAN -> EXECUTE -> VERIFY -> OBSERVE
                 |             |
                 v             v
               COMPLETE      FAILED
```

The server plans. The client executes. A new or meaningfully changed page gets
a new snapshot ID. An action referring to any previous snapshot is invalid.

## Model adapters

The planner implements `PlannerAdapter`. `MockPlanner` provides deterministic
offline integration. `QwenLlamaPlanner` sends the same sanitized context and
optional verified crops to a loopback llama.cpp OpenAI-compatible endpoint, asks
for JSON-schema-constrained output, parses it through Pydantic, and performs a
second grounding check. NVIDIA infrastructure is optional.
