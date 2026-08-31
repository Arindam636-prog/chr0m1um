# Packaged local visual models

These files are copied into the extension and run locally with ONNX Runtime Web.

- `yolox-face.onnx` — face-only YOLOX prototype checkpoint from the MIT-licensed
  `ankandrew/yolox-models` face model (Open Images face class), exported with
  Megvii YOLOX commit `6ddff4824372906469a7fae2dc3206c7aa4bbaee`, decoded
  output `[1,756,6]`, input `192x192`, class order `FACE`. SHA-256:
  `381222334ce42898c5bc920f0f2d40b5fcf5dc116c6b9da5b802b078717cf14a`.
- `ppocrv6-tiny-det.onnx` — official PaddlePaddle PP-OCRv6 tiny detector,
  Hugging Face revision `2ba1506c0380b8f0b03dd142459aac66d4421f6c`. SHA-256:
  `193bab7a04fca699a6c82e6abb5b81bdb28177f0abd4062552b04908dafb19f8`.
- `ppocrv6-tiny-rec.onnx` and recognition configuration — official PaddlePaddle
  PP-OCRv6 tiny recognizer, revision
  `2612ab37152ae0a677521bae4e1e3d4fb4cf7c30`. ONNX SHA-256:
  `9ef676d6ed3c88256a2d92c640c44f25b0c40947e111b14b8be8f594091563e6`.
- `ppocrv6-tiny-dictionary.json` — 6,904-character recognition dictionary plus
  the model's space token. SHA-256:
  `ac2b60033390b06cde6f766c3eb8ebaf4f4417508eac3c2569cb5d71b1391d22`.

The browser E2E test initializes all three ONNX sessions, analyzes a captured
visual region, verifies masking, and asserts only a redaction-verified crop enters
the agent payload. These artifacts make the prototype executable; they do not
constitute a production accuracy claim.
