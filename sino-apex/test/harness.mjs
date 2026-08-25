// Minimal deterministic assertion harness (no test-runner dependency, matching
// the dependency-free convention of the Knitwear Radar release gate).
let passed = 0;
const failures = [];

export function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
}

export function equal(name, actual, expected) {
  check(
    name,
    Object.is(actual, expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

export function report(suite) {
  if (failures.length) {
    console.error(`${suite}: FAIL (${passed} passed, ${failures.length} failed)`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`${suite}: PASS (${passed} checks)`);
}
