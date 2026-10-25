#!/usr/bin/env python3
"""Validate both versioned catalogs against their schemas and uniqueness rules."""
import json
import sys
from pathlib import Path

from jsonschema import Draft7Validator, FormatChecker

root = Path(__file__).resolve().parents[1]
catalogs = [
    ("v1", root / "registry.schema.json", root / "registry.json", lambda data: data),
    ("v2", root / "registry/v2.schema.json", root / "registry/v2.json", lambda data: data.get("servers", [])),
]
failed = False
for name, schema_path, registry_path, get_entries in catalogs:
    schema = json.loads(schema_path.read_text())
    registry = json.loads(registry_path.read_text())
    errors = sorted(Draft7Validator(schema, format_checker=FormatChecker()).iter_errors(registry),
                    key=lambda error: (list(error.absolute_path), error.message))
    entries = get_entries(registry)
    ids = [entry.get("id") for entry in entries if isinstance(entry, dict)]
    duplicate_ids = sorted({item for item in ids if ids.count(item) > 1})
    for server_id in duplicate_ids:
        print(f"{name}: duplicate registry id: {server_id}", file=sys.stderr)
        failed = True
    for error in errors:
        location = "/".join(map(str, error.absolute_path)) or "registry"
        print(f"{name} {location}: {error.message}", file=sys.stderr)
        failed = True
    print(f"Validated registry {name}: {len(entries)} entries")
if failed:
    raise SystemExit(1)
