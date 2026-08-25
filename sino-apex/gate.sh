#!/usr/bin/env bash
# SINO APEX release gate. Hermetic: no network, no API keys, no dependencies.
set -euo pipefail
cd "$(dirname "$0")"

for f in kernel/*.mjs tools/*.mjs workflow/*.mjs verify/*.mjs test/*.mjs test/fixtures/*.mjs; do
  node --check "$f"
done
echo "syntax: PASS"

node test/e2e-governed-workflow.mjs
node test/adversarial-gate.mjs
node test/live-integration.mjs

echo 'SINO APEX GATE: PASS'
