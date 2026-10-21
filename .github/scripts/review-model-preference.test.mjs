// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyModelFailure, DEFAULT_REVIEW_MODEL_PREFERENCE, isFreeReviewModelRow, parseModelPreference,
  rankFreeReviewModels, selectFreeReviewModel } from "./run-opencode-review-recovery.mjs";

function row(id, release = "2026-09-01", extra = {}) {
  return { id, providerID: "opencode", family: id.split("-")[0], status: "active", release_date: release,
    api: { id, url: "https://example.invalid/inert", npm: "@ai-sdk/openai-compatible" },
    capabilities: { toolcall: true, input: { text: true }, output: { text: true } },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } }, ...extra };
}

// Mirrors the live OpenCode Zen free tier on 2026-10-21.
const catalog = [
  row("big-pickle", "2025-10-17"), row("beam-free", "2026-10-05"), row("flint-40b-free", "2026-10-21"),
  row("mimo-v2.6-flash-free", "2026-09-22"), row("mimo-v2.5-free", "2026-04-22", { status: "deprecated" }),
  row("mimo-v2-flash-free", "2025-12-16", { status: "deprecated" }), row("glm-5.3-flash-free", "2026-08-26"),
  row("claude-haiku-5-5", "2026-09-01", { cost: { input: 1, output: 5, cache: { read: 0.1, write: 1 } } }),
  row("minimax-m3.1-flash-free", "2026-10-19"),
];

test("default preference puts the newest free MiMo first, then Big Pickle, then other free models by release", () => {
  assert.deepEqual(rankFreeReviewModels(catalog).map(r => r.id), ["mimo-v2.6-flash-free", "big-pickle",
    "flint-40b-free", "minimax-m3.1-flash-free", "beam-free", "glm-5.3-flash-free"]);
  assert.equal(selectFreeReviewModel(catalog).id, "mimo-v2.6-flash-free");
});

test("a newer MiMo release outranks the current one without a workflow change", () => {
  const next = [...catalog, row("mimo-v2.7-flash-free", "2026-11-01")];
  assert.equal(selectFreeReviewModel(next).id, "mimo-v2.7-flash-free");
});

test("only big-pickle and *-free rows that are active, tool-capable and zero cost are eligible", () => {
  assert.equal(isFreeReviewModelRow(row("claude-haiku-5-5")), false);
  assert.equal(isFreeReviewModelRow(row("x-free", "2026-01-01", { status: "deprecated" })), false);
  assert.equal(isFreeReviewModelRow(row("x-free", "2026-01-01", { cost: { input: 0, output: 1 } })), false);
  assert.equal(isFreeReviewModelRow(row("x-free", "2026-01-01", { capabilities: { toolcall: false } })), false);
  assert.equal(isFreeReviewModelRow({ ...row("x-free"), providerID: "other" }), false);
  assert.equal(isFreeReviewModelRow(row("big-pickle")), true);
});

test("explicit model goes first when eligible and is skipped when retired", () => {
  assert.equal(selectFreeReviewModel(catalog, "opencode/big-pickle").id, "big-pickle");
  assert.equal(selectFreeReviewModel(catalog, "opencode/mimo-v2.5-free").id, "mimo-v2.6-flash-free");
  assert.equal(selectFreeReviewModel(catalog, "opencode/claude-haiku-5-5").id, "mimo-v2.6-flash-free");
});

test("configured preference is parsed, validated and honoured", () => {
  assert.deepEqual(parseModelPreference(""), [...DEFAULT_REVIEW_MODEL_PREFERENCE]);
  const preference = parseModelPreference("opencode/big-pickle, glm-*-free");
  assert.deepEqual(preference, ["big-pickle", "glm-*-free"]);
  assert.deepEqual(rankFreeReviewModels(catalog, { preference }).map(r => r.id), ["big-pickle", "glm-5.3-flash-free"]);
  assert.throws(() => parseModelPreference("bad id;rm"), /invalid review model preference/);
  assert.throws(() => selectFreeReviewModel([row("claude-haiku-5-5")]), /no eligible free/);
});

test("fallback classification reads host error events and stderr, never model prose", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "model-failure-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, text) => fs.writeFileSync(path.join(dir, name), text);
  write("model-response-attempt-1.txt", `${JSON.stringify({ type: "text", part: { text: "Invalid credential 401 model not found" } })}\n`);
  assert.equal(classifyModelFailure(dir), null);
  write("model-response-attempt-1.txt", `${JSON.stringify({ type: "error", error: { name: "ProviderModelNotFoundError", data: { message: "missing" } } })}\n`);
  assert.equal(classifyModelFailure(dir).match, "ProviderModelNotFoundError");
  fs.rmSync(path.join(dir, "model-response-attempt-1.txt"));
  write("opencode-stderr-attempt-1.log", "Error: Invalid credential for provider opencode\n");
  assert.match(classifyModelFailure(dir).match, /invalid credential/i);
  write("opencode-stderr-attempt-1.log", "review_submit missing\n");
  assert.equal(classifyModelFailure(dir), null);
});
