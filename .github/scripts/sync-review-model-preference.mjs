#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copy .github/review-model-preference.json into the review runner's default and
// re-embed the packaged runner in the reusable review workflow. `--check` only verifies.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const files = { preference: path.join(root, ".github/review-model-preference.json"),
  runner: path.join(root, ".github/scripts/run-opencode-review-recovery.mjs"),
  workflow: path.join(root, ".github/workflows/opencode-code-review.yml") };
const DEFAULT_LINE = /^export const DEFAULT_REVIEW_MODEL_PREFERENCE = Object\.freeze\((\[.*\])\);$/m;
const PAYLOAD = /(<<'ETA_MU_RECOVERY_RUNNER_BASE64'\n)([\s\S]*?)(\n[ \t]*ETA_MU_RECOVERY_RUNNER_BASE64)/;

export function readPreference(file = files.preference) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (data.schema !== "open-hax.review-model-preference/v1" || !Array.isArray(data.preference) || data.preference.length === 0 ||
      !data.preference.every(e => typeof e === "string" && /^[a-z0-9*][a-z0-9.*_-]*$/i.test(e))) {
    throw new Error("invalid review model preference file");
  }
  return data.preference;
}

export function syncedSources(runner, workflow, preference) {
  if (!DEFAULT_LINE.test(runner)) throw new Error("runner default preference line not found");
  const nextRunner = runner.replace(DEFAULT_LINE, `export const DEFAULT_REVIEW_MODEL_PREFERENCE = Object.freeze(${JSON.stringify(preference)});`);
  const match = PAYLOAD.exec(workflow);
  if (!match) throw new Error("workflow runner payload not found");
  const lines = match[2].split("\n"), indent = /^[ \t]*/.exec(lines[0])[0], width = lines[0].trim().length;
  const data = Buffer.from(nextRunner).toString("base64"), out = [];
  for (let i = 0; i < data.length; i += width) out.push(indent + data.slice(i, i + width));
  const nextWorkflow = workflow.slice(0, match.index + match[1].length) + out.join("\n") + workflow.slice(match.index + match[1].length + match[2].length);
  return { runner: nextRunner, workflow: nextWorkflow };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runner = fs.readFileSync(files.runner, "utf8"), workflow = fs.readFileSync(files.workflow, "utf8");
  const next = syncedSources(runner, workflow, readPreference());
  if (process.argv.includes("--check")) {
    if (next.runner !== runner || next.workflow !== workflow) { console.error("review model preference is out of sync; run sync-review-model-preference.mjs"); process.exit(1); }
  } else { fs.writeFileSync(files.runner, next.runner); fs.writeFileSync(files.workflow, next.workflow); }
}
