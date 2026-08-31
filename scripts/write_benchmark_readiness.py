import json
import sys
from pathlib import Path


output, started_at, overall, frontend_status, backend_status = sys.argv[1:]
report = {
    "schema_version": 1,
    "benchmark_stage": "target-1-foundation",
    "started_at": started_at,
    "overall": overall,
    "checks": {
        "typescript_contract_and_gateway_tests": {
            "passed": int(frontend_status) == 0,
            "exit_code": int(frontend_status),
        },
        "python_contract_and_api_tests": {
            "passed": int(backend_status) == 0,
            "exit_code": int(backend_status),
        },
    },
    "metrics_available": False,
    "metrics_note": "No PII, redaction, model, or performance measurements exist at Target 1.",
}
Path(output).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
