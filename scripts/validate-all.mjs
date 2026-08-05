// Runs every content and rule check in one pass so a release cannot ship with a
// gap that only one of the individual scripts would have caught.
import { spawnSync } from "node:child_process";
import path from "node:path";

const scripts = [
  "validate-content.mjs",
  "validate-readings.mjs",
  "validate-vocab-translations.mjs",
  "validate-grammar-content.mjs",
  "validate-daily-progress.mjs",
  "validate-sync.mjs",
  "validate-study-quiz.mjs",
  "validate-unlock-rules.mjs",
  "validate-monthly-report.mjs",
];

const here = import.meta.dirname;
const results = [];
let failed = 0;

for (const script of scripts) {
  const run = spawnSync(process.execPath, [path.join(here, script)], {
    encoding: "utf8",
  });
  const ok = run.status === 0;
  if (!ok) failed += 1;
  results.push({ script, ok });
  if (!ok) {
    console.error(`\n=== ${script} FAILED ===`);
    console.error((run.stderr || run.stdout || "").slice(0, 4000));
  }
}

console.log(JSON.stringify({ ok: failed === 0, results }, null, 2));
process.exit(failed === 0 ? 0 : 1);
