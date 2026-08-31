# Privacy model

## Core guarantee

Raw browser state crosses the network only after transformation into the
minimum explicit `SanitizedContext`. No error path substitutes raw context.

## Detection cascade

The intended local cascade is ordered from cheapest to most expensive:

1. Deterministic format validators for email, phone, PAN-like IDs, GSTIN, IFSC,
   UPI IDs, cards, OTPs, account identifiers, and password field metadata.
2. Rampart ONNX for contextual PII such as names and addresses.
3. A tested YOLOX-Nano ONNX detector for supported visual private regions.
4. PP-OCRv6-tiny on targeted suspicious crops only.

Chrome prefers ONNX Runtime Web with WebGPU. Firefox and unsupported devices
use WASM. Inference runs in workers. A missing model, execution failure, or
unclassifiable suspicious region blocks the affected transmission.

Rampart is integrated and loaded in a worker by default. The packaged face-only
YOLOX model and official PP-OCRv6-tiny detector/recognizer run in extension
workers through a Chrome offscreen document, with WebGPU/WASM fallback,
pre/post-processing, pixel masking and fail-closed responses. The YOLOX artifact
is suitable for an executable prototype, not a production accuracy claim; its
source, export revision and hashes are recorded beside the models.

## Policy decisions

Every detected entity receives exactly one of:

- `KEEP`: safe and task-relevant public context
- `ABSTRACT`: semantic placeholder without identity
- `LOCAL_HANDLE`: opaque reference resolved only from the memory vault
- `SANITIZED_CROP`: minimal raster with irreversible pixel redaction
- `DROP`: excluded from context
- `ASK`: disclosure or use requires an explicit user decision

## Secret vault

The vault stores runtime values in a private in-memory map. It produces handles
such as `LOCAL_EMAIL_1`; storage APIs receive only non-secret preferences. The
server can select a handle but never resolve it. Worker/service-worker teardown
clears the values by construction. **Clear** removes values explicitly; stopping
an agent does not destroy values the user may need for the next task.

## Image rules

A valid outbound crop contains only the required region, a supported MIME type,
dimensions, a SHA-256 digest, and `redaction_verified: true`. The actual raster
pixels must be modified. DOM overlays or CSS blur are not redaction. If the
verifier cannot prove the crop safe, no image is sent.

## Privacy assertions

The gateway validates the strict schema, rejects unknown or suspicious keys,
searches the serialized payload for every known local secret, enforces limits,
requires HTTPS except for loopback development, omits credentials/referrers,
and validates the response action. Any error blocks the request.

The server repeats structural validation and rejects obvious email or long
payment-number patterns as defense in depth. Server checks do not replace the
client boundary.

Firefox's manifest declares required `websiteActivity` and `websiteContent`
transmission because the product sends an origin and minimized sanitized page
semantics to the configured agent server. The declaration must never be changed
to `none` while that network behavior exists.

## Logging

Logs may contain categories, confidence, source, counts, snapshot IDs, element
IDs, decisions, and error codes. Logs must not contain entity values, vault
values, page markup, screenshots, cookies, authorization headers, or payloads.
