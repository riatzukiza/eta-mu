#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Benchmark OpenCode's free models on a known review diff and write a ranked preference file.
// Plain Node 22 script: runs the same under GitHub Actions, on a Knoxx host, or by hand.
//   node .github/scripts/benchmark-free-review-models.mjs [--trials 3] [--timeout-ms 180000]
//        [--out review-model-benchmark.json] [--preference-out .github/review-model-preference.json]
// Uses only anonymous free-tier access through the OpenCode CLI (OPENCODE_BIN, default `opencode`).
// Never reads or forwards credentials: each run gets an empty HOME and a minimal environment.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isFreeReviewModelRow } from "./run-opencode-review-recovery.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const benchDir = path.resolve(here, "../review-bench");
const CATALOG_URL = "https://models.opencode.ai/api.json";

export function parseArgs(argv) {
  const options = { trials: 3, timeoutMs: 180_000, out: "review-model-benchmark.json", preferenceOut: null, models: null };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (flag === "--trials") { options.trials = Number(value); i += 1; }
    else if (flag === "--timeout-ms") { options.timeoutMs = Number(value); i += 1; }
    else if (flag === "--out") { options.out = value; i += 1; }
    else if (flag === "--preference-out") { options.preferenceOut = value; i += 1; }
    else if (flag === "--models") { options.models = value.split(",").map(s => s.trim().replace(/^opencode\//, "")).filter(Boolean); i += 1; }
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!Number.isInteger(options.trials) || options.trials < 1 || options.trials > 10) throw new Error("--trials must be 1..10");
  return options;
}

/** Convert raw models.dev rows into the row shape the review selector checks. */
export function freeCatalogRows(catalog) {
  return Object.entries(catalog?.opencode?.models ?? {}).map(([id, raw]) => ({
    id, providerID: "opencode", family: raw.family, status: raw.status ?? "active", release_date: raw.release_date,
    context: raw.limit?.context ?? null,
    capabilities: { toolcall: raw.tool_call === true,
      input: { text: (raw.modalities?.input ?? []).includes("text") }, output: { text: (raw.modalities?.output ?? []).includes("text") } },
    cost: { input: raw.cost?.input, output: raw.cost?.output,
      cache: { read: raw.cost?.cache_read ?? 0, write: raw.cost?.cache_write ?? 0 } },
  })).filter(isFreeReviewModelRow);
}

export function reviewPrompt(diff) {
  return "You are a code reviewer. Review ONLY this diff. Respond with a single JSON object and nothing else, shaped " +
    '{"findings":[{"file":string,"line":number,"severity":"high"|"medium"|"low","summary":string}]}. ' +
    "Report real defects only; do not report style.\n\n```diff\n" + diff + "\n```";
}

/** Pull the model's final text out of `opencode run --format json` events. */
export function finalText(stdout) {
  const parts = [];
  let error = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event; try { event = JSON.parse(line); } catch { continue; }
    if (event.type === "text" && typeof event.part?.text === "string") parts.push(event.part.text);
    if (event.type === "error") error = `${event.error?.name ?? "error"}: ${event.error?.data?.message ?? ""}`.trim();
  }
  return { text: parts.join(""), error };
}

/** Parse the first JSON object in the text and score it against the seeded defects. */
export function scoreReview(text, expected) {
  const match = /\{[\s\S]*\}/.exec(text.replace(/```(?:json)?/g, ""));
  let parsed = null;
  try { parsed = match ? JSON.parse(match[0]) : null; } catch { parsed = null; }
  const findings = Array.isArray(parsed?.findings) ? parsed.findings : null;
  if (!findings) return { valid: false, recall: 0, false_positives: 0, findings: 0 };
  const blob = f => `${f?.summary ?? ""} ${f?.file ?? ""} ${f?.line ?? ""}`;
  const found = expected.defects.filter(d => findings.some(f => d.patterns.some(p => new RegExp(p, "i").test(blob(f)))));
  const bait = findings.filter(f => expected.bait.some(p => new RegExp(p, "i").test(blob(f))) &&
    !expected.defects.some(d => d.patterns.some(p => new RegExp(p, "i").test(blob(f))))).length;
  return { valid: true, recall: found.length / expected.defects.length, found: found.map(d => d.id), false_positives: bait, findings: findings.length };
}

function runOnce(binary, model, prompt, timeoutMs) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "review-bench-"));
  const work = path.join(home, "work"); fs.mkdirSync(work);
  const env = { PATH: process.env.PATH || "/usr/bin:/bin", HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local/share"), OPENCODE_PURE: "true" };
  const started = performance.now();
  return new Promise(resolve => {
    const child = spawn(binary, ["run", "--print-logs", "--format", "json", "--model", `opencode/${model}`, prompt],
      { cwd: work, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stdout = "", stderr = "", timedOut = false;
    child.stdout.on("data", c => { stdout += c; }); child.stderr.on("data", c => { stderr += c; });
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGKILL"); } catch {} }, timeoutMs);
    child.on("close", code => {
      clearTimeout(timer);
      fs.rmSync(home, { recursive: true, force: true });
      resolve({ code, timedOut, stdout, stderr, latency_ms: Math.round(performance.now() - started) });
    });
  });
}

/** Rank: success rate, then mean recall, then fewer false positives, then median latency. */
export function rankResults(results) {
  const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : Infinity; };
  return results.map(r => {
    const ok = r.trials.filter(t => t.ok);
    return { model: r.model, release_date: r.release_date, context: r.context,
      success_rate: ok.length / r.trials.length,
      valid_json_rate: r.trials.filter(t => t.valid).length / r.trials.length,
      mean_recall: ok.length ? ok.reduce((a, t) => a + t.recall, 0) / ok.length : 0,
      false_positives: ok.reduce((a, t) => a + t.false_positives, 0),
      median_latency_ms: median(ok.map(t => t.latency_ms)),
      errors: [...new Set(r.trials.map(t => t.error).filter(Boolean))].slice(0, 3) };
  }).map(s => ({ ...s, score: Number((0.5 * s.success_rate + 0.4 * s.mean_recall + 0.1 * s.valid_json_rate).toFixed(4)) }))
    .sort((a, b) => b.score - a.score || a.false_positives - b.false_positives ||
      a.median_latency_ms - b.median_latency_ms || a.model.localeCompare(b.model));
}

/** Models that worked at least once lead; unbenchmarked/failed ones stay reachable via the catch-all globs. */
export function preferenceFromRanking(ranked) {
  return [...ranked.filter(r => r.success_rate > 0).map(r => r.model), "mimo-*-free", "big-pickle", "*-free"]
    .filter((m, i, all) => all.indexOf(m) === i);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const binary = process.env.OPENCODE_BIN || "opencode";
  const diff = fs.readFileSync(path.join(benchDir, "known-diff.patch"), "utf8");
  const expected = JSON.parse(fs.readFileSync(path.join(benchDir, "expected.json"), "utf8"));
  const catalog = await (await fetch(CATALOG_URL, { signal: AbortSignal.timeout(30_000) })).json();
  let rows = freeCatalogRows(catalog);
  if (options.models) rows = rows.filter(r => options.models.includes(r.id));
  const prompt = reviewPrompt(diff);
  const results = [];
  for (const row of rows) {
    const trials = [];
    for (let trial = 0; trial < options.trials; trial += 1) {
      const run = await runOnce(binary, row.id, prompt, options.timeoutMs);
      const { text, error } = finalText(run.stdout);
      const score = scoreReview(text, expected);
      const stderrError = /Rate limit[^\n]*|Invalid credential[^\n]*|not found[^\n]*/i.exec(run.stderr)?.[0] ?? null;
      const ok = run.code === 0 && !run.timedOut && !error && score.valid;
      trials.push({ ok, latency_ms: run.latency_ms, exit_code: run.code, timed_out: run.timedOut,
        error: error ?? stderrError ?? (run.timedOut ? "timeout" : null), ...score });
      console.error(`${row.id} #${trial + 1}: ${ok ? "ok" : "fail"} ${run.latency_ms}ms recall=${score.recall} ${error ?? stderrError ?? ""}`);
    }
    results.push({ model: row.id, release_date: row.release_date, context: row.context, trials });
  }
  const ranked = rankResults(results);
  const report = { schema: "open-hax.review-model-benchmark/v1", generated_at: new Date().toISOString(),
    opencode_bin: binary, trials_per_model: options.trials, ranked, raw: results };
  fs.writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  if (options.preferenceOut) {
    if (!ranked.some(r => r.success_rate > 0)) throw new Error("no free model succeeded; refusing to overwrite the preference file");
    fs.writeFileSync(options.preferenceOut, `${JSON.stringify({ schema: "open-hax.review-model-preference/v1",
      source: `benchmark ${report.generated_at}, ${options.trials} trials/model`, preference: preferenceFromRanking(ranked) }, null, 2)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`::error::${error.message}`); process.exitCode = 1; });
}
