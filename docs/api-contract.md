# API contract

Contract version: `0.1.0`

The canonical browser definitions are strict Zod schemas in
`shared/schemas/index.ts`. The matching server definitions are strict Pydantic
models in `server/app/schemas/contracts.py`. Changes to either require matching
changes to the other, updated fixtures, and tests.

All content types are `application/json`. Unknown fields are rejected. The
server never accepts a raw `PageObservation` endpoint.

## `GET /health`

Response `200`:

```json
{
  "status": "ok",
  "service": "contextshield-agent",
  "model_backend": "mock"
}
```

## `POST /v1/agent/start`

Request: `SanitizedContext`.

```json
{
  "task": "Choose the cheapest morning option",
  "origin": "https://example.com",
  "snapshot_id": "snap_123",
  "elements": [
    {
      "id": "el_12",
      "role": "button",
      "text": "Continue",
      "label": "Continue",
      "input_type": null,
      "value_handle": null,
      "enabled": true,
      "selected": null,
      "value_present": false,
      "options": [],
      "selected_option": null,
      "control_value": null,
      "dom_index": 0
    }
  ],
  "safe_visual_crops": [],
  "privacy_summary": { "EMAIL": 1 }
}
```

Response `200`:

```json
{
  "session_id": "b4037bd2-53e1-4bf0-926d-7f69bd9362a1",
  "state": "EXECUTE",
  "action": {
    "type": "CLICK",
    "action_id": "act_123",
    "snapshot_id": "snap_123",
    "element_id": "el_12",
    "reason": "The available Continue button advances the task"
  }
}
```

## `POST /v1/agent/step`

Request:

```json
{
  "session_id": "b4037bd2-53e1-4bf0-926d-7f69bd9362a1",
  "context": { "...": "SanitizedContext" }
}
```

Response: the same shape as `/v1/agent/start`.

## `POST /v1/agent/verify`

Request:

```json
{
  "session_id": "b4037bd2-53e1-4bf0-926d-7f69bd9362a1",
  "result": {
    "action_id": "act_123",
    "success": true,
    "page_changed": true,
    "new_snapshot_required": true,
    "error": null
  }
}
```

Response:

```json
{
  "session_id": "b4037bd2-53e1-4bf0-926d-7f69bd9362a1",
  "state": "OBSERVE",
  "accepted": true
}
```

## Allowed actions

- `CLICK`: current snapshot-local `element_id`
- `TYPE_HANDLE`: current element plus `LOCAL_*` handle
- `SELECT`: current select element plus an exposed option
- `SCROLL`: `UP` or `DOWN`, 1-1500 CSS pixels
- `ASK_USER`: bounded user-facing question
- `FINISH`: bounded completion summary

No code, scripts, cookies, credentials, selectors, or arbitrary navigation are
part of the union. Invalid model JSON is never an action.

For native selects, `selected_option` reports the current safe option even
though `value_present` is true. `control_value` carries a locally sanitized
semantic value for checkbox/radio controls, and `dom_index` preserves page
order. Raw text-field values remain absent. An `ASK_USER` response is collected
by the extension, appended as a local clarification, and passed through the
privacy pipeline before a later `/step` request.

## Status codes

- `200`: request accepted
- `404`: session not found
- `409`: out-of-order, duplicate, stale-session, or mismatched verification
- `413`: payload exceeds size limit
- `422`: schema failure or obvious unsanitized sensitive content
- `502`: local model returned an invalid, ungrounded, or unavailable plan
- `500`: internal error; the client treats it as `NETWORK_FAILED` and does not
  relax privacy checks
