# Verified model manifest

Model weights are not stored in Git. `scripts/download-models.sh` accepts a JSON
manifest only when every entry contains an HTTPS URL, a repository-relative
destination under `models/` or `extension/models/`, and a lowercase SHA-256.

```json
{
  "version": 1,
  "artifacts": [
    {
      "name": "reviewed-model-name",
      "url": "https://trusted.example/model.onnx",
      "destination": "extension/models/model.onnx",
      "sha256": "64-lowercase-hex-characters"
    }
  ]
}
```

The project intentionally ships no guessed URLs or checksums. The privacy/model
owners must review license, provenance, expected inputs/outputs, supported
classes, and checksum before committing a manifest. A download or checksum
failure exits nonzero and does not leave a usable artifact.

Rampart's browser artifacts are pinned to upstream revision
`b1993e4e68b082835b80ffc65acc03325ea2e501` in `rampart-browser.json`. Setup
verifies every SHA-256 before placing the files under
`extension/public/models/rampart`. The production worker disables remote model
loading and reads only this packaged directory.

Qwen mode can be launched through `scripts/start-llama.sh`, which uses the
official `Qwen/Qwen3-VL-4B-Instruct-GGUF:Q4_K_M` repository. For a frozen release,
download the Q4_K_M GGUF and matching `mmproj` through this manifest, record the
upstream revision/license, and launch llama.cpp with `--model` and `--mmproj`.

YOLOX must be fine-tuned/reviewed for exactly `FACE` and/or `PRIVATE_DOCUMENT`;
generic COCO YOLOX-Nano weights do not support those claims. PP-OCRv6-tiny needs
its detector, recognizer and exact character dictionary. Until those artifacts
are present and benchmarked, visual candidates are dropped rather than sent.
