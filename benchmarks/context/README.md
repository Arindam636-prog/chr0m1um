# Context benchmark

`extension/tests/compatibility.spec.ts` contains ten controlled page patterns
with versioned expected interactables: standard HTML, forms, tables, dynamic
DOM, image-heavy pages, canvas, ARIA controls, details/summary, open Shadow DOM,
and a large page. It writes measured recall, median/p95 perception latency, and
available page-heap data to `benchmarks/results/browser-compatibility.json`.

This controlled corpus validates the internal >90% target; it is not a claim of
universal accuracy on every third-party website.
