from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tempfile
import urllib.request
from pathlib import Path
from urllib.parse import urlparse


def fail(message: str) -> None:
    raise SystemExit(message)


def main() -> None:
    if len(sys.argv) != 3:
        fail("usage: download_models.py MANIFEST REPOSITORY")
    manifest_path = Path(sys.argv[1]).resolve()
    repository = Path(sys.argv[2]).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("version") != 1 or not isinstance(manifest.get("artifacts"), list):
        fail("invalid model manifest")

    for artifact in manifest["artifacts"]:
        url = artifact.get("url", "")
        expected = artifact.get("sha256", "")
        destination_text = artifact.get("destination", "")
        parsed = urlparse(url)
        if parsed.scheme != "https":
            fail(f"artifact URL must use HTTPS: {artifact.get('name', 'unnamed')}")
        if re.fullmatch(r"[a-f0-9]{64}", expected) is None:
            fail(f"invalid SHA-256: {artifact.get('name', 'unnamed')}")

        destination = (repository / destination_text).resolve()
        allowed_roots = (
            (repository / "models").resolve(),
            (repository / "extension/models").resolve(),
            (repository / "extension/public/models").resolve(),
        )
        if not any(destination.is_relative_to(root) for root in allowed_roots):
            fail(f"destination escapes model directories: {destination_text}")
        destination.parent.mkdir(parents=True, exist_ok=True)

        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as temporary:
            temporary_path = Path(temporary.name)
            digest = hashlib.sha256()
            try:
                with urllib.request.urlopen(url, timeout=60) as response:
                    while chunk := response.read(1024 * 1024):
                        digest.update(chunk)
                        temporary.write(chunk)
            except Exception:
                temporary_path.unlink(missing_ok=True)
                raise

        if digest.hexdigest() != expected:
            temporary_path.unlink(missing_ok=True)
            fail(f"checksum failed for {artifact.get('name', destination.name)}")
        os.replace(temporary_path, destination)
        print(f"verified {artifact.get('name', destination.name)} -> {destination}")


if __name__ == "__main__":
    main()
