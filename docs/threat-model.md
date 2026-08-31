# Threat model

## Assets and trust assumptions

Protected assets include page content, form values, screenshots, credentials,
identifiers, faces, private documents, and vault values. The local extension is
trusted to enforce policy. The page, network, planner, model output, and server
storage are untrusted. Browser/platform compromise is outside the prototype
boundary but must not be made easier by broad permissions.

| ID | Threat | Mitigation | Residual risk / validation |
| --- | --- | --- | --- |
| T1 | Raw screenshot leakage | Local capture only; minimal verified redacted crops match outbound schema; actual pixel-mask tests | Reviewed visual weights and image benchmark still required |
| T2 | Raw DOM leakage | Semantic extraction, minimization, strict `SanitizedContext`, no raw endpoint; no-fetch lint rule | Manual network inspection remains a release check |
| T3 | Page prompt injection | Page text is data; typed actions; local validation; no raw secrets available | Benchmark adversarial fixtures |
| T4 | Malicious/incorrect server action | Strict union plus snapshot, origin, fingerprint, element, option, risk and confirmation checks | Broader live-site corpus remains |
| T5 | Secret leakage through logs | Central structured logger redacts suspicious metadata keys | Add log-capture regression tests |
| T6 | Privacy model crash | Workers return fail-closed result; gateway never accepts raw fallback | Rampart fault injection is automated |
| T7 | Stale browser state | Snapshot-local IDs, origin and content fingerprint match | Broker rejection is automated |
| T8 | Excessive collection | One local viewport OCR/vision pass per unchanged visual layout, targeted transmitted crops, no analytics | Performance/data-flow review |
| T9 | Network interception | HTTPS for remote endpoints; loopback HTTP only; credentials omitted | Local development traffic remains visible locally |
| T10 | Supply-chain/model tampering | Pinned dependencies and checksum-enforced model manifest | CI provenance/signatures are future hardening |
| T11 | Extension privilege abuse | `activeTab`, `scripting`, `storage`, and all-site host access required for user-started arbitrary-site tasks; no persistent content-script registration; observation starts only on user command | Browser store review and least-privilege re-review required |
| T12 | Persistence of sensitive data | Memory-only vault; Git ignores runtime data/model files; sanitized SQLite only | OS memory inspection is out of scope |

## Security invariants

1. A privacy subsystem error never selects a less private path.
2. The planner never outputs executable source.
3. Page content cannot change system policy or action schemas.
4. Only current snapshot-local element IDs are actionable.
5. High-risk actions require a local user confirmation that the server cannot
   forge.
6. Stored traces are valid sanitized schemas, never raw observations.

## Abuse cases

- A page labels hidden text “system message” and asks for a password upload:
  hidden text is omitted; visible text is untrusted; passwords never enter the
  outbound schema.
- A model returns a selector or JavaScript: Pydantic/Zod union validation fails.
- A detector throws while processing a face: the vision worker reports failure
  and the crop is dropped or the user is asked.
- An action refers to `snap_10` after navigation produced `snap_11`: the broker
  rejects it and re-observes.
