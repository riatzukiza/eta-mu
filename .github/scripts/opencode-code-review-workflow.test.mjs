// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runReviewRecovery, captureReviewBatchCustody, parseOpenCodeModelCatalog, selectFreeMiMoFlash,
  acquireReviewJobOrigin, reviewJobDeadline } from "./run-opencode-review-recovery.mjs";
import { bindTransportInvocation, stageTransportVerifier, transportResponse,
  transportSha256, transportVerifierSource } from "./review-invocation-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPath =
  process.env.ETA_MU_REVIEW_WORKFLOW_PATH ||
  path.join(root, ".github/workflows/opencode-code-review.yml");
const requireFromEtaMu = createRequire(path.join(root, "packages/eta-mu/package.json"));
const YAML = requireFromEtaMu("yaml");
const workflowText = fs.readFileSync(workflowPath, "utf8");
const workflow = YAML.parse(workflowText);
// The workflow installs this selected physical version. Its fingerprint must
// still qualify through Muse; selecting a version supplies no host admission.
const nativeBatchVersion = process.env.ETA_MU_NATIVE_BATCH_VERSION ||
  String(workflow.on.workflow_call.inputs.opencode_version.default);
const workflowDocs = fs.readFileSync(path.join(root, "docs/agent-workflows.md"), "utf8");
const recoveryRunnerSource = fs.readFileSync(
  path.join(root, ".github/scripts/run-opencode-review-recovery.mjs"),
  "utf8",
);

function namedStep(jobId, name) {
  const step = workflow.jobs[jobId].steps.find((candidate) => candidate.name === name);
  assert.ok(step, `missing ${jobId} step: ${name}`);
  return step;
}

// Run the actual github-script adapter with no native network or credentials.
function discordStepFixture(comments, { webhook = "https://example.invalid/diagnostic", httpFailureAt } = {}) {
  const payloads = [];
  const pagination = [];
  const context = { repo: { owner: "open-hax", repo: "proxx" }, payload: { pull_request: {
    number: 451, html_url: "https://github.com/open-hax/proxx/pull/451",
  } } };
  const listReviewComments = () => {};
  const github = { rest: { pulls: { listReviewComments } }, paginate: async (method, params) => {
    assert.equal(method, listReviewComments);
    pagination.push(params);
    return comments;
  } };
  const fetch = async (url, options) => {
    assert.equal(url, webhook);
    assert.equal(options.method, "POST");
    assert.deepEqual(options.headers, { "content-type": "application/json" });
    const payload = JSON.parse(options.body);
    payloads.push(payload);
    const size = discordPayloadTextSize(payload);
    if (size > 6000 || payload.embeds.length > 10) {
      return { ok: false, status: 400, text: async () => "Embed size exceeds maximum size of 6000" };
    }
    if (payloads.length === httpFailureAt) {
      return { ok: false, status: 429, text: async () => "diagnostic rate limit" };
    }
    return { ok: true, status: 204 };
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const step = namedStep("review", "Send new inline review comments to Discord");
  const delivery = new AsyncFunction("github", "context", "core", "fetch", "process", step.with.script)(
    github, context, { info: () => {} }, fetch,
    { env: { DISCORD_REVIEW_WEBHOOK_URL: webhook, REVIEW_STARTED_AT: "2026-10-04T08:31:49Z" } },
  );
  return { delivery, payloads, pagination, context };
}

// Discord's aggregate rule includes every text-bearing embed field, not URLs.
function discordPayloadTextSize(payload) {
  return payload.embeds.flatMap((embed) => [
    embed.title, embed.description, embed.author?.name, embed.footer?.text,
    ...(embed.fields ?? []).flatMap((field) => [field.name, field.value]),
  ]).reduce((total, value) => total + String(value ?? "").trim().length, 0);
}

function discordComment(index, body = "short evidence") {
  return {
    body, user: { login: "eta-mu-ai[bot]" }, path: `.github/尾-${index}.yml`, line: index + 1,
    html_url: `https://github.com/open-hax/proxx/pull/451#discussion_r${index}`,
    created_at: new Date(Date.parse("2026-10-04T08:49:00Z") + index * 1000).toISOString(),
  };
}

test("Discord actual adapter batches ten long Unicode comments by all embed text", async (t) => {
  const comments = Array.from({ length: 10 }, (_, index) => discordComment(index, "🙂尾 evidence ".repeat(250)));
  const old = { ...discordComment(99), created_at: "2026-10-04T08:00:00Z" };
  const fixture = discordStepFixture([old, ...comments.toReversed()]);
  await fixture.delivery;
  assert.ok(fixture.payloads.length > 1);
  assert.deepEqual(fixture.pagination, [{ owner: "open-hax", repo: "proxx", pull_number: 451, per_page: 100 }]);
  const embeds = fixture.payloads.flatMap((payload) => payload.embeds);
  assert.equal(embeds.length, 10);
  for (const [index, embed] of embeds.entries()) {
    const comment = comments[index];
    assert.deepEqual(embed, {
      title: "open-hax/proxx#451: evidence review comment", url: comment.html_url, color: 0x8b5cf6,
      description: `${comment.body.slice(0, 1499)}…`, timestamp: comment.created_at,
      fields: [
        { name: "Author", value: comment.user.login, inline: true },
        { name: "File", value: comment.path, inline: true },
        { name: "Line", value: String(comment.line), inline: true },
        { name: "PR", value: fixture.context.payload.pull_request.html_url, inline: false },
      ],
    });
  }
  for (const payload of fixture.payloads) {
    assert.ok(payload.embeds.length <= 10 && discordPayloadTextSize(payload) <= 6000);
    assert.equal(payload.username, "MiMo Evidence Review");
    assert.equal(payload.content, `New evidence-backed review comment${payload.embeds.length === 1 ? "" : "s"} on open-hax/proxx#451`);
    assert.deepEqual(payload.allowed_mentions, { parse: [] });
  }
  t.diagnostic(`mock Discord accepted ${fixture.payloads.map((payload) => `${payload.embeds.length} embeds/${discordPayloadTextSize(payload)} text units`).join(", ")}`);
});

test("Discord actual adapter retains the ten-embed count bound for short comments", async () => {
  const fixture = discordStepFixture(Array.from({ length: 21 }, (_, index) => discordComment(index)));
  await fixture.delivery;
  assert.deepEqual(fixture.payloads.map((payload) => payload.embeds.length), [10, 10, 1]);
  assert.equal(fixture.payloads.flatMap((payload) => payload.embeds).length, 21);
});

test("Discord actual adapter includes title and fields at the inclusive 6000 boundary", async () => {
  // A short real send measures the fixed rendered title/author/path/line/PR
  // overhead. Four descriptions alone fit; their additional fields decide batching.
  const probe = discordStepFixture(Array.from({ length: 4 }, (_, index) => discordComment(index, "x")));
  await probe.delivery;
  const overhead = probe.payloads.flatMap((payload) => payload.embeds)
    .map((embed) => discordPayloadTextSize({ embeds: [embed] }) - 1);
  for (const excess of [0, 1]) {
    const comments = overhead.map((size, index) => discordComment(index, "x".repeat(1500 - size + (index === 3 ? excess : 0))));
    assert.ok(comments.every((comment) => comment.body.length <= 1500));
    const fixture = discordStepFixture(comments);
    await fixture.delivery;
    assert.deepEqual(fixture.payloads.map((payload) => payload.embeds.length), excess ? [3, 1] : [4]);
    assert.equal(fixture.payloads.reduce((total, payload) => total + discordPayloadTextSize(payload), 0), 6000 + excess);
  }
});

test("Discord actual adapter propagates an HTTP failure and stops remaining sends", async () => {
  const fixture = discordStepFixture(Array.from({ length: 21 }, (_, index) => discordComment(index)), { httpFailureAt: 2 });
  await assert.rejects(fixture.delivery, /Discord webhook failed: 429 diagnostic rate limit/);
  assert.equal(fixture.payloads.length, 2);
});

test("Discord actual adapter sends nothing without a webhook or fresh comments", async () => {
  const absent = discordStepFixture([discordComment(1)], { webhook: "" });
  await absent.delivery;
  assert.equal(absent.pagination.length, 0);
  assert.equal(absent.payloads.length, 0);
  const stale = discordStepFixture([{ ...discordComment(1), created_at: "2026-10-04T08:00:00Z" }]);
  await stale.delivery;
  assert.equal(stale.payloads.length, 0);
});

function runScript(script, cwd, env = {}) {
  return spawnSync("bash", ["-s"], {
    input: script,
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

/** Explicit local test-job facts; no hosted/native-origin qualification is claimed. */
function localReviewBudgetFixture() {
  return { GITHUB_ACTIONS: "false", REVIEW_JOB_STARTED_AT_MS: String(Date.now()), REVIEW_TIMEOUT_MINUTES: "60" };
}

/** Execute the real pre-checkout ESM step with offline native-shaped metadata. */
function runTimeoutValidation(script, cwd, env = {}) {
  const preload = path.join(cwd, "owned-job-origin-preload.mjs");
  const output = path.join(cwd, "owned-job-budget-env");
  fs.writeFileSync(output, "");
  fs.writeFileSync(preload, `
    globalThis.fetch = async (url, options) => {
      if (url !== 'https://api.github.com/repos/open-hax/fixture/actions/runs/123/attempts/2/jobs?per_page=100&page=1'
        || options.credentials !== 'omit' || options.redirect !== 'error'
        || Object.keys(options.headers).some(key=>key.toLowerCase()==='authorization'))
        throw Error('unexpected owned public job metadata request');
      const job={id:456,run_id:123,run_attempt:2,status:'in_progress',runner_name:'owned-test-runner',runner_id:789,
        url:'https://api.github.com/repos/open-hax/fixture/actions/jobs/456',
        run_url:'https://api.github.com/repos/open-hax/fixture/actions/runs/123',
        started_at:new Date(Math.floor(Date.now()/1000)*1000-5000).toISOString()};
      const response=new Response(JSON.stringify({total_count:1,jobs:[job]}),{status:200});
      Object.defineProperty(response,'url',{value:url});return response;
    };
  `);
  return { ...runScript(script, cwd, { NODE_OPTIONS: `--import=${preload}`, GITHUB_ENV: output,
    GITHUB_REPOSITORY: "open-hax/fixture", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2",
    RUNNER_NAME: "owned-test-runner", GITHUB_API_URL: "https://api.github.com", GITHUB_SERVER_URL: "https://github.com", ...env }),
    budgetOutput: parseOutput(output) };
}

function parseOutput(file) {
  return Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .trim()
      .split(/\n+/)
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function makeRepository(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eta-mu-review-workflow-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: directory });
  execFileSync("git", ["config", "user.name", "eta-mu workflow test"], { cwd: directory });
  execFileSync("git", ["config", "user.email", "workflow-test@example.invalid"], { cwd: directory });
  fs.writeFileSync(path.join(directory, "tracked.txt"), "revision-bound\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: directory });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: directory });
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
  return { directory, sha };
}

const generatedOutputPaths = [
  "packages/legacy/ai/src/models.generated.ts",
  "packages/contracts/output/dist-cli/index.cjs",
  "packages/contracts/output/dist-cli/index.cjs.map",
];

function addGeneratedOutputs(directory) {
  for (const relativePath of generatedOutputPaths) {
    const output = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `checked-in ${relativePath}\n`);
  }
  execFileSync("git", ["add", ...generatedOutputPaths], { cwd: directory });
  execFileSync("git", ["commit", "-qm", "add generated outputs"], { cwd: directory });
  return generatedOutputPaths.map((relativePath) => path.join(directory, relativePath));
}

function guardEnvironment(directory, output, expectedSha, eventHeadSha = expectedSha) {
  return {
    EVENT_PR_HEAD_SHA: eventHeadSha,
    GITHUB_OUTPUT: output,
    GITHUB_WORKSPACE: directory,
    PR_HEAD_SHA: expectedSha,
  };
}

function summaryEnvironment(directory, output, sha, overrides = {}) {
  return {
    CHECKOUT_CLEAN: "true",
    CHECKOUT_EXACT_HEAD: "true",
    CHECKOUT_EXECUTED_SHA: sha,
    CHECKOUT_EXPECTED_SHA: sha,
    GATE_STEP_OUTCOME: "success",
    GITHUB_OUTPUT: output,
    GITHUB_REPOSITORY: "open-hax/fixture",
    GITHUB_WORKSPACE: directory,
    PR_BASE_SHA: "a".repeat(40),
    PR_HEAD_SHA: sha,
    PR_NUMBER: "42",
    ...overrides,
  };
}

function finalGateEnvironment(sha, overrides = {}) {
  return {
    CONTEXT_JOB_RESULT: "success",
    DETERMINISTIC_CLEAN: "true",
    DETERMINISTIC_COMPLETION_SHA: sha,
    DETERMINISTIC_EXACT_HEAD: "true",
    DETERMINISTIC_EXECUTED_SHA: sha,
    DETERMINISTIC_EXPECTED_SHA: sha,
    DETERMINISTIC_JOB_RESULT: "success",
    DETERMINISTIC_OUTPUT_RESULT: "success",
    ELIGIBLE_REVIEW_EVENT: "true",
    PULL_REQUEST_EVENT: "true",
    REVIEW_CLEAN: "true",
    REVIEW_COMPLETION_SHA: sha,
    REVIEW_EXACT_HEAD: "true",
    REVIEW_EXECUTED_SHA: sha,
    REVIEW_EXPECTED_SHA: sha,
    REVIEW_JOB_RESULT: "success",
    ...overrides,
  };
}

test("workflow exposes one stable always-running terminal gate", () => {
  assert.match(workflowText, /^# SPDX-License-Identifier: GPL-3\.0-or-later/m);
  const gate = workflow.jobs.review_gate;
  assert.equal(gate.name, "OpenCode evidence review gate");
  assert.deepEqual(gate.needs, ["deterministic_evidence", "prepare_review_context", "review"]);
  assert.equal(gate.if, "${{ always() }}");
  assert.equal(
    namedStep("review_gate", "Enforce truthful reusable review result").env.PULL_REQUEST_EVENT,
    "${{ github.event.pull_request != null }}",
  );

  const deterministic = workflow.jobs.deterministic_evidence;
  for (const output of ["result", "expected_sha", "executed_sha", "completion_sha", "exact_head", "clean"]) {
    assert.equal(typeof deterministic.outputs[output], "string");
  }
  assert.doesNotMatch(workflow.jobs.review.if, /deterministic_evidence\.outputs\.result/);
});

test("a required reusable head input drives both exact checkout guards", () => {
  const input = workflow.on.workflow_call.inputs.pr_head_sha;
  assert.equal(input.required, true);
  assert.equal(input.type, "string");
  const expectedRef = "${{ inputs.pr_head_sha || github.event.pull_request.head.sha }}";
  const eventHead = "${{ github.event.pull_request.head.sha }}";

  for (const jobId of ["deterministic_evidence", "review"]) {
    const checkout = namedStep(jobId, "Checkout pull request");
    assert.equal(checkout.with.ref, expectedRef);
    assert.equal(checkout.with["persist-credentials"], false);
  }

  for (const [jobId, name] of [
    ["deterministic_evidence", "Verify exact and clean pull request checkout"],
    ["review", "Verify exact and clean review checkout"],
  ]) {
    const guard = namedStep(jobId, name);
    assert.equal(guard.env.PR_HEAD_SHA ?? guard.env.EXPECTED_SHA, expectedRef);
    assert.equal(guard.env.EVENT_PR_HEAD_SHA, eventHead);
    assert.match(guard.run, /git rev-parse HEAD/);
    assert.match(guard.run, /git cat-file -e "\$\{expected_sha\}\^\{commit\}"/);
    assert.match(guard.run, /event_head_matches/);
    assert.match(guard.run, /\^\[0-9a-f\]\{40\}\$/);
    assert.match(guard.run, /\^\[0-9a-f\]\{64\}\$/);
  }
});

test("staging preserves the full immutable diff beyond its bounded preview", (t) => {
  const { directory, sha: base } = makeRepository(t);
  fs.writeFileSync(path.join(directory, "large.txt"), "changed input\n".repeat(26000));
  fs.writeFileSync(path.join(directory, "尾-ημ.txt"), "tail hunk must be reviewed\n");
  execFileSync("git", ["add", "large.txt", "尾-ημ.txt"], { cwd: directory });
  execFileSync("git", ["commit", "-qm", "large full-input fixture"], { cwd: directory });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
  const event = path.join(directory, "event.json");
  fs.writeFileSync(event, JSON.stringify({ pull_request: {
    number: 42, title: "full input", user: { login: "fixture" },
    head: { ref: "review", sha: head }, base: { ref: "main", sha: base }, draft: false,
  } }));
  const step = namedStep("deterministic_evidence", "Stage pull request diff and context");
  const result = runScript(step.run, directory, {
    GITHUB_WORKSPACE: directory, GITHUB_EVENT_PATH: event, PR_BASE_SHA: base, PR_HEAD_SHA: head,
    GITHUB_REPOSITORY: "open-hax/fixture", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2",
    GITHUB_WORKFLOW_SHA: head, GITHUB_WORKFLOW_REF: "open-hax/fixture/.github/workflows/review.yml@refs/heads/review",
  });
  assert.equal(result.status, 0, result.stderr);
  const evidence = path.join(directory, ".opencode/review-evidence");
  assert.ok(fs.existsSync(path.join(evidence, "basehead.diff")), "full input was discarded while making the preview");
  const full = fs.readFileSync(path.join(evidence, "basehead.diff"));
  const expected = execFileSync("git", ["diff", "--find-renames", base, head], { cwd: directory });
  assert.ok(full.equals(expected), "full staged bytes must equal exact merge-base/head Git input");
  assert.ok(full.length > 300000);
  assert.match(full.toString("utf8"), /tail hunk must be reviewed/);
  const preview = fs.readFileSync(path.join(evidence, "pr.diff"));
  assert.ok(preview.subarray(0, 300000).equals(full.subarray(0, 300000)));
  assert.doesNotMatch(preview.toString("utf8"), /tail hunk must be reviewed/);
  const manifest = JSON.parse(fs.readFileSync(path.join(evidence, "input-manifest.json"), "utf8"));
  assert.equal(manifest.schema, "open-hax.review-input/v1");
  assert.equal(manifest.base_sha, base);
  assert.equal(manifest.diff_base_sha, base);
  assert.equal(manifest.head_sha, head);
  assert.deepEqual(manifest.full_diff, {
    path: "basehead.diff", bytes: full.length, sha256: createHash("sha256").update(full).digest("hex"),
  });
  assert.equal(manifest.preview.truncated, true);
  assert.equal(manifest.preview.limit_bytes, 300000);
  assert.equal(manifest.provenance.run_id, "123");
  assert.equal(manifest.provenance.run_attempt, "2");
});

test("staging fails closed for an absent base or a mismatched selected head", (t) => {
  const { directory, sha } = makeRepository(t);
  const event = path.join(directory, "event.json");
  fs.writeFileSync(event, JSON.stringify({ pull_request: { number: 42, head: { sha }, base: { sha } } }));
  for (const [base, head] of [["a".repeat(40), sha], [sha, "b".repeat(40)]]) {
    const result = runScript(namedStep("deterministic_evidence", "Stage pull request diff and context").run, directory, {
      GITHUB_WORKSPACE: directory, GITHUB_EVENT_PATH: event, PR_BASE_SHA: base, PR_HEAD_SHA: head,
    });
    assert.notEqual(result.status, 0, "invalid revision must not produce qualified input");
  }
});

test("staging preserves empty input and distinguishes the native base from the merge base", (t) => {
  const { directory, sha: ancestor } = makeRepository(t);
  const step = namedStep("deterministic_evidence", "Stage pull request diff and context");
  const event = path.join(directory, "event.json");
  const stage = (base, head) => {
    fs.writeFileSync(event, JSON.stringify({ pull_request: { number: 42, head: { sha: head }, base: { sha: base } } }));
    const result = runScript(step.run, directory, {
      GITHUB_WORKSPACE: directory, GITHUB_EVENT_PATH: event, PR_BASE_SHA: base, PR_HEAD_SHA: head,
    });
    assert.equal(result.status, 0, result.stderr);
    const evidence = path.join(directory, ".opencode/review-evidence");
    return {manifest: JSON.parse(fs.readFileSync(path.join(evidence, "input-manifest.json"), "utf8")),
      full: fs.readFileSync(path.join(evidence, "basehead.diff"), "utf8")};
  };
  const empty = stage(ancestor, ancestor);
  assert.equal(empty.full, "");
  assert.equal(empty.manifest.full_diff.bytes, 0);
  assert.equal(empty.manifest.preview.truncated, false);
  fs.writeFileSync(path.join(directory, "head-only.txt"), "head change\n");
  execFileSync("git", ["add", "head-only.txt"], {cwd: directory});
  execFileSync("git", ["commit", "-qm", "head change"], {cwd: directory});
  const head = execFileSync("git", ["rev-parse", "HEAD"], {cwd: directory, encoding: "utf8"}).trim();
  execFileSync("git", ["checkout", "-qb", "base-ahead", ancestor], {cwd: directory});
  fs.writeFileSync(path.join(directory, "base-only.txt"), "unrelated base advance\n");
  execFileSync("git", ["add", "base-only.txt"], {cwd: directory});
  execFileSync("git", ["commit", "-qm", "base advance"], {cwd: directory});
  const base = execFileSync("git", ["rev-parse", "HEAD"], {cwd: directory, encoding: "utf8"}).trim();
  execFileSync("git", ["checkout", "-q", "--detach", head], {cwd: directory});
  const divergent = stage(base, head);
  assert.equal(divergent.manifest.base_sha, base);
  assert.equal(divergent.manifest.diff_base_sha, ancestor);
  assert.equal(divergent.manifest.head_sha, head);
  assert.match(divergent.full, /head change/);
  assert.doesNotMatch(divergent.full, /unrelated base advance/);
});

test("the compiled observer contract pins compatible Muse and allows both full-input tools", () => {
  const museSha = "f422d77cf9c6cea46b6791e3f54c98679e949d1f";
  const expectedRef = "${{ inputs.muse_revision || '" + museSha + "' }}";
  assert.equal(workflow.on.workflow_call.inputs.muse_revision.default, museSha,
    "workflow-call default must select the corrected immutable Muse source");
  assert.equal(namedStep("prepare_review_context", "Checkout Muse compatibility compiler").with.ref,
    expectedRef, "direct-PR compiler fallback must match the workflow-call default");
  const assembly = namedStep("prepare_review_context", "Assemble revision-bound review context");
  assert.equal(assembly.env.MUSE_REPOSITORY,
    namedStep("prepare_review_context", "Checkout Muse compatibility compiler").with.repository,
    "artifact provenance must record the actual Muse repository selection");
  assert.equal(assembly.env.MUSE_REVISION, expectedRef,
    "artifact provenance must record the same effective Muse selection");
  const companion = YAML.parse(fs.readFileSync(
    path.join(root, ".github/workflows/muse-review-context-diagnostic.yml"), "utf8"));
  const companionCheckout = companion.jobs.diagnose.steps.find(step => step.name === "Checkout Muse");
  assert.equal(companionCheckout.with.repository, assembly.env.MUSE_REPOSITORY,
    "the companion diagnostic must compile the production default repository");
  assert.equal(companionCheckout.with.ref, museSha,
    "the companion diagnostic must compile the production default revision");
  for (const name of ["review_read_diff_chunk", "review_assess_diff_chunk", "review_read_diff_batch", "review_assess_diff_batch", "review_assess_delivered_diff_batch"]) {
    assert.ok(workflowText.includes(`:${name}`), `missing permission for ${name}`);
    assert.ok(workflowText.includes(`'${name}'`), `missing compiled registry assertion for ${name}`);
  }
});

test("context assembly records Muse and Agents inputs literally without executing ref text", (t) => {
  const { directory, sha } = makeRepository(t);
  const runnerTemp = path.join(directory, "runner-temp");
  fs.mkdirSync(runnerTemp);
  for (const [relativePath, content] of [
    [".review-context/muse/.opencode/dist/fixture.cjs", "// compiled fixture\n"],
    [".review-context/muse/.opencode/dist/review-invocation.cjs", transportVerifierSource],
    [".review-context/muse/.opencode/plugins/fixture.mjs", "// plugin fixture\n"],
    [".review-context/muse/.opencode/agents/github-reviewer.md", "reviewer fixture\n"],
    [".review-context/muse/.opencode/opencode.json", "{}\n"],
    [".review-context/muse/.opencode/package.json", "{}\n"],
    [".review-context/muse/.opencode/exposed-tools.txt", "observer fixture\n"],
    [".review-context/muse/.ημ/review/evidence-review.md", "prompt fixture\n"],
    [".review-context/muse/.ημ/review/publish-opencode-review.cjs", "// publisher fixture\n"],
    [".review-context/muse/.ημ/review/publish-opencode-review.test.cjs", "// test fixture\n"],
    [".review-context/agents/skills/fixture/SKILL.md", "skill fixture\n"],
  ]) {
    const file = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }

  const assembly = namedStep("prepare_review_context", "Assemble revision-bound review context");
  const canary = path.join(directory, "ref-command-canary.txt");
  const adversarialRef = "ref-$(printf${IFS}injected>ref-command-canary.txt)";
  execFileSync("git", ["check-ref-format", "--branch", adversarialRef]);
  for (const [museRevision, agentsRevision] of [
    [undefined, undefined], [sha, sha], [adversarialRef, undefined], [undefined, adversarialRef],
  ]) {
    const inputs = { muse_revision: museRevision, agents_revision: agentsRevision };
    // Actions substitutes expressions in run text but transports env values as
    // data. Exercise that boundary with the complete native assembly script.
    const renderInputs = (text) => text.replace(
      /\$\{\{\s*inputs\.(muse_revision|agents_revision)\s*\|\|\s*'([^']+)'\s*\}\}/g,
      (_expression, input, fallback) => inputs[input] || fallback,
    );
    const result = runScript(renderInputs(assembly.run), directory, {
      RUNNER_TEMP: runnerTemp,
      ...Object.fromEntries(Object.entries(assembly.env ?? {}).map(
        ([name, value]) => [name, renderInputs(value)],
      )),
    });
    assert.equal(fs.existsSync(canary), false, "Review-context ref text executed as Bash source");
    assert.equal(result.status, 0, result.stderr);
    const context = path.join(runnerTemp, "opencode-review-context");
    const repository = namedStep("prepare_review_context", "Checkout Muse compatibility compiler").with.repository;
    assert.equal(fs.readFileSync(path.join(context, "metadata/muse-repository.txt"), "utf8"),
      `${repository}\n`, "downloaded context must retain the actual Muse repository alongside its revision");
    assert.equal(fs.readFileSync(path.join(context, "metadata/muse-revision.txt"), "utf8"),
      `${museRevision || workflow.on.workflow_call.inputs.muse_revision.default}\n`);
    assert.equal(fs.readFileSync(path.join(context, "metadata/agents-revision.txt"), "utf8"),
      `${agentsRevision || workflow.on.workflow_call.inputs.agents_revision.default}\n`);
    const checksums = runScript("sha256sum --check SHA256SUMS", context);
    assert.equal(checksums.status, 0, checksums.stderr);
    const repositoryHash = createHash("sha256").update(`${repository}\n`).digest("hex");
    assert.ok(fs.readFileSync(path.join(context, "SHA256SUMS"), "utf8")
      .includes(`${repositoryHash}  ./metadata/muse-repository.txt\n`),
      "Muse repository identity must be in the actual context checksum set");
    assert.equal(fs.readFileSync(path.join(context, "machinery/review-invocation.cjs"), "utf8"),
      transportVerifierSource, "assembly must retain the selected verifier's exact fixture bytes");
  }
});

const inputVerificationName = "Verify full review input against independent Git snapshot";
const finalInputVerificationName = "Reverify full input and bind final submission";

/** Stage native-shaped producer input, including empty, large and retained-attempt cases. */
function fullInputFixture(t, { large = false, baseAhead = false, empty = false, unicode = false, invalidUtf8 = false, producerAttempt = "2", reviewLines = 2 } = {}) {
  const { directory, sha: ancestor } = makeRepository(t);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "eta-mu-review-input-"));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  if (!empty) {
    fs.writeFileSync(path.join(directory, "large.txt"),
      invalidUtf8 ? Buffer.concat([Buffer.from("changed input "), Buffer.from([0xff]), Buffer.from("\n")])
        : (unicode ? "changed 😀 ημ input\n" : "changed input\n").repeat(large ? 26000 : reviewLines));
    fs.writeFileSync(path.join(directory, "尾-ημ.txt"), "tail hunk must be reviewed\n");
    execFileSync("git", ["add", "large.txt", "尾-ημ.txt"], { cwd: directory });
    execFileSync("git", ["commit", "-qm", "review input head"], { cwd: directory });
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
  let base = ancestor;
  if (baseAhead) {
    execFileSync("git", ["checkout", "-qb", "advanced-base", ancestor], { cwd: directory });
    fs.writeFileSync(path.join(directory, "base-only.txt"), "unrelated base change\n");
    execFileSync("git", ["add", "base-only.txt"], { cwd: directory });
    execFileSync("git", ["commit", "-qm", "base advanced independently"], { cwd: directory });
    base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
    execFileSync("git", ["checkout", "-q", "--detach", head], { cwd: directory });
  }
  const eventFile = path.join(scratch, "event.json");
  const event = { pull_request: { number: 42, title: "input fixture", user: { login: "fixture" },
    head: { ref: "review", sha: head }, base: { ref: "main", sha: base }, draft: false } };
  fs.writeFileSync(eventFile, JSON.stringify(event));
  const env = {
    GITHUB_WORKSPACE: directory, GITHUB_EVENT_PATH: eventFile, PR_BASE_SHA: base, PR_HEAD_SHA: head,
    GITHUB_REPOSITORY: "open-hax/fixture", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: producerAttempt,
    GITHUB_WORKFLOW_SHA: head, GITHUB_WORKFLOW_REF: "open-hax/fixture/.github/workflows/review.yml@refs/pull/42/merge",
    RUNNER_TEMP: scratch,
  };
  const staged = runScript(namedStep("deterministic_evidence", "Stage pull request diff and context").run, directory, env);
  assert.equal(staged.status, 0, staged.stderr);
  const artifactOutput = path.join(scratch, "artifact-output");
  const bound = runScript(namedStep("deterministic_evidence", "Bind deterministic artifact name").run, directory, {
    PR_NUMBER: String(event.pull_request.number), RUN_ID: env.GITHUB_RUN_ID,
    RUN_ATTEMPT: env.GITHUB_RUN_ATTEMPT, GITHUB_OUTPUT: artifactOutput,
  });
  assert.equal(bound.status, 0, bound.stderr);
  return { directory, scratch, base, head, ancestor, env, event,
    artifactName: parseOutput(artifactOutput).name,
    evidence: path.join(directory, ".opencode/review-evidence") };
}

/** Execute the real fresh-checkout/input guard and retain its consumer and trusted outputs. */
function freshReviewInputCheck(fixture, overrides = {}) {
  const consumer = fs.mkdtempSync(path.join(fixture.scratch, "fresh-review-"));
  execFileSync("git", ["clone", "-q", "--no-hardlinks", fixture.directory, consumer]);
  execFileSync("git", ["checkout", "-q", "--detach", fixture.head], { cwd: consumer });
  const evidence = path.join(consumer, ".opencode/review-evidence");
  const env = { ...fixture.env, GITHUB_WORKSPACE: consumer,
    REVIEW_INPUT_PHASE: "fresh",
    ...guardEnvironment(consumer, path.join(fixture.scratch, "guard-output"), fixture.head),
    EXPECTED_SHA: fixture.head, REVIEW_EVIDENCE_ARTIFACT_NAME: fixture.artifactName, ...overrides };
  const guard = runScript(namedStep("review", "Verify exact and clean review checkout").run, consumer, env);
  assert.equal(guard.status, 0, guard.stderr || guard.stdout);
  fs.cpSync(fixture.evidence, evidence, { recursive: true });
  // On the immutable pre-fix workflow the exact-head guard was the only Git
  // check before consuming downloaded input. Preserve that real RED behavior.
  const verification = workflow.jobs.review.steps.find((step) => step.name === inputVerificationName);
  const result = verification ? runScript(verification.run, consumer, env) : guard;
  const invocation = path.join(consumer, "model-or-publication-invoked");
  if (result.status === 0) fs.writeFileSync(invocation, "synthetic invocation boundary\n");
  return { result, evidence, invocation, consumer, env };
}

// Exact full metadata from the genuine retained dc4 native submission,
// artifact11293745387 / review-attempt-340-37173972128-1, generated by Muse0b.
// All13 assessment ranges/notes are retained as serialized-shape provenance.
// Adapted synthetic fixtures do not inherit its native review verdict.
// Source artifact SHA256: 928a7285f6462186d54f10d4e29976ac81f70da196739785b8637cd396f222f4.
const nativeMetadataShape = {
  "input-source": {
    "schema": "open-hax.review-input/v1",
    "base_sha": "b18764d47c0b8da0b2d31f02d8bdd889323ee65c",
    "head_sha": "dc4e5d605ef60a439bef9497266932ff1fd9902a",
    "diff_base_sha": "b18764d47c0b8da0b2d31f02d8bdd889323ee65c",
    "full_diff": {
      "path": "basehead.diff",
      "bytes": 95938,
      "sha256": "49c733c322fd771393c78f70d64dbf16afde09adc9c4ec2899dffe485cd07b39"
    },
    "preview": {
      "path": "pr.diff",
      "limit_bytes": 300000,
      "truncated": false
    },
    "provenance": {
      "repository": "open-hax/eta-mu",
      "pull_request": "340",
      "run_id": "37173972128",
      "run_attempt": "1",
      "workflow_sha": "acfc2725db1d2441ec01ec2352cba105fb048149",
      "workflow_ref": "open-hax/eta-mu/.github/workflows/opencode-code-review.yml@refs/pull/340/merge"
    }
  },
  "input-coverage": {
    "chunks": 13,
    "delivered": 13,
    "assessed": 13,
    "missing": []
  },
  "input-assessments": [
    {
      "id": 1,
      "start": 0,
      "end": 7876,
      "note": "Hunk 1: adds node:crypto createHash import and three new workflow tests for full-diff staging (preserves >300KB immutable diff with Unicode tail, exact merge-base/head bytes, preview prefix equality, manifest schema fields), fail-closed staging (absent base / mismatched head), and empty/divergent-base staging (base_sha vs diff_base_sha distinction). Assertions look semantically correct: byte equality against git diff, SHA-256 manifest cross-check, preview prefix bound. No defect apparent in this hunk."
    },
    {
      "id": 2,
      "start": 7876,
      "end": 16068,
      "note": "Chunk 2: continues the context-assembly test — exercises adversarial ref text (`ref-$(printf${IFS}injected>...)`) through renderInputs, asserts the canary file is never created (ref text not executed as Bash), validates metadata revision files and SHA256SUMS. Then adds fullInputFixture helper (staging + artifact-name binding) and freshReviewInputCheck helper (fresh clone, exact-head guard, evidence copy, runs the new input-verification step and simulates model invocation boundary). The ordering assertion checks verification runs after download and before context install, publisher test, model run, token creation, and publication. Logic is coherent; no defect apparent."
    },
    {
      "id": 3,
      "start": 16068,
      "end": 23836,
      "note": "Chunk 3: adversarial tests — malicious gate that replaces basehead.diff/pr.diff/manifest with a forged empty diff must fail at fresh-job verification before model invocation; independent verification accepts exact/empty/divergent-base input and records proof schema v1; failed-job rerun records producer attempt 1 and verification attempt 2; forged artifact-name/attempt variants (wrong PR, run, attempt, oversized, trailing newline, non-integer) all rejected; mutated manifest fields (ids, bytes, sha256, path, preview flag, provenance) all rejected. Assertions are consistently fail-closed (non-zero status, no invocation file, no input-verification.json). Sound test design; no defect apparent."
    },
    {
      "id": 4,
      "start": 23836,
      "end": 30597,
      "note": "Chunk 4: end of test file (altered-bytes and altered-preview rejection), diagnostic workflow Muse pin bump 05b4f1c5→0b9a9149, and core staging change in opencode-code-review.yml: adds node_version input (default \"22\"), strict SHA regex + HEAD/event equality checks, explicit merge-base then two-dot git diff to basehead.diff, SHA-256 manifest, preview copy/truncate with suffix, removal of the old `|| true` two-step fallback (now fails closed), and moves MUSE_REVISION/AGENTS_REVISION substitution out of run text into step env (injection hardening). Staging logic consistent: manifest bytes/digest computed on basehead.diff; truncated preview = head -c 300000 + suffix. No defect apparent; checkout depth assumption inherited from prior three-dot diff which also needed merge-base."
    },
    {
      "id": 5,
      "start": 30597,
      "end": 38724,
      "note": "Chunk 5: (a) policy allow-set and compiled registry assertion now include review_read_diff_chunk/review_assess_diff_chunk (consistent with the 22-tool claim); (b) Assemble revision-bound review context moves MUSE_REVISION/AGENTS_REVISION into step env (avoids `${{ }}` injection into run text) with updated Muse default 0b9a9149…; (c) node_version applied to review job setup-node; (d) the new independent verification step: deletes any supplied receipt, re-validates SHAs/event/HEAD, regenerates authoritative diff, Node script cross-checks manifest schema/ids/bytes/sha256/preview/provenance against fresh env + artifact-name regex (PR/run/attempt bound, BigInt attempt ordering), byte-compares downloaded full diff, reconstructs preview incl. truncation suffix, then writes input-verification.json. Fail-closed throughout (strict assert, set -euo pipefail, no continue-on-error). Logic coherent and matches the tests; no defect apparent."
    },
    {
      "id": 6,
      "start": 38724,
      "end": 46916,
      "note": "Chunk 6: adds input-verification.json to the attempt artifact upload path (proof retained); appends session-ledger entries (pure provenance notes, no executable content); docs/agent-workflows.md documents staging semantics (merge-base/head bytes, manifest fields, fail-closed staging, empty diff valid) and the full-input read/assess contract requiring every page assessed before submission — consistent with actual tool behavior observed in this session. No defect apparent."
    },
    {
      "id": 7,
      "start": 46916,
      "end": 54562,
      "note": "Chunk 7: docs/agent-workflows.md tail (producer attempt binding semantics — matches implementation: producer provenance retained, verification_provenance separate), docs/github-automation-architecture.md pin update to 0b9a9149 and diagnostic-subset caveat, and start of new docs/verification/full-review-input.md (verification narrative; mentions historical 446b199 stage — superseded later in same file by the 0b9a9149 section, consistent with workflow). Narrative/chronology, not executable. No defect apparent."
    },
    {
      "id": 8,
      "start": 54562,
      "end": 62754,
      "note": "Chunk 8: remainder of full-review-input.md verification narrative (fresh-job verification rationale, RED malicious-gate fixture, 44/44 suite, final section aligning all selectors to 0b9a9149, node_version interface note) and new kanban task card 256c5dd5 (incoming, scope/acceptance criteria matching the implemented change). Content is documentation/board provenance; claims match observable workflow and tests. No defect apparent."
    },
    {
      "id": 9,
      "start": 62754,
      "end": 70946,
      "note": "Chunk 9: rest of kanban card acceptance criteria (matches implementation) and append-only receipts.edn entries recording RED/GREEN workflow runs, Muse pin progression (05b→7a8788→446b199→0b9a9149), and immutable-input verification history. Provenance data only; internal claims are test records, not executable behavior. No defect apparent."
    },
    {
      "id": 10,
      "start": 70946,
      "end": 79138,
      "note": "Chunk 10: further append-only receipts documenting the grouped native review repairs (ref-command canary test, producer/consumer attempt provenance, forged-manifest attempt acceptance RED), current Muse selector prose correction, and test counts (47 fixtures GREEN on Node 24 and Node 22.20.0). Provenance only. No defect apparent."
    },
    {
      "id": 11,
      "start": 79138,
      "end": 87330,
      "note": "Chunk 11: receipts entries covering the historical-receipt-reader limitation (pre-existing malformed EDN at line 101 explicitly flagged as drift not introduced by this patch) and the Agents-ref step-env correction (hostile ref canary RED→GREEN). Provenance records with explicit non-claims. No defect apparent."
    },
    {
      "id": 12,
      "start": 87330,
      "end": 95522,
      "note": "Chunk 12: receipts entries for the grouped repair decision record (artifact-name regex binding, BigInt attempt ordering, provenance deepEqual retained, 18 forged cases refused) and the reflection/observation records incl. pre-existing EDN reader failure disclosure. Provenance only. No defect apparent."
    },
    {
      "id": 13,
      "start": 95522,
      "end": 95882,
      "note": "Chunk 13 (final): tail of receipts.edn — Agents step-env correction completion, Session Mycology scoring, frozen handoff note, repeat that historical EDN reader failure is pre-existing. End of full diff. All 13/13 pages delivered and assessed."
    }
  ]
};

/** Adapt a provenance-backed transport fixture, or run actual compiled Muse tools locally. */
function completeInputSubmission(checked) {
  if (process.env.ETA_MU_MUSE_TOOL_FIXTURE) {
    return JSON.parse(execFileSync(process.execPath,
      [process.env.ETA_MU_MUSE_TOOL_FIXTURE, checked.consumer], { encoding: "utf8" }));
  }
  const text = fs.readFileSync(path.join(checked.evidence, "basehead.diff"), "utf8");
  const assessments = [];
  // Small fixture intervals exercise coverage closure independently of Muse's
  // reader pagination. Production consumes the tool-written intervals unchanged.
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 1024, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
    assessments.push({ ...nativeMetadataShape["input-assessments"][0],
      id: assessments.length + 1, start, end,
      note: "Synthetic complete-coverage transport fixture, not a model assessment." });
    start = end;
  }
  return { ...validSubmission(),
    "input-source": JSON.parse(fs.readFileSync(path.join(checked.evidence, "input-manifest.json"))),
    "input-coverage": { ...nativeMetadataShape["input-coverage"],
      chunks: assessments.length, delivered: assessments.length,
      assessed: assessments.length, missing: [] },
    "input-assessments": assessments };
}

/** Capture a checksummed TRANSPORT MOCK context; no canonical review-law credit. */
function contextFixture(checked) {
  const context = path.join(checked.consumer, ".review-context");
  fs.mkdirSync(context);
  fs.writeFileSync(path.join(context, "publisher-fixture.cjs"), "// checksummed context fixture\n");
  const invocation = stageTransportVerifier(checked.evidence, {
    verifierFile: path.join(context, "machinery/review-invocation.cjs"),
    registryFile: path.join(context, "metadata/exposed-tools.txt"),
  });
  const checksum = execFileSync("sha256sum", ["publisher-fixture.cjs",
    "machinery/review-invocation.cjs", "metadata/exposed-tools.txt"], { cwd: context });
  fs.writeFileSync(path.join(context, "SHA256SUMS"), checksum);
  return { context, invocation, digest: createHash("sha256").update(checksum).digest("hex"),
    /**
     * Bind this transport fixture and store its invocation digest.
     * @returns {void}
     */
    bind() {
      this.invocationDigest = bindTransportInvocation(checked.evidence, invocation);
      this.recoveryDigest = transportSha256(fs.readFileSync(path.join(checked.evidence, "recovery.json")));
    },
    /**
     * Record a completed transport recovery binding in the fixture output.
     * @param {Object} result - Recovery metadata with an accepted invocation.
     * @returns {void}
     * @throws {AssertionError} If the accepted invocation is missing.
     */
    acceptRecovery(result) {
      assert.ok(result.accepted_invocation, "strict transport recovery must select a completed invocation");
      this.invocationDigest = transportSha256(JSON.stringify(result.accepted_invocation));
      this.recoveryDigest = transportSha256(fs.readFileSync(path.join(checked.evidence, "recovery.json")));
      fs.appendFileSync(invocation.output, `review_invocation_sha256=${this.invocationDigest}\n`);
    } };
}

/** Execute the actual final command, or dc4's original completion guard for semantic RED. */
function finalReviewInputCheck(checked, context, overrides = {}) {
  fs.rmSync(checked.invocation, { force: true });
  const publication = path.join(checked.evidence, "publisher-invoked");
  fs.rmSync(publication, { force: true });
  const output = path.join(checked.env.RUNNER_TEMP, "final-outputs");
  const env = { ...checked.env, GITHUB_OUTPUT: output, REVIEW_INPUT_PHASE: "final",
    REVIEW_INPUT_VERIFICATION_SHA256: parseOutput(checked.env.GITHUB_OUTPUT).input_verification_sha256,
    REVIEW_CONTEXT_SHA256: context.digest,
    REVIEW_INVOCATION_SHA256: context.invocationDigest,
    REVIEW_RECOVERY_SHA256: context.recoveryDigest ?? parseOutput(context.output).review_recovery_sha256,
    EXPECTED_SHA: checked.env.PR_HEAD_SHA, EXECUTED_SHA: checked.env.PR_HEAD_SHA,
    INITIAL_EXACT_HEAD: "true", INITIAL_CLEAN: "true", ...overrides };
  const step = workflow.jobs.review.steps.find((candidate) => candidate.name === finalInputVerificationName);
  const legacy = namedStep("review", "Verify review remained revision-bound");
  const result = runScript(step?.run ?? legacy.run, checked.consumer, env);
  if (result.status === 0) fs.writeFileSync(publication, "synthetic publisher boundary\n");
  return { result, publication, output, step };
}

test("fresh and final input verification share one command before App mint and publication", () => {
  const fresh = namedStep("review", inputVerificationName);
  const final = namedStep("review", finalInputVerificationName);
  assert.equal(final.run, fresh.run, "fresh/final verification laws must not diverge");
  assert.equal(fresh.env.REVIEW_INPUT_PHASE, "fresh");
  assert.equal(final.env.REVIEW_INPUT_PHASE, "final");
  assert.equal(final.env.REVIEW_INPUT_VERIFICATION_SHA256,
    "${{ steps.review_input.outputs.input_verification_sha256 }}");
  assert.equal(final.env.REVIEW_CONTEXT_SHA256,
    "${{ steps.review_context.outputs.context_sha256 }}");
  assert.equal(final.env.REVIEW_INVOCATION_SHA256,
    "${{ steps.review_invocation.outputs.review_invocation_sha256 }}");
  assert.equal(final.env.REVIEW_RECOVERY_SHA256,
    "${{ steps.review_invocation.outputs.review_recovery_sha256 }}");
  const invocation = namedStep("review", "Run bounded evidence-first OpenCode review");
  assert.equal(invocation.id, "review_invocation");
  assert.equal(invocation.env.REVIEW_INVOCATION_VERIFIER_FILE,
    "${{ github.workspace }}/.review-context/machinery/review-invocation.cjs");
  assert.equal(final.if, undefined);
  assert.notEqual(final["continue-on-error"], true);
  const steps = workflow.jobs.review.steps;
  assert.ok(steps.indexOf(final) > steps.indexOf(namedStep("review", "Run bounded evidence-first OpenCode review")));
  for (const name of ["Validate final review submission", "Create eta-mu GitHub App token for review publication",
    "Publish actual GitHub pull request review"]) {
    assert.ok(steps.indexOf(final) < steps.indexOf(namedStep("review", name)));
  }
  for (const name of ["Validate final review submission", "Publish actual GitHub pull request review"]) {
    assert.equal(namedStep("review", name).env.REVIEW_SUBMISSION_FILE,
      "${{ steps.final_review_input.outputs.submission_file }}");
  }
});

test("post-guard input, manifest, proof and context mutation stops before publisher", (t) => {
  const fixture = fullInputFixture(t);
  const mutations = [
    (c) => {
      const manifest = JSON.parse(fs.readFileSync(path.join(c.evidence, "input-manifest.json")));
      for (const file of ["basehead.diff", "pr.diff"]) fs.writeFileSync(path.join(c.evidence, file), "");
      manifest.full_diff.bytes = 0;
      manifest.full_diff.sha256 = createHash("sha256").update("").digest("hex");
      manifest.preview.truncated = false;
      fs.writeFileSync(path.join(c.evidence, "input-manifest.json"), JSON.stringify(manifest));
    },
    (c) => fs.appendFileSync(path.join(c.evidence, "basehead.diff"), "changed after verification\n"),
    (c) => fs.writeFileSync(path.join(c.evidence, "pr.diff"), "changed preview\n"),
    (c) => {
      const file = path.join(c.evidence, "input-manifest.json");
      const manifest = JSON.parse(fs.readFileSync(file));
      manifest.provenance.run_id = "999";
      fs.writeFileSync(file, JSON.stringify(manifest));
    },
    (c) => fs.appendFileSync(path.join(c.evidence, "input-manifest.json"), "\n"),
    (c) => fs.writeFileSync(path.join(c.evidence, "input-verification.json"), '{"input_verified":true}'),
    (c) => fs.rmSync(path.join(c.evidence, "input-verification.json")),
    (_c, context) => fs.appendFileSync(path.join(context.context, "publisher-fixture.cjs"), "// replaced\n"),
    (_c, context) => {
      fs.appendFileSync(path.join(context.context, "publisher-fixture.cjs"), "// replaced\n");
      fs.writeFileSync(path.join(context.context, "SHA256SUMS"),
        execFileSync("sha256sum", ["publisher-fixture.cjs"], { cwd: context.context }));
    },
  ];
  for (const mutate of mutations) {
    const checked = freshReviewInputCheck(fixture);
    assert.equal(checked.result.status, 0, checked.result.stderr);
    const context = contextFixture(checked);
    fs.writeFileSync(path.join(checked.evidence, "submission.json"), JSON.stringify(completeInputSubmission(checked)));
    context.bind();
    mutate(checked, context);
    const final = finalReviewInputCheck(checked, context);
    assert.notEqual(final.result.status, 0, "post-guard mutation passed the actual publication boundary");
    assert.equal(fs.existsSync(final.publication), false);
  }
});

test("final invocation binding rejects altered selected evidence before publication", (t) => {
  const fixture = fullInputFixture(t);
  // Actual final-command custody checks; the verifier is a transport mock.
  // Compiled canonical semantics receive no credit from these fixture verdicts.
  const cases = [
    ["absent trusted digest", (_c, _context, env) => { env.REVIEW_INVOCATION_SHA256 = ""; }],
    ["different trusted digest", (_c, _context, env) => { env.REVIEW_INVOCATION_SHA256 = "0".repeat(64); }],
    ["missing recovery", (c) => { fs.rmSync(path.join(c.evidence, "recovery.json")); }],
    ["missing selected response", (c) => { fs.rmSync(path.join(c.evidence, "model-response-attempt-1.txt")); }],
    ["changed selected response", (c) => { fs.appendFileSync(path.join(c.evidence, "model-response-attempt-1.txt"), "changed\n"); }],
    ["changed submission bytes", (c) => { fs.appendFileSync(path.join(c.evidence, "submission.json"), "\n"); }],
    ["outside shared bound", (_c, _context, _env, r) => { r.max_attempts = 3; }],
    ["unsuccessful selected exit", (_c, _context, _env, r) => { r.attempts[0].exit_code = 1; }],
    ["rejected selected process", (_c, _context, _env, r) => { r.attempts[0].invocation_state = "rejected"; }],
    ["altered accepted object", (_c, _context, _env, r) => { r.accepted_invocation.session_id = "ses_changed"; }],
    ["bound foreign session", (_c, _context, env, r) => {
      r.accepted_invocation.session_id = "ses_changed";
      env.REVIEW_INVOCATION_SHA256 = transportSha256(JSON.stringify(r.accepted_invocation));
    }],
    ["bound changed context", (_c, _context, env, r) => {
      r.accepted_invocation.expected_context_sha256 = "f".repeat(64);
      env.REVIEW_INVOCATION_SHA256 = transportSha256(JSON.stringify(r.accepted_invocation));
    }],
    ["bound changed verdict", (_c, _context, env, r) => {
      r.accepted_invocation.canonical_verdict.code = "altered-verdict";
      env.REVIEW_INVOCATION_SHA256 = transportSha256(JSON.stringify(r.accepted_invocation));
    }],
    ["bound invalid selected path", (_c, _context, env, r) => {
      r.accepted_invocation.response_file = "../different.txt";
      env.REVIEW_INVOCATION_SHA256 = transportSha256(JSON.stringify(r.accepted_invocation));
    }],
  ];
  for (const [name, mutate] of cases) {
    const checked = freshReviewInputCheck(fixture);
    assert.equal(checked.result.status, 0, checked.result.stderr);
    const context = contextFixture(checked);
    fs.writeFileSync(path.join(checked.evidence, "submission.json"), JSON.stringify(completeInputSubmission(checked)));
    context.bind();
    const recoveryFile = path.join(checked.evidence, "recovery.json");
    const recovery = JSON.parse(fs.readFileSync(recoveryFile));
    const overrides = {};
    mutate(checked, context, overrides, recovery);
    if (fs.existsSync(recoveryFile)) fs.writeFileSync(recoveryFile, JSON.stringify(recovery));
    const final = finalReviewInputCheck(checked, context, overrides);
    assert.notEqual(final.result.status, 0, `${name} passed the actual final command`);
    assert.equal(fs.existsSync(final.publication), false, `${name} reached publication`);
    if (fs.existsSync(final.output)) {
      assert.equal(parseOutput(final.output).submission_file, undefined, `${name} emitted a publishable frozen file`);
    }
  }
});

test("final binding refuses absent, mismatched and incomplete submission metadata", (t) => {
  const fixture = fullInputFixture(t, { unicode: true });
  const mutations = [
    (s) => { delete s["input-source"]; },
    (s) => { delete s["input-coverage"]; },
    (s) => { delete s["input-assessments"]; },
    (s) => { s["input-source"].head_sha = "a".repeat(40); },
    (s) => { s["input-source"].base_sha = "b".repeat(40); },
    (s) => { s["input-source"].full_diff.sha256 = "c".repeat(64); },
    (s) => { s["input-source"].full_diff.bytes += 1; },
    (s) => { s["input-source"].provenance.run_attempt = "1"; },
    (s) => { s["input-coverage"].delivered = 0; },
    (s) => { s["input-coverage"].assessed = 0; },
    (s) => { s["input-coverage"].missing = [1]; },
    (s) => { s["input-coverage"].chunks += 1; },
    (s) => { s["input-assessments"][0].note = " \n "; },
    (s) => { s["input-assessments"][0].start = 1; },
    (s) => { s["input-assessments"][0].end -= 1; },
    (s) => { s["input-assessments"][0].end = s["input-source"].full_diff.bytes; },
    (s) => { s["input-assessments"][0].id = 2; },
  ];
  for (const mutate of mutations) {
    const checked = freshReviewInputCheck(fixture);
    assert.equal(checked.result.status, 0, checked.result.stderr);
    const context = contextFixture(checked);
    const submission = completeInputSubmission(checked);
    fs.writeFileSync(path.join(checked.evidence, "submission.json"), JSON.stringify(submission));
    context.bind();
    mutate(submission);
    fs.writeFileSync(path.join(checked.evidence, "submission.json"), JSON.stringify(submission));
    const final = finalReviewInputCheck(checked, context);
    assert.notEqual(final.result.status, 0, "invalid tool-envelope metadata reached publisher");
    assert.equal(fs.existsSync(final.publication), false);
  }
});

test("final binding accepts complete empty, large, Unicode and retained producer input", (t) => {
  for (const options of [{ empty: true }, { large: true, unicode: true }, { baseAhead: true },
    { unicode: true }, { producerAttempt: "1" }]) {
    const fixture = fullInputFixture(t, options);
    const checked = freshReviewInputCheck(fixture, { GITHUB_RUN_ATTEMPT: "2" });
    assert.equal(checked.result.status, 0, checked.result.stderr);
    const context = contextFixture(checked);
    const bytes = Buffer.from(`${JSON.stringify(completeInputSubmission(checked))}\n`);
    fs.writeFileSync(path.join(checked.evidence, "submission.json"), bytes);
    context.bind();
    const final = finalReviewInputCheck(checked, context);
    assert.equal(final.result.status, 0, final.result.stderr);
    if (final.step) {
      const outputs = parseOutput(final.output);
      assert.ok(fs.readFileSync(outputs.submission_file).equals(bytes), "validation must freeze exact tool-written bytes");
      assert.equal(outputs.submission_sha256, createHash("sha256").update(bytes).digest("hex"));
      const proof = JSON.parse(fs.readFileSync(path.join(checked.evidence, "submission-verification.json")));
      assert.equal(proof.input_verified, true);
      assert.equal(proof.provenance.run_attempt, options.producerAttempt || "2");
      assert.equal(proof.verification_provenance.run_attempt, "2");
    }
  }
});

test("final binding follows real omission-only recovery and freezes the unchanged submission", async (t) => {
  const fixture = fullInputFixture(t);
  const checked = freshReviewInputCheck(fixture);
  assert.equal(checked.result.status, 0, checked.result.stderr);
  const context = contextFixture(checked);
  let submitted;
  const result = await runReviewRecovery({ evidenceDirectory: checked.evidence, basePrompt: "fixture review",
    verifyReviewInvocation: context.invocation.verifyReviewInvocation,
    expectedContext: context.invocation.expectedContext,
    verifierSha256: context.invocation.verifierSha256,
    invokeAttempt: async ({ attempt, responseFile, stderrFile }) => {
      fs.writeFileSync(responseFile, transportResponse({ submission: attempt === 2 }));
      fs.writeFileSync(stderrFile, "");
      if (attempt === 2) {
        submitted = JSON.stringify(completeInputSubmission(checked));
        fs.writeFileSync(path.join(checked.evidence, "submission.json"), submitted);
      }
      return { exitCode: 0 };
    } });
  assert.deepEqual(result.attempts.map((a) => a.submission_state), ["missing", "present"]);
  assert.equal(result.attempts[0].canonical_verdict.reason, "missing-review-submit");
  assert.equal(result.accepted_invocation.attempt, 2);
  context.acceptRecovery(result);
  const final = finalReviewInputCheck(checked, context);
  assert.equal(final.result.status, 0, final.result.stderr);
  if (final.step) {
    const frozen = parseOutput(final.output).submission_file;
    fs.writeFileSync(path.join(checked.evidence, "submission.json"), JSON.stringify(validSubmission()));
    assert.equal(fs.readFileSync(frozen, "utf8"), submitted, "publisher must consume the validated bytes, not a changed source artifact");
  }
});

test("post-guard mutation during the recovery invocation still stops publication", async (t) => {
  const fixture = fullInputFixture(t);
  const checked = freshReviewInputCheck(fixture);
  assert.equal(checked.result.status, 0, checked.result.stderr);
  const context = contextFixture(checked);
  const result = await runReviewRecovery({ evidenceDirectory: checked.evidence, basePrompt: "fixture review",
    verifyReviewInvocation: context.invocation.verifyReviewInvocation,
    expectedContext: context.invocation.expectedContext,
    verifierSha256: context.invocation.verifierSha256,
    invokeAttempt: async ({ attempt, responseFile, stderrFile }) => {
      fs.writeFileSync(responseFile, transportResponse({ submission: attempt === 2 }));
      fs.writeFileSync(stderrFile, "");
      if (attempt === 1) fs.writeFileSync(path.join(checked.evidence, "input-verification.json"), '{"input_verified":true}');
      if (attempt === 2) fs.writeFileSync(path.join(checked.evidence, "submission.json"), JSON.stringify(completeInputSubmission(checked)));
      return { exitCode: 0 };
    } });
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].canonical_verdict.reason, "missing-review-submit");
  context.acceptRecovery(result);
  const final = finalReviewInputCheck(checked, context);
  assert.notEqual(final.result.status, 0, "recovery bypassed the original trusted input receipt");
  assert.equal(fs.existsSync(final.publication), false);
});

test("a fresh review job verifies downloaded input before tools, model or publication", () => {
  const steps = workflow.jobs.review.steps;
  const verification = namedStep("review", inputVerificationName);
  assert.equal(verification.if, undefined);
  assert.notEqual(verification["continue-on-error"], true);
  const index = steps.indexOf(verification);
  assert.ok(index > steps.indexOf(namedStep("review", "Download deterministic evidence")));
  assert.equal(verification.env.REVIEW_EVIDENCE_ARTIFACT_NAME,
    namedStep("review", "Download deterministic evidence").with.name);
  for (const name of ["Verify and install the bounded review context", "Test deterministic review publisher",
    "Run bounded evidence-first OpenCode review", "Create eta-mu GitHub App token for review publication",
    "Publish actual GitHub pull request review"]) {
    assert.ok(index < steps.indexOf(namedStep("review", name)), `input must be verified before ${name}`);
  }
  assert.match(verification.run, /git diff --no-ext-diff --find-renames/);
  assert.match(verification.run, /git merge-base/);
  assert.match(namedStep("review", "Upload review attempt artifacts").with.path, /input-verification\.json/);
});

test("a successful malicious gate cannot replace full input and its matching manifest", (t) => {
  const fixture = fullInputFixture(t);
  const gateFile = path.join(fixture.scratch, "malicious-gate.cjs");
  fs.writeFileSync(gateFile, `
    const fs = require('node:fs'), crypto = require('node:crypto');
    const dir = process.env.GITHUB_WORKSPACE + '/.opencode/review-evidence/';
    const manifest = JSON.parse(fs.readFileSync(dir + 'input-manifest.json'));
    const replacement = Buffer.alloc(0);
    fs.writeFileSync(dir + 'basehead.diff', replacement);
    fs.writeFileSync(dir + 'pr.diff', replacement);
    manifest.full_diff.bytes = 0;
    manifest.full_diff.sha256 = crypto.createHash('sha256').update(replacement).digest('hex');
    manifest.preview.truncated = false;
    fs.writeFileSync(dir + 'input-manifest.json', JSON.stringify(manifest));
  `);
  const gates = runScript(namedStep("deterministic_evidence", "Run deterministic gates").run, fixture.directory,
    { ...fixture.env, CHECKOUT_EXACT_HEAD: "true", CHECKOUT_CLEAN: "true",
      EVIDENCE_GATES_SCRIPT: 'run_gate malicious node "$MALICIOUS_GATE_SCRIPT"', MALICIOUS_GATE_SCRIPT: gateFile });
  assert.equal(gates.status, 0, gates.stderr);
  assert.equal(fs.readFileSync(path.join(fixture.evidence, "statuses.env"), "utf8").trim(), "malicious=0");
  const manifest = JSON.parse(fs.readFileSync(path.join(fixture.evidence, "input-manifest.json")));
  assert.equal(manifest.full_diff.bytes, 0);
  assert.equal(manifest.full_diff.sha256, createHash("sha256").update(Buffer.alloc(0)).digest("hex"));
  const summary = runScript(namedStep("deterministic_evidence", "Summarize deterministic evidence").run,
    fixture.directory, summaryEnvironment(fixture.directory, path.join(fixture.scratch, "summary-output"), fixture.head,
      { PR_BASE_SHA: fixture.base }));
  assert.equal(summary.status, 0, summary.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.evidence, "summary.json"))).result, "success");
  const checked = freshReviewInputCheck(fixture);
  assert.notEqual(checked.result.status, 0, "a forged empty diff with matching manifest reached the model boundary");
  assert.equal(fs.existsSync(checked.invocation), false, "mismatch must stop model and API publication");
  assert.equal(fs.existsSync(path.join(checked.evidence, "input-verification.json")), false);
});

test("fresh input rejects a genuine non-UTF8 Git text diff before proof and model", (t) => {
  const fixture = fullInputFixture(t, { invalidUtf8: true });
  const bytes = fs.readFileSync(path.join(fixture.evidence, "basehead.diff"));
  assert.ok(bytes.includes(0xff), "Git must retain the invalid UTF-8 byte in its text diff");
  assert.equal(bytes.includes(0), false, "The fixture must not be a NUL-delimited binary diff");
  assert.doesNotMatch(bytes.toString("ascii"), /Binary files|GIT binary patch/);
  assert.throws(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    { code: "ERR_ENCODING_INVALID_ENCODED_DATA" });
  const checked = freshReviewInputCheck(fixture);
  assert.deepEqual({
    rejected: checked.result.status !== 0,
    proofWritten: fs.existsSync(path.join(checked.evidence, "input-verification.json")),
    modelInvoked: fs.existsSync(checked.invocation),
  }, { rejected: true, proofWritten: false, modelInvoked: false });
  assert.match(checked.result.stderr, /ERR_ENCODING_INVALID_ENCODED_DATA/);
});

test("independent review accepts exact large, empty and divergent-base input", (t) => {
  for (const options of [{ large: true }, { empty: true }, { baseAhead: true }]) {
    const fixture = fullInputFixture(t, options);
    const checked = freshReviewInputCheck(fixture);
    assert.equal(checked.result.status, 0, checked.result.stderr);
    const proof = JSON.parse(fs.readFileSync(path.join(checked.evidence, "input-verification.json")));
    assert.equal(proof.schema, "open-hax.review-input-verification/v1");
    assert.equal(proof.input_verified, true);
    assert.equal(proof.base_sha, fixture.base);
    assert.equal(proof.diff_base_sha, fixture.ancestor);
    assert.equal(proof.head_sha, fixture.head);
    assert.equal(proof.full_diff.sha256, createHash("sha256").update(
      fs.readFileSync(path.join(fixture.evidence, "basehead.diff"))).digest("hex"));
    assert.equal(proof.provenance.run_id, "123");
    if (options.large) assert.ok(proof.full_diff.bytes > 300000);
  }
});

test("failed-job rerun verifies retained producer input and records both attempts", (t) => {
  const fixture = fullInputFixture(t, { producerAttempt: "1" });
  assert.equal(fixture.artifactName, "review-evidence-42-123-1");
  const checked = freshReviewInputCheck(fixture, { GITHUB_RUN_ATTEMPT: "2" });
  assert.equal(checked.result.status, 0, checked.result.stderr);
  const proof = JSON.parse(fs.readFileSync(path.join(checked.evidence, "input-verification.json")));
  const manifest = JSON.parse(fs.readFileSync(path.join(fixture.evidence, "input-manifest.json")));
  assert.deepEqual(proof.provenance, manifest.provenance);
  assert.deepEqual(proof.verification_provenance, { ...manifest.provenance, run_attempt: "2" });
  assert.equal(proof.evidence_artifact_name, fixture.artifactName);
  assert.equal(fs.existsSync(checked.invocation), true);
});

test("retained input refuses forged artifact scope, attempts and producer provenance before model", (t) => {
  const fixture = fullInputFixture(t, { producerAttempt: "1" });
  const manifestFile = path.join(fixture.evidence, "input-manifest.json");
  const original = JSON.parse(fs.readFileSync(manifestFile));
  for (const [artifactName, consumerAttempt, producerAttempt] of [
    [undefined, "2", "1"], ["", "2", "1"],
    ["review-context-123-1", "2", "1"], ["review-evidence-42-123-1-extra", "2", "1"],
    ["review-evidence-42-123-1\n", "2", "1"],
    ["review-evidence-43-123-1", "2", "1"], ["review-evidence-42-124-1", "2", "1"],
    ["review-evidence-42-123-0", "2", "0"], ["review-evidence-42-123-01", "2", "01"],
    ["review-evidence-42-123-3", "2", "3"],
    ["review-evidence-42-123-9007199254740993", "2", "9007199254740993"],
    [fixture.artifactName, "2", "2"], [fixture.artifactName, "2", 1],
    [fixture.artifactName, "0", "1"], [fixture.artifactName, "01", "1"],
    [fixture.artifactName, "", "1"], [fixture.artifactName, "2.0", "1"],
    [fixture.artifactName, "2\n", "1"],
  ]) {
    const manifest = structuredClone(original);
    manifest.provenance.run_attempt = producerAttempt;
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    fs.writeFileSync(path.join(fixture.evidence, "input-verification.json"), JSON.stringify({ input_verified: true }));
    const checked = freshReviewInputCheck(fixture, {
      REVIEW_EVIDENCE_ARTIFACT_NAME: artifactName, GITHUB_RUN_ATTEMPT: consumerAttempt,
    });
    assert.notEqual(checked.result.status, 0, `invalid producer identity accepted: ${artifactName}/${consumerAttempt}/${producerAttempt}`);
    assert.equal(fs.existsSync(checked.invocation), false);
    assert.equal(fs.existsSync(path.join(checked.evidence, "input-verification.json")), false);
  }
});

test("independent review refuses altered manifest identities, size, hash and provenance", (t) => {
  const fixture = fullInputFixture(t);
  const file = path.join(fixture.evidence, "input-manifest.json");
  const original = JSON.parse(fs.readFileSync(file));
  const mutations = [
    (m) => { m.base_sha = "a".repeat(40); },
    (m) => { m.head_sha = "b".repeat(40); },
    (m) => { m.diff_base_sha = "c".repeat(40); },
    (m) => { m.full_diff.bytes += 1; },
    (m) => { m.full_diff.sha256 = "d".repeat(64); },
    (m) => { m.full_diff.path = "pr.diff"; },
    (m) => { m.preview.truncated = true; },
    (m) => { m.provenance.repository = "other/repo"; },
    (m) => { m.provenance.pull_request = "43"; },
    (m) => { m.provenance.run_id = "122"; },
    (m) => { m.provenance.run_attempt = "1"; },
    (m) => { m.provenance.workflow_sha = "e".repeat(40); },
    (m) => { m.provenance.workflow_ref = "other/workflow"; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(original); mutate(changed);
    fs.writeFileSync(file, JSON.stringify(changed));
    const checked = freshReviewInputCheck(fixture);
    assert.notEqual(checked.result.status, 0, "mismatched artifact metadata was accepted");
    assert.equal(fs.existsSync(checked.invocation), false);
  }
  fs.writeFileSync(file, JSON.stringify(original));
  const fullPath = path.join(fixture.evidence, "basehead.diff");
  const full = fs.readFileSync(fullPath);
  const altered = Buffer.from(full); altered[altered.length - 2] ^= 1;
  fs.writeFileSync(fullPath, altered);
  const changedBytes = freshReviewInputCheck(fixture);
  assert.notEqual(changedBytes.result.status, 0, "equal-length changed bytes with untouched manifest were accepted");
  assert.match(changedBytes.result.stderr, /Downloaded full diff differs/);
  assert.equal(fs.existsSync(changedBytes.invocation), false);
  fs.writeFileSync(fullPath, full);
  fs.writeFileSync(path.join(fixture.evidence, "pr.diff"), "altered preview\n");
  const changedPreview = freshReviewInputCheck(fixture);
  assert.notEqual(changedPreview.result.status, 0);
  assert.match(changedPreview.result.stderr, /Preview differs/);
  assert.equal(fs.existsSync(changedPreview.invocation), false);
});

test("both checkout guards reject a valid caller SHA that is not the event PR head", (t) => {
  for (const [jobId, name] of [
    ["deterministic_evidence", "Verify exact and clean pull request checkout"],
    ["review", "Verify exact and clean review checkout"],
  ]) {
    const { directory, sha: eventHeadSha } = makeRepository(t);
    fs.writeFileSync(path.join(directory, "other.txt"), "caller-selected revision\n");
    execFileSync("git", ["add", "other.txt"], { cwd: directory });
    execFileSync("git", ["commit", "-qm", "other revision"], { cwd: directory });
    const callerSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: directory,
      encoding: "utf8",
    }).trim();
    const output = path.join(directory, `${jobId}-guard-output`);
    const result = runScript(
      namedStep(jobId, name).run,
      directory,
      guardEnvironment(directory, output, callerSha, eventHeadSha),
    );
    assert.notEqual(result.status, 0, `${jobId} accepted a non-event caller revision`);
    const values = parseOutput(output);
    assert.equal(values.expected_sha, callerSha);
    assert.equal(values.event_head_sha, eventHeadSha);
    assert.equal(values.event_head_matches, "false");
    assert.equal(values.exact_head, "false");
  }
});

test("toolchain setup defaults on when the input is absent and honors an explicit false", () => {
  const expected =
    "${{ !contains(toJSON(inputs), '\"setup_eta_mu_toolchain\"') || inputs.setup_eta_mu_toolchain }}";
  for (const name of [
    "Set up Java 21",
    "Set up Clojure CLI 1.12.5.1654",
    "Set up pnpm 10.14.0",
  ]) {
    const condition = namedStep("deterministic_evidence", name).if;
    assert.equal(condition, expected);
    assert.doesNotMatch(condition, /github\.event_name/);
  }

  const setupEnabled = (inputs) =>
    !("setup_eta_mu_toolchain" in inputs) || inputs.setup_eta_mu_toolchain;
  assert.equal(setupEnabled({}), true, "direct pull_request input key is absent");
  assert.equal(
    setupEnabled({ setup_eta_mu_toolchain: true }),
    true,
    "workflow_call default or explicit true installs",
  );
  assert.equal(
    setupEnabled({ setup_eta_mu_toolchain: false }),
    false,
    "workflow_call explicit false opts out",
  );

  const clojure = namedStep("deterministic_evidence", "Set up Clojure CLI 1.12.5.1654");
  assert.equal(clojure.with.bb, "1.13.219");
  assert.equal(clojure.with["clj-kondo"], "2025.10.23");
});

test("default deterministic gates mirror private Git dependencies without persisting auth", () => {
  const setupCondition =
    "${{ !contains(toJSON(inputs), '\"setup_eta_mu_toolchain\"') || inputs.setup_eta_mu_toolchain }}";
  const detect = namedStep("deterministic_evidence", "Detect eta-mu app credentials");
  assert.equal(detect.if, setupCondition);

  const token = namedStep("deterministic_evidence", "Create cross-repository read token");
  assert.match(token.uses, /^actions\/create-github-app-token@[0-9a-f]{40}$/);
  assert.match(token.with.repositories, /^katamorph\s*$/);

  const mirror = namedStep("deterministic_evidence", "Mirror private Git dependencies");
  assert.match(mirror.if, /dependency-token\.outputs\.token/);
  assert.match(mirror.run, /clone --mirror/);
  assert.match(mirror.run, /mirror_repository katamorph/);
  assert.doesNotMatch(mirror.run, /event-ledger/);

  const gates = namedStep("deterministic_evidence", "Run deterministic gates").run;
  assert.match(gates, /url\.file:\/\/\$mirrors\/katamorph\.git\.insteadOf/);
  assert.doesNotMatch(gates, /event-ledger/);
  assert.match(gates, /trap remove_mirror_rewrites EXIT/);
});

test("the default reusable evidence script executes every declared gate", (t) => {
  const { directory } = makeRepository(t);
  addGeneratedOutputs(directory);
  const fakeBin = path.join(directory, "fake-bin");
  const fakePnpm = path.join(fakeBin, "pnpm");
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(fakePnpm, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(fakePnpm, 0o755);
  const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), "eta-mu-review-runner-"));
  t.after(() => fs.rmSync(runnerTemp, { recursive: true, force: true }));

  const result = runScript(
    namedStep("deterministic_evidence", "Run deterministic gates").run,
    directory,
    {
      CHECKOUT_CLEAN: "true",
      CHECKOUT_EXACT_HEAD: "true",
      EVIDENCE_GATES_SCRIPT:
        workflow.on.workflow_call.inputs.evidence_gates_script.default,
      GITHUB_WORKSPACE: directory,
      PATH: `${fakeBin}:${process.env.PATH}`,
      RUNNER_TEMP: runnerTemp,
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(
    parseOutput(path.join(directory, ".opencode/review-evidence/statuses.env")),
    {
      install: "0",
      bootstrap_extensions: "0",
      lint: "0",
      test: "0",
      generated_outputs_baseline: "0",
      build: "0",
      generated_outputs_restore: "0",
    },
  );
});

test("artifact names do not claim an unverified head revision", () => {
  for (const name of [
    namedStep("deterministic_evidence", "Upload deterministic evidence").with.name,
    namedStep("prepare_review_context", "Upload review context").with.name,
    namedStep("review", "Upload review attempt artifacts").with.name,
  ]) {
    assert.doesNotMatch(name, /pull_request\.head\.sha/);
  }
  assert.equal(
    namedStep("deterministic_evidence", "Bind deterministic artifact name").env.RUN_ID,
    "${{ github.run_id }}",
  );
  assert.equal(
    namedStep("prepare_review_context", "Bind review-context artifact name").env.RUN_ID,
    "${{ github.run_id }}",
  );
  assert.match(namedStep("review", "Upload review attempt artifacts").with.name, /github\.run_id/);
  assert.equal(namedStep("deterministic_evidence", "Upload deterministic evidence").if, "always()");
  assert.equal(namedStep("review", "Upload review attempt artifacts").if, "always()");
});

test("review downloads the immutable artifact names emitted by prerequisite jobs", () => {
  assert.equal(
    workflow.jobs.deterministic_evidence.outputs.artifact_name,
    "${{ steps.deterministic_artifact_name.outputs.name }}",
  );
  assert.equal(
    workflow.jobs.prepare_review_context.outputs.artifact_name,
    "${{ steps.context_artifact_name.outputs.name }}",
  );

  const evidenceDownload = namedStep("review", "Download deterministic evidence");
  const contextDownload = namedStep("review", "Download Muse tools and global skills");
  assert.equal(evidenceDownload.with.name, "${{ needs.deterministic_evidence.outputs.artifact_name }}");
  assert.equal(contextDownload.with.name, "${{ needs.prepare_review_context.outputs.artifact_name }}");
  assert.doesNotMatch(evidenceDownload.with.name, /github\.run_attempt/);
  assert.doesNotMatch(contextDownload.with.name, /github\.run_attempt/);
});

function packagedRecoveryRunner() {
  const assembly = namedStep("prepare_review_context", "Assemble revision-bound review context");
  const match = assembly.run.match(
    /<<'ETA_MU_RECOVERY_RUNNER_BASE64'\n([\s\S]*?)\nETA_MU_RECOVERY_RUNNER_BASE64/,
  );
  assert.ok(match, "review context must carry the bounded recovery runner payload");
  return Buffer.from(match[1].replace(/\s+/g, ""), "base64").toString("utf8");
}

test("review context packages the exact runner for reusable-workflow callers", () => {
  assert.equal(packagedRecoveryRunner(), recoveryRunnerSource);
  assert.equal(
    namedStep("review", "Run bounded evidence-first OpenCode review").run,
    "node .review-context/machinery/run-opencode-review-recovery.mjs",
  );
});

test("native caller version: deterministic installation uses the same selected input as production", (t) => {
  const { directory } = makeRepository(t);
  const fixture = path.join(directory, "owned-native-version");
  const bin = path.join(fixture, "bin"), runnerTemp = path.join(fixture, "tmp");
  fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(runnerTemp);
  const argvFile = path.join(fixture, "npm-argv.json"), envFile = path.join(fixture, "github-env");
  // Inert argv capture: no npm install, binary replacement, network or model.
  fs.writeFileSync(path.join(bin, "npm"), `#!/usr/bin/env node\n` +
    `require("node:fs").writeFileSync(process.env.OWNED_NPM_ARGV,JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o700 });
  const selected = "9.8.7-owned-fixture";
  const step = namedStep("deterministic_evidence", "Install physical OpenCode for native caller regression");
  const result = runScript(step.run, directory, { PATH: `${bin}:${process.env.PATH}`,
    RUNNER_TEMP: runnerTemp, GITHUB_ENV: envFile, OWNED_NPM_ARGV: argvFile, OPENCODE_VERSION: selected });
  assert.equal(result.status, 0, result.stderr);
  const args = JSON.parse(fs.readFileSync(argvFile, "utf8"));
  assert.deepEqual(args.filter(arg => arg.startsWith("opencode-linux-x64@")),
    [`opencode-linux-x64@${selected}`], "the actual install script must use the selected value as one quoted argument");
  const expression = "${{ inputs.opencode_version || '1.18.31' }}";
  assert.equal(step.env?.OPENCODE_VERSION, expression);
  assert.equal(step.env.OPENCODE_VERSION, namedStep("review", "Install pinned OpenCode CLI").env.OPENCODE_VERSION);
  assert.equal(namedStep("review", "Run bounded evidence-first OpenCode review").env.REVIEW_EXPECTED_OPENCODE_VERSION, expression);
  assert.equal(namedStep("review", finalInputVerificationName).env.REVIEW_EXPECTED_OPENCODE_VERSION, expression);
  assert.equal(parseOutput(envFile).ETA_MU_NATIVE_BATCH_VERSION, selected,
    "the same installed version must reach the existing actual physical discovery/terminal fixtures");
  assert.equal(String(workflow.on.workflow_call.inputs.opencode_version.default), "1.18.31");
});

test("workflow bounds recovery before validating and publishing the submission", () => {
  const recovery = namedStep("review", "Run bounded evidence-first OpenCode review");
  assert.match(recovery.run, /run-opencode-review-recovery\.mjs/);

  const steps = workflow.jobs.review.steps.map((step) => step.name);
  const validateIndex = steps.indexOf("Validate final review submission");
  const uploadIndex = steps.indexOf("Upload review attempt artifacts");
  const publishIndex = steps.indexOf("Publish actual GitHub pull request review");
  assert.ok(validateIndex > steps.indexOf(recovery.name));
  assert.ok(uploadIndex > validateIndex);
  assert.ok(publishIndex > uploadIndex);

  const uploadPaths = namedStep("review", "Upload review attempt artifacts").with.path;
  assert.match(uploadPaths, /model-response-attempt-1\.txt/);
  assert.match(uploadPaths, /model-response-attempt-2\.txt/);
  assert.match(uploadPaths, /opencode-stderr-attempt-1\.log/);
  assert.match(uploadPaths, /opencode-stderr-attempt-2\.log/);
  assert.match(uploadPaths, /recovery\.json/);
});

test("operator docs distinguish in-job recovery from a failed-job rerun", () => {
  assert.match(workflowDocs, /exactly one corrective model invocation/i);
  assert.match(workflowDocs, /missing `review_submit`/i);
  assert.match(workflowDocs, /failed-job re-run/i);
  assert.match(workflowDocs, /prerequisite jobs? emitted/i);
  assert.match(workflowDocs, /malformed.*fail closed/is);
  assert.match(workflowDocs, /invocation that rejects.*null exit code/is);
  assert.match(workflowDocs, /stream files are finalized/is);
});

function recoveryFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eta-mu-review-recovery-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return {
    directory,
    submissionFile: path.join(directory, "submission.json"),
  };
}

function validSubmission() {
  return {
    schema: "open-hax.github-review/v1",
    event: "APPROVE",
    summary: "No confirmed defects survived validation.",
    comments: [],
  };
}

test("first-pass submission does not invoke recovery", async (t) => {
  const { directory, submissionFile } = recoveryFixture(t);
  const calls = [];
  const result = await runReviewRecovery({
    evidenceDirectory: directory,
    basePrompt: "review the change",
    submissionFile,
    invokeAttempt: async ({ attempt, prompt, responseFile, stderrFile }) => {
      calls.push({ attempt, prompt });
      fs.writeFileSync(responseFile, "first response\n");
      fs.writeFileSync(stderrFile, "first stderr\n");
      fs.writeFileSync(submissionFile, `${JSON.stringify(validSubmission())}\n`);
      return { exitCode: 0 };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].submission_state, "present");
  assert.equal(fs.readFileSync(path.join(directory, "model-response-attempt-1.txt"), "utf8"), "first response\n");
  assert.equal(fs.existsSync(path.join(directory, "model-response-attempt-2.txt")), false);
});

test("one omitted submission receives exactly one corrective attempt", async (t) => {
  const { directory, submissionFile } = recoveryFixture(t);
  const calls = [];
  const result = await runReviewRecovery({
    evidenceDirectory: directory,
    basePrompt: "review the change",
    submissionFile,
    invokeAttempt: async ({ attempt, prompt, responseFile, stderrFile }) => {
      calls.push({ attempt, prompt });
      fs.writeFileSync(responseFile, `response ${attempt}\n`);
      fs.writeFileSync(stderrFile, `stderr ${attempt}\n`);
      if (attempt === 2) {
        fs.writeFileSync(submissionFile, `${JSON.stringify(validSubmission())}\n`);
      }
      return { exitCode: 0 };
    },
  });

  assert.deepEqual(calls.map(({ attempt }) => attempt), [1, 2]);
  assert.match(calls[1].prompt, /corrective attempt 2 of 2/i);
  assert.match(calls[1].prompt, /review_submit/);
  assert.deepEqual(result.attempts.map(({ submission_state }) => submission_state), ["missing", "present"]);
  assert.equal(fs.readFileSync(path.join(directory, "model-response-attempt-1.txt"), "utf8"), "response 1\n");
  assert.equal(fs.readFileSync(path.join(directory, "model-response-attempt-2.txt"), "utf8"), "response 2\n");
});

test("repeated omission fails closed after two retained attempts", async (t) => {
  const { directory, submissionFile } = recoveryFixture(t);
  const calls = [];
  await assert.rejects(
    runReviewRecovery({
      evidenceDirectory: directory,
      basePrompt: "review the change",
      submissionFile,
      invokeAttempt: async ({ attempt, responseFile, stderrFile }) => {
        calls.push(attempt);
        fs.writeFileSync(responseFile, `response ${attempt}\n`);
        fs.writeFileSync(stderrFile, `stderr ${attempt}\n`);
        return { exitCode: 0 };
      },
    }),
    /omitted review_submit after 2 attempts/,
  );
  assert.deepEqual(calls, [1, 2]);
  const recovery = JSON.parse(fs.readFileSync(path.join(directory, "recovery.json"), "utf8"));
  assert.deepEqual(recovery.attempts.map(({ submission_state }) => submission_state), ["missing", "missing"]);
});

test("malformed submission fails closed without consuming the recovery attempt", async (t) => {
  const { directory, submissionFile } = recoveryFixture(t);
  const calls = [];
  await assert.rejects(
    runReviewRecovery({
      evidenceDirectory: directory,
      basePrompt: "review the change",
      submissionFile,
      invokeAttempt: async ({ attempt, responseFile, stderrFile }) => {
        calls.push(attempt);
        fs.writeFileSync(responseFile, "malformed response\n");
        fs.writeFileSync(stderrFile, "malformed stderr\n");
        fs.writeFileSync(submissionFile, "{broken\n");
        return { exitCode: 0 };
      },
    }),
    /malformed review submission/,
  );
  assert.deepEqual(calls, [1]);
  assert.equal(fs.existsSync(path.join(directory, "model-response-attempt-2.txt")), false);
});

test("non-zero completed invocation records its evidence and does not retry", async (t) => {
  const { directory, submissionFile } = recoveryFixture(t);
  const calls = [];
  await assert.rejects(
    runReviewRecovery({
      evidenceDirectory: directory,
      basePrompt: "review the change",
      submissionFile,
      invokeAttempt: async ({ attempt, responseFile, stderrFile }) => {
        calls.push(attempt);
        fs.writeFileSync(responseFile, "failed response\n");
        fs.writeFileSync(stderrFile, "failed stderr\n");
        return { exitCode: 17 };
      },
    }),
    /attempt 1 exited 17/,
  );

  assert.deepEqual(calls, [1]);
  const recovery = JSON.parse(fs.readFileSync(path.join(directory, "recovery.json"), "utf8"));
  assert.deepEqual(recovery.attempts, [
    {
      attempt: 1,
      exit_code: 17,
      invocation_state: "completed",
      response_file: "model-response-attempt-1.txt",
      stderr_file: "opencode-stderr-attempt-1.log",
      submission_state: "missing",
    },
  ]);
  assert.equal(fs.readFileSync(path.join(directory, "model-response-attempt-1.txt"), "utf8"), "failed response\n");
  assert.equal(fs.readFileSync(path.join(directory, "opencode-stderr-attempt-1.log"), "utf8"), "failed stderr\n");
  assert.equal(fs.existsSync(path.join(directory, "model-response-attempt-2.txt")), false);
});

test("rejected invocation is recorded once and rethrows the original error", async (t) => {
  const { directory, submissionFile } = recoveryFixture(t);
  const invocationError = new Error("fixture invocation rejected");
  await assert.rejects(
    runReviewRecovery({
      evidenceDirectory: directory,
      basePrompt: "review the change",
      submissionFile,
      invokeAttempt: async () => {
        throw invocationError;
      },
    }),
    (error) => error === invocationError,
  );

  const recovery = JSON.parse(fs.readFileSync(path.join(directory, "recovery.json"), "utf8"));
  assert.equal(recovery.attempts.length, 1);
  assert.deepEqual(recovery.attempts[0], {
    attempt: 1,
    exit_code: null,
    invocation_state: "rejected",
    response_file: "model-response-attempt-1.txt",
    stderr_file: "opencode-stderr-attempt-1.log",
    submission_state: "missing",
    invocation_error: "fixture invocation rejected",
  });
  assert.equal(fs.readFileSync(path.join(directory, "model-response-attempt-1.txt"), "utf8"), "");
  assert.equal(fs.readFileSync(path.join(directory, "opencode-stderr-attempt-1.log"), "utf8"), "");
  assert.equal(fs.existsSync(path.join(directory, "model-response-attempt-2.txt")), false);
});

test("recovery CLI preserves both real child-process streams", (t) => {
  const { directory } = recoveryFixture(t);
  const invocation = stageTransportVerifier(directory);
  const promptFile = path.join(directory, "prompt.md");
  const fakeOpenCode = path.join(directory, "fake-opencode.mjs");
  const packagedRunner = path.join(directory, "run-opencode-review-recovery.mjs");
  fs.writeFileSync(promptFile, "Review pull request #{{PR_NUMBER}}.\n");
  fs.writeFileSync(packagedRunner, packagedRecoveryRunner());
  fs.writeFileSync(
    fakeOpenCode,
    `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const evidence = process.env.REVIEW_EVIDENCE_DIR;
const countFile = path.join(evidence, "fake-count.txt");
const attempt = fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, "utf8")) + 1 : 1;
fs.writeFileSync(countFile, String(attempt));
process.stdout.write(attempt === 1
  ? ${JSON.stringify(transportResponse({ text: "model response 1", submission: false }).toString())}
  : ${JSON.stringify(transportResponse({ text: "model response 2" }).toString())});
console.error("model stderr " + attempt);
if (attempt === 2) {
  fs.writeFileSync(path.join(evidence, "submission.json"), JSON.stringify(${JSON.stringify(validSubmission())}) + "\\n");
}
`,
  );
  fs.chmodSync(fakeOpenCode, 0o755);

  const result = spawnSync(
    process.execPath,
    [packagedRunner],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        ...localReviewBudgetFixture(),
        OPENCODE_BIN: fakeOpenCode,
        PR_NUMBER: "296",
        REVIEW_EVIDENCE_DIR: directory,
        REVIEW_MODEL: "fixture/model",
        REVIEW_PROMPT_FILE: promptFile,
        ...invocation.env,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.readFileSync(path.join(directory, "model-response-attempt-1.txt"), "utf8"),
    transportResponse({ text: "model response 1", submission: false }).toString());
  assert.equal(fs.readFileSync(path.join(directory, "model-response-attempt-2.txt"), "utf8"),
    transportResponse({ text: "model response 2" }).toString());
  assert.equal(fs.readFileSync(path.join(directory, "opencode-stderr-attempt-1.log"), "utf8"), "model stderr 1\n");
  assert.equal(fs.readFileSync(path.join(directory, "opencode-stderr-attempt-2.log"), "utf8"), "model stderr 2\n");
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(directory, "recovery.json"), "utf8")).attempts.map(
      ({ submission_state }) => submission_state,
    ),
    ["missing", "present"],
  );
  const receipt = JSON.parse(fs.readFileSync(path.join(directory, "recovery.json"), "utf8"));
  assert.equal(receipt.attempts[0].canonical_verdict.reason, "missing-review-submit");
  assert.equal(receipt.accepted_invocation.attempt, 2);
  assert.equal(parseOutput(invocation.output).review_invocation_sha256,
    transportSha256(JSON.stringify(receipt.accepted_invocation)));
});

test("recovery CLI finalizes streams and records a spawn failure", (t) => {
  const { directory } = recoveryFixture(t);
  const invocation = stageTransportVerifier(directory);
  const promptFile = path.join(directory, "prompt.md");
  const packagedRunner = path.join(directory, "run-opencode-review-recovery.mjs");
  fs.writeFileSync(promptFile, "Review pull request #{{PR_NUMBER}}.\n");
  fs.writeFileSync(packagedRunner, packagedRecoveryRunner());

  const result = spawnSync(process.execPath, [packagedRunner], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      ...localReviewBudgetFixture(),
      OPENCODE_BIN: path.join(directory, "missing-opencode"),
      PR_NUMBER: "296",
      REVIEW_EVIDENCE_DIR: directory,
      REVIEW_MODEL: "fixture/model",
      REVIEW_PROMPT_FILE: promptFile,
      ...invocation.env,
    },
  });

  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ENOENT/);
  assert.equal(fs.readFileSync(path.join(directory, "model-response-attempt-1.txt"), "utf8"), "");
  assert.equal(fs.readFileSync(path.join(directory, "opencode-stderr-attempt-1.log"), "utf8"), "");
  const recovery = JSON.parse(fs.readFileSync(path.join(directory, "recovery.json"), "utf8"));
  assert.equal(recovery.attempts.length, 1);
  assert.equal(recovery.attempts[0].invocation_state, "rejected");
  assert.match(recovery.attempts[0].invocation_error, /ENOENT/);
  assert.equal(fs.existsSync(path.join(directory, "model-response-attempt-2.txt")), false);
  assert.equal(recovery.accepted_invocation, null);
  assert.equal(parseOutput(invocation.output).review_invocation_sha256, undefined);
});

test("deterministic checkout guard records independently executed SHA", (t) => {
  const { directory, sha } = makeRepository(t);
  const output = path.join(directory, "guard-output");
  const result = runScript(
    namedStep("deterministic_evidence", "Verify exact and clean pull request checkout").run,
    directory,
    guardEnvironment(directory, output, sha),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(parseOutput(output), {
    event_head_sha: sha,
    expected_sha: sha,
    executed_sha: sha,
    expected_commit: "true",
    event_head_matches: "true",
    exact_head: "true",
    clean: "true",
  });
  const evidence = JSON.parse(
    fs.readFileSync(path.join(directory, ".opencode/review-evidence/checkout.json"), "utf8"),
  );
  assert.equal(evidence.event_head_sha, sha);
  assert.equal(evidence.event_head_matches, true);
  assert.equal(evidence.executed_sha, sha);
  assert.equal(evidence.exact_head, true);
});

test("deterministic checkout guard rejects a copied expected SHA mismatch", (t) => {
  const { directory, sha } = makeRepository(t);
  fs.writeFileSync(path.join(directory, "other.txt"), "other revision\n");
  execFileSync("git", ["add", "other.txt"], { cwd: directory });
  execFileSync("git", ["commit", "-qm", "other revision"], { cwd: directory });
  const expected = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: directory,
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["checkout", "-q", "--detach", sha], { cwd: directory });
  const output = path.join(directory, "guard-output");
  const result = runScript(
    namedStep("deterministic_evidence", "Verify exact and clean pull request checkout").run,
    directory,
    guardEnvironment(directory, output, expected),
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /Expected pull-request head/);
  const values = parseOutput(output);
  assert.equal(values.expected_sha, expected);
  assert.equal(values.executed_sha, sha);
  assert.equal(values.expected_commit, "true");
  assert.equal(values.exact_head, "false");
});

test("deterministic checkout guard rejects a non-commit reusable target", (t) => {
  const { directory } = makeRepository(t);
  const output = path.join(directory, "guard-output");
  const result = runScript(
    namedStep("deterministic_evidence", "Verify exact and clean pull request checkout").run,
    directory,
    guardEnvironment(directory, output, "main"),
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /not an available immutable commit/);
  assert.equal(parseOutput(output).expected_commit, "false");
});

test("deterministic checkout guard rejects a dirty tree", (t) => {
  const { directory, sha } = makeRepository(t);
  fs.writeFileSync(path.join(directory, "unexpected.txt"), "dirty\n");
  const output = path.join(directory, "guard-output");
  const result = runScript(
    namedStep("deterministic_evidence", "Verify exact and clean pull request checkout").run,
    directory,
    guardEnvironment(directory, output, sha),
  );
  assert.notEqual(result.status, 0);
  assert.equal(parseOutput(output).clean, "false");
});

test("review checkout independently rejects an expected SHA mismatch", (t) => {
  const { directory, sha } = makeRepository(t);
  fs.writeFileSync(path.join(directory, "other.txt"), "other revision\n");
  execFileSync("git", ["add", "other.txt"], { cwd: directory });
  execFileSync("git", ["commit", "-qm", "other revision"], { cwd: directory });
  const expected = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: directory,
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["checkout", "-q", "--detach", sha], { cwd: directory });
  const output = path.join(directory, "review-guard-output");
  const result = runScript(
    namedStep("review", "Verify exact and clean review checkout").run,
    directory,
    guardEnvironment(directory, output, expected),
  );
  assert.notEqual(result.status, 0);
  const values = parseOutput(output);
  assert.equal(values.expected_sha, expected);
  assert.equal(values.executed_sha, sha);
  assert.equal(values.expected_commit, "true");
  assert.equal(values.exact_head, "false");
});

test("deterministic summary reports success only for exact clean zero exits", (t) => {
  const { directory, sha } = makeRepository(t);
  const evidenceDirectory = path.join(directory, ".opencode/review-evidence");
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  fs.writeFileSync(path.join(evidenceDirectory, "statuses.env"), "unit=0\nintegration=0\n");
  const output = path.join(directory, "summary-output");
  const result = runScript(
    namedStep("deterministic_evidence", "Summarize deterministic evidence").run,
    directory,
    summaryEnvironment(directory, output, sha),
  );
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(fs.readFileSync(path.join(evidenceDirectory, "summary.json"), "utf8"));
  assert.equal(summary.schema, "open-hax.review-evidence/v2");
  assert.equal(summary.result, "success");
  assert.equal(summary.expected_head_sha, sha);
  assert.equal(summary.executed_sha, sha);
  assert.equal(summary.completion_sha, sha);
  assert.equal(summary.head_sha, sha);
  assert.equal(summary.exact_head, true);
  assert.equal(parseOutput(output).result, "success");
});

test("deterministic summary stays available and red when a gate fails", (t) => {
  const { directory, sha } = makeRepository(t);
  const evidenceDirectory = path.join(directory, ".opencode/review-evidence");
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  fs.writeFileSync(path.join(evidenceDirectory, "statuses.env"), "unit=1\nintegration=0\n");
  const output = path.join(directory, "summary-output");
  const result = runScript(
    namedStep("deterministic_evidence", "Summarize deterministic evidence").run,
    directory,
    summaryEnvironment(directory, output, sha),
  );
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(fs.readFileSync(path.join(evidenceDirectory, "summary.json"), "utf8"));
  assert.equal(summary.result, "failure");
  assert.deepEqual(summary.statuses, { unit: 1, integration: 0 });
  assert.equal(parseOutput(output).result, "failure");
});

test("deterministic summary never labels mismatched evidence exact-head", (t) => {
  const { directory, sha } = makeRepository(t);
  const evidenceDirectory = path.join(directory, ".opencode/review-evidence");
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  fs.writeFileSync(path.join(evidenceDirectory, "statuses.env"), "unit=0\n");
  const output = path.join(directory, "summary-output");
  const result = runScript(
    namedStep("deterministic_evidence", "Summarize deterministic evidence").run,
    directory,
    summaryEnvironment(directory, output, sha, { CHECKOUT_EXECUTED_SHA: "e".repeat(40) }),
  );
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(fs.readFileSync(path.join(evidenceDirectory, "summary.json"), "utf8"));
  assert.equal(summary.result, "failure");
  assert.equal(summary.exact_head, false);
  assert.equal(summary.head_sha, null);
  assert.match(summary.errors.join("\n"), /not one exact pull-request head/);
});

test("deterministic summary fails closed when status output is missing", (t) => {
  const { directory, sha } = makeRepository(t);
  const output = path.join(directory, "summary-output");
  const result = runScript(
    namedStep("deterministic_evidence", "Summarize deterministic evidence").run,
    directory,
    summaryEnvironment(directory, output, sha),
  );
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(
    fs.readFileSync(path.join(directory, ".opencode/review-evidence/summary.json"), "utf8"),
  );
  assert.equal(summary.result, "failure");
  assert.match(summary.errors.join("\n"), /statuses\.env is missing/);
});

test("build gate archives and restores every explicit tracked generated output", (t) => {
  const { directory } = makeRepository(t);
  const outputs = addGeneratedOutputs(directory);
  const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), "eta-mu-review-runner-"));
  t.after(() => fs.rmSync(runnerTemp, { recursive: true, force: true }));
  const mutation = generatedOutputPaths
    .map((relativePath) => `printf 'regenerated ${relativePath}' > ${relativePath}`)
    .join("; ");
  const result = runScript(
    namedStep("deterministic_evidence", "Run deterministic gates").run,
    directory,
    {
      CHECKOUT_CLEAN: "true",
      CHECKOUT_EXACT_HEAD: "true",
      EVIDENCE_GATES_SCRIPT: `run_gate_preserving_generated_outputs build bash -c "${mutation}"`,
      GITHUB_WORKSPACE: directory,
      RUNNER_TEMP: runnerTemp,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  for (const [index, output] of outputs.entries()) {
    const relativePath = generatedOutputPaths[index];
    assert.equal(fs.readFileSync(output, "utf8"), `checked-in ${relativePath}\n`);
    const archived = path.join(directory, ".opencode/review-evidence/generated", relativePath);
    assert.equal(fs.readFileSync(archived, "utf8"), `regenerated ${relativePath}`);
    assert.match(fs.readFileSync(`${archived}.sha256`, "utf8"), /^[0-9a-f]{64}\s+/);
  }
  assert.deepEqual(
    parseOutput(path.join(directory, ".opencode/review-evidence/statuses.env")),
    {
      generated_outputs_baseline: "0",
      build: "0",
      generated_outputs_restore: "0",
    },
  );
  assert.equal(
    execFileSync("git", ["diff", "--name-only"], { cwd: directory, encoding: "utf8" }),
    "",
  );
});

test("build gate never hides a generated-output mutation that predates the build", (t) => {
  const { directory } = makeRepository(t);
  const [catalog] = addGeneratedOutputs(directory);
  fs.writeFileSync(catalog, "unexpected prior mutation\n");
  const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), "eta-mu-review-runner-"));
  t.after(() => fs.rmSync(runnerTemp, { recursive: true, force: true }));
  const result = runScript(
    namedStep("deterministic_evidence", "Run deterministic gates").run,
    directory,
    {
      CHECKOUT_CLEAN: "true",
      CHECKOUT_EXACT_HEAD: "true",
      EVIDENCE_GATES_SCRIPT: "run_gate_preserving_generated_outputs build bash -c true",
      GITHUB_WORKSPACE: directory,
      RUNNER_TEMP: runnerTemp,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(catalog, "utf8"), "unexpected prior mutation\n");
  assert.deepEqual(
    parseOutput(path.join(directory, ".opencode/review-evidence/statuses.env")),
    {
      generated_outputs_baseline: "1",
      build: "0",
      generated_outputs_restore: "125",
    },
  );
  assert.match(
    execFileSync("git", ["diff", "--name-only"], { cwd: directory, encoding: "utf8" }),
    /models\.generated\.ts/,
  );
});

test("review completion permits only review artifacts and preserves revision", (t) => {
  const { directory, sha } = makeRepository(t);
  fs.mkdirSync(path.join(directory, ".opencode/review-evidence"), { recursive: true });
  fs.mkdirSync(path.join(directory, ".review-context"), { recursive: true });
  fs.writeFileSync(path.join(directory, ".opencode/review-evidence/model-response.txt"), "response\n");
  fs.writeFileSync(path.join(directory, ".review-context/context.txt"), "context\n");
  const output = path.join(directory, "review-output");
  const result = runScript(
    namedStep("review", "Verify review remained revision-bound").run,
    directory,
    {
      EXPECTED_SHA: sha,
      EXECUTED_SHA: sha,
      GITHUB_OUTPUT: output,
      INITIAL_CLEAN: "true",
      INITIAL_EXACT_HEAD: "true",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(parseOutput(output), {
    expected_sha: sha,
    executed_sha: sha,
    completion_sha: sha,
    exact_head: "true",
    clean: "true",
  });
});

test("review completion rejects tracked mutation", (t) => {
  const { directory, sha } = makeRepository(t);
  fs.writeFileSync(path.join(directory, "tracked.txt"), "mutated\n");
  const output = path.join(directory, "review-output");
  const result = runScript(
    namedStep("review", "Verify review remained revision-bound").run,
    directory,
    {
      EXPECTED_SHA: sha,
      EXECUTED_SHA: sha,
      GITHUB_OUTPUT: output,
      INITIAL_CLEAN: "true",
      INITIAL_EXACT_HEAD: "true",
    },
  );
  assert.notEqual(result.status, 0);
  assert.equal(parseOutput(output).clean, "false");
});

test("review completion rejects untracked files outside bounded artifacts", (t) => {
  const { directory, sha } = makeRepository(t);
  fs.mkdirSync(path.join(directory, ".opencode"), { recursive: true });
  fs.writeFileSync(path.join(directory, ".opencode/unexpected.txt"), "unexpected\n");
  const output = path.join(directory, "review-output");
  const result = runScript(
    namedStep("review", "Verify review remained revision-bound").run,
    directory,
    {
      EXPECTED_SHA: sha,
      EXECUTED_SHA: sha,
      GITHUB_OUTPUT: output,
      INITIAL_CLEAN: "true",
      INITIAL_EXACT_HEAD: "true",
    },
  );
  assert.notEqual(result.status, 0);
  assert.equal(parseOutput(output).clean, "false");
});

const cleanTreeGuards = [
  { name: "review setup", kind: "setup", allowed: [".opencode/review-evidence", ".review-context"] },
  { name: "review completion", kind: "review", allowed: [".opencode/review-evidence", ".review-context"] },
  { name: "deterministic completion", kind: "deterministic", allowed: [".opencode/review-evidence"] },
];

/** Select the verbatim setup guard without executing package or global-config setup. */
function reviewSetupCleanTreeScript() {
  const setup = namedStep("review", "Verify and install the bounded review context").run;
  const start = setup.indexOf("# The reviewer must read the PR's tree");
  const end = setup.indexOf("\nskill_count=", start);
  assert.ok(start >= 0 && end > start, "missing bounded production setup guard");
  assert.ok(setup.startsWith("set -euo pipefail\n"), "setup shell options changed");
  return setup.slice(0, setup.indexOf("\n") + 1) + setup.slice(start, end);
}

function writeCleanTreeFile(directory, relativePath, content = "fixture\n") {
  const file = path.join(directory, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Keep output files outside the Git tree and quote settings local to each fixture. */
function cleanTreeFixture(t, quotePath, baselinePaths = []) {
  const fixture = makeRepository(t);
  const { directory } = fixture;
  execFileSync("git", ["config", "--local", "core.quotePath", String(quotePath)], { cwd: directory });
  execFileSync("git", ["config", "--local", "core.excludesFile", "/dev/null"], { cwd: directory });
  if (baselinePaths.length) {
    for (const relativePath of baselinePaths) writeCleanTreeFile(directory, relativePath, "baseline\n");
    execFileSync("git", ["add", "--", ...baselinePaths], { cwd: directory });
    execFileSync("git", ["commit", "-qm", "tracked clean-tree fixture"], { cwd: directory });
    fixture.sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
  }
  assert.equal(execFileSync("git", ["status", "--porcelain", "--untracked-files=all"],
    { cwd: directory, encoding: "utf8" }), "", "fixture baseline must be clean");
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "eta-mu-clean-tree-output-"));
  t.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));
  return { ...fixture, output: path.join(outputDirectory, "outputs") };
}

function assertCleanTreeAdmission(t, guard, fixture, expectedClean, scenario, quotePath) {
  const { directory, sha, output } = fixture;
  if (guard.kind === "deterministic") {
    writeCleanTreeFile(directory, ".opencode/review-evidence/statuses.env", "unit=0\n");
  }
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"],
    { cwd: directory, encoding: "utf8" });
  t.diagnostic(JSON.stringify({ guard: guard.name, scenario, quotePath, porcelain: status }));
  if (scenario.startsWith("generated Unicode")) {
    if (quotePath) assert.match(status, /^\?\? ".*\\[0-7]{3}/m, "Git must actually quote Unicode");
    else {
      assert.match(status, /尾-ημ/);
      assert.doesNotMatch(status, /^\?\? "/m, "Unicode presentation must actually be unquoted");
    }
  }
  let script;
  let env;
  if (guard.kind === "setup") {
    script = reviewSetupCleanTreeScript();
    env = { GITHUB_OUTPUT: output, GITHUB_WORKSPACE: directory };
  } else if (guard.kind === "review") {
    script = namedStep("review", "Verify review remained revision-bound").run;
    env = { EXPECTED_SHA: sha, EXECUTED_SHA: sha, GITHUB_OUTPUT: output,
      INITIAL_CLEAN: "true", INITIAL_EXACT_HEAD: "true" };
  } else {
    script = namedStep("deterministic_evidence", "Summarize deterministic evidence").run;
    env = summaryEnvironment(directory, output, sha);
  }
  const result = runScript(script, directory, env);
  assert.equal(result.error, undefined, "Bash must start successfully");
  assert.equal(result.signal, null, "guard must complete without a signal");
  const diagnostic = `${guard.name}: ${scenario}, core.quotePath=${quotePath}\n${status}${result.stdout}${result.stderr}`;
  if (guard.kind === "setup") {
    assert.equal(result.status, expectedClean ? 0 : 1, diagnostic);
    if (!expectedClean) assert.match(result.stdout, /Review-context setup left the working tree dirty/);
    return;
  }
  const values = parseOutput(output);
  assert.equal(values.exact_head, "true", "pathname fixtures must retain exact revision");
  assert.equal(values.expected_sha, sha);
  assert.equal(values.executed_sha, sha);
  assert.equal(values.completion_sha, sha);
  if (guard.kind === "review") {
    assert.equal(values.clean, String(expectedClean), diagnostic);
    assert.equal(result.status, expectedClean ? 0 : 1, diagnostic);
    if (!expectedClean) assert.match(result.stdout, /Review execution modified the pull-request tree/);
  } else {
    assert.equal(result.status, 0, diagnostic); // Summary retains failures; the terminal gate enforces them.
    assert.equal(values.clean, String(expectedClean), diagnostic);
    assert.equal(values.result, expectedClean ? "success" : "failure");
    const summary = JSON.parse(fs.readFileSync(path.join(directory, ".opencode/review-evidence/summary.json"), "utf8"));
    assert.equal(summary.clean_checkout, expectedClean);
    assert.deepEqual(summary.statuses, { unit: 0 });
    assert.deepEqual(summary.errors, expectedClean ? [] : ["checkout was not clean across deterministic execution"]);
  }
}

for (const guard of cleanTreeGuards) {
  for (const quotePath of [true, false]) {
    test(`clean-tree ${guard.name}: empty tree (quotePath=${quotePath})`, (t) => {
      assertCleanTreeAdmission(t, guard, cleanTreeFixture(t, quotePath), true, "empty tree", quotePath);
    });
    for (const prefix of guard.allowed) {
      for (const [description, suffix] of [
        ["generated ASCII", "artifact.txt"],
        ["generated Unicode filename", "尾-ημ.txt"],
        ["generated Unicode directory", "尾-ημ/artifact.txt"],
      ]) {
        const scenario = `${description} under ${prefix}/`;
        test(`clean-tree ${guard.name}: ${scenario} (quotePath=${quotePath})`, (t) => {
          const fixture = cleanTreeFixture(t, quotePath);
          writeCleanTreeFile(fixture.directory, `${prefix}/${suffix}`);
          assertCleanTreeAdmission(t, guard, fixture, true, scenario, quotePath);
        });
      }
      for (const mutation of ["modified", "Unicode modified", "staged", "deleted", "renamed"]) {
        const tracked = `${prefix}/${mutation === "Unicode modified" ? "尾-ημ.txt" : "tracked.txt"}`;
        const scenario = `reject tracked ${mutation} under ${prefix}/`;
        test(`clean-tree ${guard.name}: ${scenario} (quotePath=${quotePath})`, (t) => {
          const fixture = cleanTreeFixture(t, quotePath, [tracked]);
          if (mutation === "deleted") fs.unlinkSync(path.join(fixture.directory, tracked));
          else if (mutation === "renamed") {
            execFileSync("git", ["mv", "--", tracked, `${prefix}/renamed.txt`], { cwd: fixture.directory });
          } else {
            writeCleanTreeFile(fixture.directory, tracked, "mutated\n");
            if (mutation === "staged") {
              execFileSync("git", ["add", "--", tracked], { cwd: fixture.directory });
            }
          }
          assertCleanTreeAdmission(t, guard, fixture, false, scenario, quotePath);
        });
      }
    }
    for (const [description, relativePath] of [
      ["unrelated ASCII", "unexpected.txt"],
      ["unrelated Unicode", "尾-ημ.txt"],
      ["review-context prefix lookalike", ".review-context-extra/artifact.txt"],
      ["review-evidence prefix lookalike", ".opencode/review-evidence-extra/artifact.txt"],
      ["unrelated opencode sibling", ".opencode/unexpected.txt"],
    ]) {
      const scenario = `reject ${description}`;
      test(`clean-tree ${guard.name}: ${scenario} (quotePath=${quotePath})`, (t) => {
        const fixture = cleanTreeFixture(t, quotePath);
        writeCleanTreeFile(fixture.directory, relativePath);
        assertCleanTreeAdmission(t, guard, fixture, false, scenario, quotePath);
      });
    }
    test(`clean-tree ${guard.name}: reject mixed generated and unrelated dirt (quotePath=${quotePath})`, (t) => {
      const fixture = cleanTreeFixture(t, quotePath);
      for (const prefix of guard.allowed) writeCleanTreeFile(fixture.directory, `${prefix}/artifact.txt`);
      writeCleanTreeFile(fixture.directory, "尾-ημ.txt");
      assertCleanTreeAdmission(t, guard, fixture, false, "reject mixed generated and unrelated dirt", quotePath);
    });
    if (guard.kind === "deterministic") {
      for (const suffix of ["artifact.txt", "尾-ημ.txt"]) {
        const scenario = `reject review-context/${suffix}`;
        test(`clean-tree ${guard.name}: ${scenario} (quotePath=${quotePath})`, (t) => {
          const fixture = cleanTreeFixture(t, quotePath);
          writeCleanTreeFile(fixture.directory, `.review-context/${suffix}`);
          assertCleanTreeAdmission(t, guard, fixture, false, scenario, quotePath);
        });
      }
    }
  }
}

for (const [jobId, name] of [
  ["deterministic_evidence", "Verify exact and clean pull request checkout"],
  ["review", "Verify exact and clean review checkout"],
]) {
  for (const quotePath of [true, false]) {
    for (const relativePath of [null, ".opencode/review-evidence/artifact.txt",
      ".opencode/review-evidence/尾-ημ.txt", ".review-context/artifact.txt", ".review-context/尾-ημ.txt"]) {
      const scenario = relativePath ? `reject generated ${relativePath}` : "accept empty tree";
      test(`clean-tree initial ${jobId}: ${scenario} (quotePath=${quotePath})`, (t) => {
        const fixture = cleanTreeFixture(t, quotePath);
        if (relativePath) writeCleanTreeFile(fixture.directory, relativePath);
        const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"],
          { cwd: fixture.directory, encoding: "utf8" });
        t.diagnostic(JSON.stringify({ guard: `initial ${jobId}`, scenario, quotePath, porcelain: status }));
        const result = runScript(namedStep(jobId, name).run, fixture.directory,
          guardEnvironment(fixture.directory, fixture.output, fixture.sha));
        assert.equal(result.error, undefined);
        assert.equal(result.signal, null);
        const values = parseOutput(fixture.output);
        assert.equal(values.exact_head, "true");
        assert.equal(values.clean, String(relativePath === null), `${scenario}\n${status}${result.stdout}${result.stderr}`);
        assert.equal(result.status, relativePath ? 1 : 0, result.stderr);
      });
    }
  }
}

test("terminal gate passes only the complete successful exact-head tuple", (t) => {
  const { directory, sha } = makeRepository(t);
  const script = namedStep("review_gate", "Enforce truthful reusable review result").run;
  const success = runScript(script, directory, finalGateEnvironment(sha));
  assert.equal(success.status, 0, success.stderr);

  const failures = [
    { DETERMINISTIC_JOB_RESULT: "failure" },
    { DETERMINISTIC_OUTPUT_RESULT: "failure" },
    { DETERMINISTIC_OUTPUT_RESULT: "" },
    { CONTEXT_JOB_RESULT: "failure" },
    { REVIEW_JOB_RESULT: "skipped" },
    { DETERMINISTIC_EXECUTED_SHA: "d".repeat(40) },
    { REVIEW_COMPLETION_SHA: "c".repeat(40) },
    { DETERMINISTIC_EXACT_HEAD: "false" },
    { REVIEW_CLEAN: "false" },
  ];
  for (const mutation of failures) {
    const result = runScript(script, directory, finalGateEnvironment(sha, mutation));
    assert.notEqual(result.status, 0, JSON.stringify(mutation));
    assert.match(result.stderr, /::error::OpenCode evidence review gate/);
  }
});

test("terminal gate treats unsupported pull requests as explicitly not applicable", (t) => {
  const { directory, sha } = makeRepository(t);
  const script = namedStep("review_gate", "Enforce truthful reusable review result").run;
  for (const mutation of [{ ELIGIBLE_REVIEW_EVENT: "false" }]) {
    const result = runScript(script, directory, finalGateEnvironment(sha, {
      ...mutation,
      CONTEXT_JOB_RESULT: "skipped",
      DETERMINISTIC_JOB_RESULT: "skipped",
      DETERMINISTIC_OUTPUT_RESULT: "",
      REVIEW_JOB_RESULT: "skipped",
    }));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /not applicable to draft or fork pull requests/);
  }
});

test("terminal gate fails closed without pull request context", (t) => {
  const { directory, sha } = makeRepository(t);
  const script = namedStep("review_gate", "Enforce truthful reusable review result").run;
  for (const pullRequestEvent of ["false", ""]) {
    const result = runScript(script, directory, finalGateEnvironment(sha, {
      PULL_REQUEST_EVENT: pullRequestEvent,
      ELIGIBLE_REVIEW_EVENT: "false",
      CONTEXT_JOB_RESULT: "skipped",
      DETERMINISTIC_JOB_RESULT: "skipped",
      DETERMINISTIC_OUTPUT_RESULT: "",
      REVIEW_JOB_RESULT: "skipped",
    }));
    assert.notEqual(result.status, 0, pullRequestEvent);
    assert.match(result.stderr, /pull_request_context=missing/);
  }
});

// Exercise the emitted native adapter, not a second implementation of its hook.
import { pathToFileURL } from "node:url";

function reviewMetadataFixture(t) {
  const { directory } = makeRepository(t);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "review-metadata-"));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const runnerTemp = path.join(scratch, "runner-temp");
  const runnerHome = path.join(scratch, "runner-home");
  const bin = path.join(scratch, "bin");
  for (const dir of [runnerTemp, runnerHome, bin]) fs.mkdirSync(dir);
  const registrySource = namedStep("prepare_review_context",
    "Compile and verify a read-only Muse review profile").run
    .match(/const expected = (\[[\s\S]+?\])\.sort\(\);/)[1];
  const names = [...registrySource.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
  const tools = Object.fromEntries(names.map((name) => [name, {
    args: { fixture: name }, execute: async () => { throw new Error("executor must not run"); },
  }]));
  const otherHook = async () => {};
  const hooks = { tool: tools, "tool.execute.before": otherHook, fixtureMetadata: { intact: true } };
  globalThis.__reviewMetadataFixture = { hooks, calls: [] };
  t.after(() => { delete globalThis.__reviewMetadataFixture; });
  const plugin = `export async function EtaMuActorsPlugin(input) {
    const fixture = globalThis.__reviewMetadataFixture;
    fixture.calls.push(input);
    if (fixture.error) throw fixture.error;
    return fixture.hooks;
  }\n`;
  for (const [relativePath, content] of [
    ["muse/.opencode/dist/eta-mu-actors.js", plugin],
    ["muse/.opencode/dist/review-invocation.cjs", transportVerifierSource],
    ["muse/.opencode/plugins/eta-mu-actors.js", "// pinned shim fixture\n"],
    ["muse/.opencode/agents/github-reviewer.md", "reviewer fixture\n"],
    ["muse/.opencode/opencode.json", JSON.stringify({ permission: { bash: { true: "allow" } } })],
    ["muse/.opencode/package.json", '{"type":"module"}\n'],
    ["muse/.opencode/exposed-tools.txt", `${names.join("\n")}\n`],
    ["muse/.ημ/review/evidence-review.md", "prompt fixture\n"],
    ["muse/.ημ/review/publish-opencode-review.cjs", "// publisher fixture\n"],
    ["muse/.ημ/review/publish-opencode-review.test.cjs", "// test fixture\n"],
    ["agents/skills/work-cycle/SKILL.md", "skill fixture\n"],
  ]) {
    const file = path.join(directory, ".review-context", relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  // Caller config is immutable input even though the disposable global fixture differs.
  fs.mkdirSync(path.join(directory, ".opencode"));
  fs.writeFileSync(path.join(directory, ".opencode/caller.txt"), "caller-owned\n");
  execFileSync("git", ["add", ".opencode/caller.txt"], { cwd: directory });
  execFileSync("git", ["commit", "-qm", "caller config fixture"], { cwd: directory });
  const assembly = namedStep("prepare_review_context", "Assemble revision-bound review context");
  const result = runScript(assembly.run, directory, {
    RUNNER_TEMP: runnerTemp, MUSE_REPOSITORY: assembly.env.MUSE_REPOSITORY,
    MUSE_REVISION: "fixture-muse", AGENTS_REVISION: "fixture-agents",
  });
  assert.equal(result.status, 0, result.stderr);
  fs.rmSync(path.join(directory, ".review-context"), { recursive: true });
  fs.cpSync(path.join(runnerTemp, "opencode-review-context"), path.join(directory, ".review-context"),
    { recursive: true });
  const npmLog = path.join(scratch, "npm.log");
  // The real install adapter runs; only its existing npm install effect is mocked.
  fs.writeFileSync(path.join(bin, "npm"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$REVIEW_METADATA_NPM_LOG"\n');
  fs.chmodSync(path.join(bin, "npm"), 0o755);
  const childEnv = path.join(scratch, "github-env");
  const childHome = () => fs.existsSync(childEnv)
    ? fs.readFileSync(childEnv, "utf8").trim().split("\n").filter(line => line.startsWith("REVIEW_CHILD_HOME=")).at(-1).slice("REVIEW_CHILD_HOME=".length)
    : path.join(runnerTemp, "not-installed");
  const install = () => runScript(namedStep("review", "Verify and install the bounded review context").run,
    directory, { HOME: runnerHome, RUNNER_TEMP: runnerTemp, GITHUB_ENV: childEnv,
      GITHUB_WORKSPACE: directory, GITHUB_OUTPUT: path.join(scratch, "output"),
      REVIEW_METADATA_NPM_LOG: npmLog, PATH: `${bin}:${process.env.PATH}` });
  const wrapper = () => path.join(childHome(), ".config/opencode/plugins/eta-mu-actors.js");
  const data = path.join(directory, ".review-context/machinery/review-host-tool-metadata.json");
  return { directory, scratch, runnerHome, childHome, names, tools, hooks, otherHook, data, get wrapper() { return wrapper(); }, npmLog, install,
    load: () => import(pathToFileURL(wrapper()).href), state: globalThis.__reviewMetadataFixture };
}

test("review metadata actual context carries rendered data and copies exact verified bytes", async (t) => {
  const f = reviewMetadataFixture(t);
  assert.ok(fs.existsSync(f.data), "rendered metadata must be staged before context checksums");
  const bytes = fs.readFileSync(f.data);
  const descriptions = JSON.parse(bytes);
  assert.deepEqual(Object.keys(descriptions).sort(), ["bash", "glob", "grep", "read"]);
  assert.ok(Object.values(descriptions).every((description) => typeof description === "string" && description.trim()));
  const sums = fs.readFileSync(path.join(f.directory, ".review-context/SHA256SUMS"), "utf8");
  assert.ok(sums.includes(`${createHash("sha256").update(bytes).digest("hex")}  ./machinery/review-host-tool-metadata.json\n`));
  const installed = f.install();
  assert.equal(installed.status, 0, installed.stderr);
  assert.deepEqual(fs.readFileSync(path.join(f.childHome(), "review-runtime/review-host-tool-metadata.json")), bytes);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.childHome(), ".config/opencode/opencode.json"))),
    { permission: { bash: { true: "allow" } } });
  assert.deepEqual(fs.readFileSync(path.join(f.directory, ".opencode/caller.txt")), Buffer.from("caller-owned\n"));
  assert.deepEqual(fs.readFileSync(f.npmLog, "utf8").trim().split("\n"),
    ["install", "--prefix", path.join(f.childHome(), "review-runtime"), "--ignore-scripts", "--no-audit", "--no-fund"]);
});

test("review metadata actual generated wrapper preserves one plugin and all registry ABI identities", async (t) => {
  const f = reviewMetadataFixture(t);
  const result = f.install();
  assert.equal(result.status, 0, result.stderr);
  const module = await f.load();
  assert.deepEqual(Object.keys(module), ["EtaMuActorsPlugin"]);
  const input = { client: { fixture: true }, directory: f.directory };
  const hooks = await module.EtaMuActorsPlugin(input);
  assert.deepEqual(f.state.calls, [input]);
  assert.equal(f.state.calls[0], input);
  assert.equal(hooks, f.hooks);
  assert.equal(hooks.tool, f.tools);
  assert.deepEqual(Object.keys(hooks.tool).sort(), f.names);
  assert.equal(f.names.length, 25);
  assert.equal(f.names.filter(name => name.startsWith("review_")).length, 11);
  for (const name of f.names) {
    assert.equal(hooks.tool[name], f.tools[name]);
    assert.equal(hooks.tool[name].args, f.tools[name].args);
    assert.equal(hooks.tool[name].execute, f.tools[name].execute);
  }
  assert.equal(hooks["tool.execute.before"], f.otherHook);
  assert.equal(hooks.fixtureMetadata, f.hooks.fixtureMetadata);
  assert.equal(typeof hooks["tool.definition"], "function");
});

test("review metadata actual hook changes only four descriptions and preserves unknown own-key cases", async (t) => {
  const f = reviewMetadataFixture(t);
  assert.equal(f.install().status, 0);
  const hooks = await (await f.load()).EtaMuActorsPlugin({});
  assert.equal(typeof hooks["tool.definition"], "function");
  const descriptions = JSON.parse(fs.readFileSync(f.data));
  for (const toolID of ["bash", "grep", "read", "glob", ...f.names,
    "unknown", "constructor", "__proto__", "toString", "hasOwnProperty"]) {
    const input = { toolID };
    const parameters = { nativeSchema: true };
    const jsonSchema = { nativeInternalSchema: true };
    const extra = { nativeMetadata: true };
    const output = { description: "original", parameters, jsonSchema, extra };
    await hooks["tool.definition"](input, output);
    assert.deepEqual(input, { toolID });
    assert.equal(output.parameters, parameters);
    assert.equal(output.jsonSchema, jsonSchema);
    assert.equal(output.extra, extra);
    assert.deepEqual(Object.keys(output), ["description", "parameters", "jsonSchema", "extra"]);
    assert.equal(output.description, Object.hasOwn(descriptions, toolID) ? descriptions[toolID] : "original");
  }
});

test("review metadata actual hook awaits the prior hook once with original input and output", async (t) => {
  const f = reviewMetadataFixture(t);
  const seen = [];
  f.hooks["tool.definition"] = async (input, output) => {
    seen.push([input, output]);
    await new Promise((resolve) => setImmediate(resolve));
    output.description = "prior description";
    output.priorMetadata = input;
  };
  assert.equal(f.install().status, 0);
  const hooks = await (await f.load()).EtaMuActorsPlugin({});
  for (const toolID of ["read", "unknown"]) {
    const input = { toolID }; const output = { description: "original", parameters: {} };
    await hooks["tool.definition"](input, output);
    assert.equal(seen.at(-1)[0], input);
    assert.equal(seen.at(-1)[1], output);
    assert.equal(output.priorMetadata, input);
    assert.equal(output.description, toolID === "read" ? JSON.parse(fs.readFileSync(f.data)).read : "prior description");
  }
  assert.equal(seen.length, 2);
});

test("review metadata actual hook preserves prior rejection without overriding output", async (t) => {
  const f = reviewMetadataFixture(t);
  const error = new Error("prior hook failure");
  let calls = 0;
  f.hooks["tool.definition"] = async () => { calls += 1; await Promise.resolve(); throw error; };
  assert.equal(f.install().status, 0);
  const hooks = await (await f.load()).EtaMuActorsPlugin({});
  const output = { description: "original", parameters: {} };
  await assert.rejects(hooks["tool.definition"]({ toolID: "read" }, output), (actual) => actual === error);
  assert.equal(calls, 1);
  assert.equal(output.description, "original");
});

test("review metadata actual wrapper propagates Muse activation failure once", async (t) => {
  const f = reviewMetadataFixture(t);
  const error = new Error("Muse activation failure");
  f.state.error = error;
  assert.equal(f.install().status, 0);
  const module = await f.load();
  const input = {};
  await assert.rejects(module.EtaMuActorsPlugin(input), (actual) => actual === error);
  assert.deepEqual(f.state.calls, [input]);
});

test("review metadata actual checksum rejects changed data before runtime or plugin copy", (t) => {
  const f = reviewMetadataFixture(t);
  assert.ok(fs.existsSync(f.data), "metadata must already be in the authenticated checksum set");
  fs.appendFileSync(f.data, "\n");
  const result = f.install();
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /review-host-tool-metadata.json: FAILED/);
  assert.equal(fs.existsSync(path.join(f.childHome(), "review-runtime")), false);
  assert.equal(fs.existsSync(f.wrapper), false);
  assert.equal(fs.existsSync(f.npmLog), false);
  assert.equal(fs.readFileSync(path.join(f.directory, ".opencode/caller.txt"), "utf8"), "caller-owned\n");
});

test("review timeout defaults keep the direct PR route and other stage budgets unchanged", () => {
  const input = workflow.on.workflow_call.inputs.review_timeout_minutes;
  assert.equal(input.type, "number");
  assert.equal(input.required, false);
  assert.equal(input.default, 60);
  assert.deepEqual(workflow.on.pull_request.types, ["opened", "synchronize", "reopened", "ready_for_review"]);
  assert.equal(workflow.on.workflow_call.inputs.model.default, "");
  assert.deepEqual(Object.fromEntries(Object.entries(workflow.jobs)
    .filter(([name]) => name !== "review").map(([name, job]) => [name, job["timeout-minutes"]])), {
    deterministic_evidence: 60, prepare_review_context: 45, review_gate: 5,
  });
});

test("authored review job timeout clamps numeric requests before step validation", () => {
  const authored = workflow.jobs.review["timeout-minutes"];
  assert.equal(typeof authored, "string");
  const expression = authored.match(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/)?.[1];
  assert.ok(expression, "job timeout must select the requested finite budget");
  // This authored expression uses only numeric comparisons and &&/||, whose
  // operand-returning behavior is shared by GitHub expressions and JavaScript.
  assert.match(expression.replaceAll("inputs.review_timeout_minutes", ""), /^[\s\d><=&|().]+$/);
  const selected = new Function("inputs", `"use strict"; return (${expression});`);
  for (const [request, expected] of [
    ["", 60], [undefined, 60], [0, 60], [-1, 60], [59, 60], [60, 60],
    [61, 61], [120, 120], [180, 180], [181, 180], [1e9, 180],
    [60.5, 60.5], [NaN, 60], [Infinity, 180],
  ]) {
    const minutes = selected({ review_timeout_minutes: request });
    assert.equal(minutes, expected);
    assert.ok(Number.isFinite(minutes) && minutes >= 60 && minutes <= 180);
  }
});

test("authored timeout validation handles native absent input without overriding PR caller input", (t) => {
  const validation = namedStep("review", "Validate review timeout");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eta-mu-review-timeout-native-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  // Native direct run 38059635545 reported the absent input property as null.
  // The whole absent context may be null or an object with no timeout property.
  for (const [inputs, property, expected] of [
    ["null", "null", 60], ["{}", "null", 60],
    ['{"pr_head_sha":"caller-head"}', "null", 60],
    ['{"review_timeout_minutes":120}', "120", 120],
  ]) {
    const result = runTimeoutValidation(validation.run, directory, {
      REVIEW_INPUTS_JSON: inputs, REVIEW_TIMEOUT_JSON: property,
      GITHUB_EVENT_NAME: "pull_request",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim(), `Review job timeout: ${expected} minutes.`);
  }
});

test("authored timeout validation accepts only default or whole minutes before any setup", (t) => {
  const validation = namedStep("review", "Validate review timeout");
  assert.equal(workflow.jobs.review.steps[0], validation,
    "invalid requests must fail before checkout, dependency setup, credentials or model invocation");
  assert.equal(validation.env.REVIEW_INPUTS_JSON, "${{ toJSON(inputs) }}",
    "distinguish a missing input property from an explicitly supplied null or zero");
  assert.doesNotMatch(validation.run, /\$\{\{/, "input belongs in env, never shell source");
  assert.equal(validation["continue-on-error"], undefined);
  assert.equal(validation.if, undefined);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eta-mu-review-timeout-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const [request, expected] of [[60, 60], [61, 61], [120, 120], [179, 179], [180, 180]]) {
    const result = runTimeoutValidation(validation.run, directory, {
      REVIEW_INPUTS_JSON: JSON.stringify({ review_timeout_minutes: request }),
      GITHUB_EVENT_NAME: "pull_request",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim(), `Review job timeout: ${expected} minutes.`);
  }
  const canary = path.join(directory, "injected");
  const opaque = `$(touch ${canary})\n::warning::untrusted-timeout`;
  const invalidRequests = [null, false, true, [], {}, 0, -1, 59, 181, 1e9, 60.5, 120.25, "", "120", opaque]
    .map((review_timeout_minutes) => JSON.stringify({ review_timeout_minutes }));
  const invalidContexts = ["", "NaN", "Infinity", "{", "false", "true", "[]", "0", "120", '""', JSON.stringify(opaque)];
  for (const raw of [...invalidRequests, ...invalidContexts]) {
    const result = runTimeoutValidation(validation.run, directory, { REVIEW_INPUTS_JSON: raw });
    assert.notEqual(result.status, 0, `invalid raw request accepted: ${raw}`);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.trim(),
      "::error::review_timeout_minutes must be a whole number from 60 through 180.");
    assert.equal(fs.existsSync(canary), false, "opaque input must never execute or enter workflow commands");
  }
  const absentWithOpaqueSibling = runTimeoutValidation(validation.run, directory, {
    REVIEW_INPUTS_JSON: JSON.stringify({ unrelated: opaque }),
  });
  assert.equal(absentWithOpaqueSibling.status, 0, absentWithOpaqueSibling.stderr);
  assert.equal(absentWithOpaqueSibling.stderr, "");
  assert.equal(absentWithOpaqueSibling.stdout.trim(), "Review job timeout: 60 minutes.");
  assert.equal(fs.existsSync(canary), false, "other input properties must never execute or enter workflow commands");
});

test("public job budget: pre-checkout ESM uses the exact runner owner and exports validated bindings", t => {
  const step = namedStep("review", "Validate review timeout");
  const pattern = /\/\/ BEGIN_REVIEW_JOB_BUDGET[\s\S]*?\/\/ END_REVIEW_JOB_BUDGET/;
  assert.equal(step.run.match(pattern)?.[0], recoveryRunnerSource.match(pattern)?.[0]);
  assert.match(step.run, /node --input-type=module/);
  assert.equal(workflow.jobs.review.permissions.actions, undefined, "no added actions permission");
  assert.doesNotMatch(step.run, /Authorization|Bearer|github\.token|secrets\./);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eta-mu-native-budget-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const [input, expected] of [[{}, 60], [{ review_timeout_minutes: 120 }, 120], [{ review_timeout_minutes: 180 }, 180]]) {
    const result = runTimeoutValidation(step.run, directory, { REVIEW_INPUTS_JSON: JSON.stringify(input) });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.budgetOutput.REVIEW_TIMEOUT_MINUTES, String(expected));
    const origin = JSON.parse(result.budgetOutput.REVIEW_JOB_ORIGIN_JSON);
    assert.equal(origin.job_id, 456); assert.equal(origin.runner_id, 789);
    assert.equal(origin.run_attempt, "2"); assert.equal(origin.runner_name, "owned-test-runner");
    assert.equal(result.budgetOutput.REVIEW_JOB_STARTED_AT_MS, String(origin.started_at_ms));
  }
  const foreign = runTimeoutValidation(step.run, directory, { REVIEW_INPUTS_JSON: "{}", GITHUB_API_URL: "https://example.invalid" });
  assert.notEqual(foreign.status, 0);
  assert.equal(foreign.budgetOutput.REVIEW_JOB_STARTED_AT_MS, undefined);
});

function publicJobFixture() {
  const identity = { repository: "open-hax/fixture", runId: "123", runAttempt: "2", runnerName: "exact-runner" };
  const job = (id, runner = identity.runnerName) => ({ id, run_id: 123, run_attempt: 2,
    status: "in_progress", runner_name: runner, runner_id: id + 1000,
    url: `https://api.github.com/repos/open-hax/fixture/actions/jobs/${id}`,
    run_url: "https://api.github.com/repos/open-hax/fixture/actions/runs/123",
    started_at: new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000).toISOString() });
  const response = (url, data, headers = {}) => {
    const value = new Response(typeof data === "string" ? data : JSON.stringify(data), { status: 200, headers });
    Object.defineProperty(value, "url", { value: url }); return value;
  };
  return { identity, job, response };
}

test("public job budget: anonymous complete pagination selects only the exact current run/attempt/runner", async () => {
  const f = publicJobFixture(), seen = [];
  const prefix = "https://api.github.com/repos/open-hax/fixture/actions/runs/123/attempts/2/jobs?per_page=100&page=";
  const origin = await acquireReviewJobOrigin(f.identity, async (url, options) => {
    seen.push(url);
    assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
    assert.deepEqual(Object.keys(options.headers), ["Accept"]);
    assert.ok(options.signal instanceof AbortSignal);
    return url === prefix + "1"
      ? f.response(url, { total_count: 2, jobs: [f.job(1, "different-runner")] }, { link: `<${prefix}2>; rel="next", <${prefix}2>; rel="last"` })
      : f.response(url, { total_count: 2, jobs: [f.job(2)] }, { link: `<${prefix}1>; rel="prev", <${prefix}1>; rel="first"` });
  });
  assert.deepEqual(seen, [prefix + "1", prefix + "2"]);
  assert.equal(origin.job_id, 2); assert.equal(origin.run_id, "123"); assert.equal(origin.run_attempt, "2");
  assert.equal(origin.runner_name, "exact-runner");
});

for (const repositoryId of ["1401249220", "9007199254740991"]) {
  test(`public job budget: 101 actual jobs accept repository-ID ${repositoryId} links but fetch only the original owner route`, async () => {
    const f = publicJobFixture(), seen = [], signals = [];
    const owner = "https://api.github.com/repos/open-hax/fixture/actions/runs/123/attempts/2/jobs?per_page=100&page=";
    const alias = `https://api.github.com/repositories/${repositoryId}/actions/runs/123/attempts/2/jobs?per_page=100&page=`;
    const selected = f.job(101);
    const origin = await acquireReviewJobOrigin(f.identity, async (url, options) => {
      seen.push(url); signals.push(options.signal);
      assert.equal(url, owner + seen.length, "Link targets must never be fetched");
      assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store");
      assert.deepEqual(options.headers, { Accept: "application/vnd.github+json" });
      assert.ok(options.signal instanceof AbortSignal);
      return seen.length === 1
        ? f.response(url, { total_count: 101, jobs: Array.from({ length: 100 }, (_, index) => f.job(index + 1, "different-runner")) },
          { link: `<${alias}2>; rel="next", <${alias}2>; rel="last"` })
        : f.response(url, { total_count: 101, jobs: [selected] },
          { link: `<${alias}1>; rel="prev", <${alias}1>; rel="first"` });
    });
    assert.deepEqual(seen, [owner + "1", owner + "2"]);
    assert.equal(signals[0], signals[1], "one acquisition controller spans both pages");
    assert.deepEqual(origin, { repository: f.identity.repository, run_id: "123", run_attempt: "2",
      runner_name: "exact-runner", runner_id: 1101, job_id: 101, started_at_ms: Date.parse(selected.started_at) });
  });
}

const repositoryJobLink = "https://api.github.com/repositories/1401249220/actions/runs/123/attempts/2/jobs?per_page=100&page=2";
for (const [fault, target] of [
  ["different run", repositoryJobLink.replace("runs/123/", "runs/124/")],
  ["different attempt", repositoryJobLink.replace("attempts/2/", "attempts/3/")],
  ["different endpoint", repositoryJobLink.replace("/jobs?", "/artifacts?")],
  ["job detail endpoint", repositoryJobLink.replace("/jobs?", "/jobs/101?")],
  ["missing attempt", repositoryJobLink.replace("/attempts/2", "")],
  ...["0", "-1", "01", "+1", "1.0", "1e3", "9007199254740992", "not-an-id", "", "140124922%30"]
    .map(id => [`malformed repository ID ${JSON.stringify(id)}`, repositoryJobLink.replace("/1401249220/", `/${id}/`)]),
  ["foreign origin", repositoryJobLink.replace("api.github.com", "example.invalid")],
  ["foreign port", repositoryJobLink.replace("api.github.com", "api.github.com:444")],
  ["insecure origin", repositoryJobLink.replace("https:", "http:")],
  ["extra query", repositoryJobLink + "&unexpected=1"],
  ["duplicate page", repositoryJobLink + "&page=2"],
  ["duplicate page size", repositoryJobLink + "&per_page=100"],
  ["missing page size", repositoryJobLink.replace("per_page=100&", "")],
  ["different page size", repositoryJobLink.replace("per_page=100", "per_page=1")],
  ...["0", "01", "9007199254740992"].map(page => [`invalid page ${page}`, repositoryJobLink.replace("page=2", `page=${page}`)]),
  ["credentials", repositoryJobLink.replace("api.github.com", "user:password@api.github.com")],
  ["username", repositoryJobLink.replace("api.github.com", "user@api.github.com")],
  ["fragment", repositoryJobLink + "#jobs"],
]) {
  test(`public job budget: repository-ID links refuse ${fault} on every relation`, async () => {
    for (const relation of ["next", "last", "prev", "first"]) {
      const f = publicJobFixture(), seen = [];
      await assert.rejects(acquireReviewJobOrigin(f.identity, async url => {
        seen.push(url);
        return f.response(url, { total_count: 2, jobs: [f.job(1)] }, { link: `<${target}>; rel="${relation}"` });
      }), /foreign public review job pagination/, relation);
      assert.deepEqual(seen, ["https://api.github.com/repos/open-hax/fixture/actions/runs/123/attempts/2/jobs?per_page=100&page=1"]);
    }
  });
}

for (const [fault, page] of [["repeated", "1"], ["skipped", "3"]]) {
  test(`public job budget: repository-ID links refuse a ${fault} next page`, async () => {
    const f = publicJobFixture(), seen = [];
    await assert.rejects(acquireReviewJobOrigin(f.identity, async url => {
      seen.push(url);
      return f.response(url, { total_count: 2, jobs: [f.job(1)] },
        { link: `<${repositoryJobLink.replace("page=2", `page=${page}`)}>; rel="next"` });
    }), /repeated or skipped public review job page/);
    assert.equal(seen.length, 1);
  });
}

for (const [fault, expected] of [["changed total", /incomplete public review job inventory/],
  ["duplicate job", /foreign or duplicate public review job metadata/],
  ["second matching job", /current public review job is unavailable or ambiguous/],
  ["partial final page", /partial public review job inventory/]]) {
  test(`public job budget: repository-ID pagination still refuses ${fault} after an early matching job`, async () => {
    const f = publicJobFixture(), seen = [];
    const owner = "https://api.github.com/repos/open-hax/fixture/actions/runs/123/attempts/2/jobs?per_page=100&page=";
    await assert.rejects(acquireReviewJobOrigin(f.identity, async url => {
      seen.push(url);
      assert.equal(url, owner + seen.length);
      if (seen.length === 1) return f.response(url,
        { total_count: 101, jobs: Array.from({ length: 100 }, (_, index) => f.job(index + 1, index === 0 ? "exact-runner" : "different-runner")) },
        { link: `<${repositoryJobLink}>; rel="next"` });
      const jobs = fault === "partial final page" ? [] :
        [f.job(fault === "duplicate job" ? 100 : 101, fault === "second matching job" ? "exact-runner" : "different-runner")];
      return f.response(url, { total_count: fault === "changed total" ? 102 : 101, jobs });
    }), expected);
    assert.deepEqual(seen, [owner + "1", owner + "2"], "matching on page one must not skip the remaining inventory");
  });
}

for (const fault of ["missing", "ambiguous", "foreign-run", "foreign-attempt", "foreign-url", "future-start",
  "invalid-start", "partial", "duplicate", "repeated-page", "foreign-page", "wrong-response-url", "invalid-json", "unavailable"]) {
  test(`public job budget refuses ${fault} without fallback`, async () => {
    const f = publicJobFixture(); let calls = 0;
    await assert.rejects(acquireReviewJobOrigin(f.identity, async url => {
      calls += 1;
      const job = f.job(1), data = { total_count: 1, jobs: [job] }, headers = {};
      if (fault === "missing") job.runner_name = "someone-else";
      if (fault === "ambiguous") { data.jobs.push(f.job(2)); data.total_count = 2; }
      if (fault === "foreign-run") job.run_id = 124;
      if (fault === "foreign-attempt") job.run_attempt = 1;
      if (fault === "foreign-url") job.url = "https://example.invalid/job";
      if (fault === "future-start") job.started_at = new Date(Date.now() + 60_000).toISOString();
      if (fault === "invalid-start") job.started_at = "2026-02-30T00:00:00Z";
      if (fault === "partial") data.total_count = 2;
      if (fault === "duplicate") { data.jobs.push(job); data.total_count = 2; }
      if (fault === "repeated-page") { data.total_count = 2; headers.link = `<${url}>; rel="next"`; }
      if (fault === "foreign-page") { data.total_count = 2; headers.link = '<https://example.invalid/jobs?per_page=100&page=2>; rel="next"'; }
      if (fault === "unavailable") return new Response("unavailable", { status: 403 });
      return f.response(fault === "wrong-response-url" ? "https://example.invalid/jobs" : url,
        fault === "invalid-json" ? "{" : data, headers);
    }));
    assert.equal(calls, 1, "no credential retry or alternative source");
  });
}

test("public job budget: shared2MiB bound covers complete bodies across pages", async () => {
  const f = publicJobFixture(); let calls = 0;
  await assert.rejects(acquireReviewJobOrigin(f.identity, async url => {
    calls += 1;
    const next = new URL(url); next.searchParams.set("page", "2");
    return f.response(url, { total_count: 2, jobs: [f.job(calls)], padding: "x".repeat(1_100_000) },
      calls === 1 ? { link: `<${next}>; rel="next"` } : {});
  }), /byte bound/);
  assert.equal(calls, 2);
});

test("public job budget: incomplete body and total acquisition deadline refuse", async () => {
  const f = publicJobFixture();
  await assert.rejects(acquireReviewJobOrigin(f.identity, async url => {
    const value = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"total_count":1')); controller.error(new Error("owned partial stream"));
    } }));
    Object.defineProperty(value, "url", { value: url }); return value;
  }), /partial stream/);
  const descriptor = Object.getOwnPropertyDescriptor(performance, "now");
  const original = performance.now.bind(performance); let offset = 0;
  Object.defineProperty(performance, "now", { configurable: true, value: () => original() + offset });
  try {
    await assert.rejects(acquireReviewJobOrigin(f.identity, async url => {
      offset += 30_001; return f.response(url, { total_count: 1, jobs: [f.job(1)] });
    }), /deadline/);
  } finally { if (descriptor) Object.defineProperty(performance, "now", descriptor); else delete performance.now; }
});

test("public job budget: one held wall sample converts shared selected minutes with the existing tail reserve", () => {
  const original = Date.now, wall = original(); let reads = 0;
  Date.now = () => { reads += 1; return reads === 1 ? wall : wall + 1_000_000; };
  try {
    const before = performance.now();
    const cutoff = reviewJobDeadline({ REVIEW_TIMEOUT_MINUTES: "120", REVIEW_JOB_STARTED_AT_MS: String(wall - 60_000) });
    const after = performance.now(), remaining = 120 * 60_000 - 60_000 - 120_250;
    assert.ok(cutoff >= before + remaining && cutoff <= after + remaining);
    assert.equal(reads, 1, "wall clock must not be read again after validation");
  } finally { Date.now = original; }
  for (const env of [{}, { REVIEW_JOB_STARTED_AT_MS: String(wall + 60_000) },
    { REVIEW_JOB_STARTED_AT_MS: String(wall), REVIEW_TIMEOUT_MINUTES: "59" },
    { REVIEW_JOB_STARTED_AT_MS: String(wall), REVIEW_TIMEOUT_MINUTES: "181" },
    { REVIEW_JOB_STARTED_AT_MS: String(wall), REVIEW_TIMEOUT_MINUTES: "120.5" },
    { REVIEW_JOB_STARTED_AT_MS: String(wall), GITHUB_ACTIONS: "true", REVIEW_JOB_ORIGIN_JSON: "{}" }]) {
    assert.throws(() => reviewJobDeadline(env), /job budget|job start/);
  }
});

test("actual model cleanup: parent close terminates an owned helper without capture pipes", t => {
  const checked = freshReviewInputCheck(fullInputFixture(t));
  const f = canonicalContextFixture(checked), data = canonicalContextResponse(f);
  const helperFile = path.join(checked.env.RUNNER_TEMP, "owned-pipe-free-helper.pid");
  const script = path.join(checked.env.RUNNER_TEMP, "owned-pipe-free-model.mjs");
  const prompt = path.join(checked.env.RUNNER_TEMP, "owned-pipe-free-prompt.md");
  fs.writeFileSync(prompt, "Synthetic local process cleanup control; no model/provider/publication.\n");
  const helper = `const fs=require('node:fs');process.on('SIGTERM',()=>{});` +
    `fs.writeFileSync(${JSON.stringify(helperFile)},String(process.pid));setInterval(()=>{},1000);`;
  fs.writeFileSync(script, `#!/usr/bin/env node
    import fs from 'node:fs';import {spawn} from 'node:child_process';
    spawn(process.execPath,['-e',${JSON.stringify(helper)}],{stdio:'ignore'});
    const ready=setInterval(()=>{if(!fs.existsSync(${JSON.stringify(helperFile)}))return;clearInterval(ready);
      fs.writeFileSync(${JSON.stringify(f.submissionFile)},${JSON.stringify(data.submission.toString())});
      process.stdout.write(${JSON.stringify(data.response.toString())},()=>process.exit(0));
    },10);
  `);
  fs.chmodSync(script, 0o700);
  let pid;
  t.after(() => { if (pid) { try { process.kill(pid, "SIGKILL"); } catch { /* Only this owned helper. */ } } });
  const result = spawnSync(process.execPath, [path.join(root, ".github/scripts/run-opencode-review-recovery.mjs")], {
    cwd: checked.consumer, encoding: "utf8", timeout: 15_000,
    env: { PATH: process.env.PATH, ...localReviewBudgetFixture(), PR_NUMBER: "42", REVIEW_MODEL: "synthetic/no-provider",
      OPENCODE_BIN: script, REVIEW_EVIDENCE_DIR: checked.evidence, REVIEW_PROMPT_FILE: prompt, ...f.env },
  });
  if (fs.existsSync(helperFile)) pid = Number(fs.readFileSync(helperFile, "utf8"));
  assert.ok(Number.isSafeInteger(pid) && pid > 1, "the real owned pipe-free helper must start");
  let live = false;
  try { live = !["Z", "X"].includes(fs.readFileSync(`/proc/${pid}/status`, "utf8").match(/^State:\s+([A-Z])/m)?.[1]); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  t.diagnostic(JSON.stringify({ ownedPipeFreeHelperPID: pid, liveAtSupervisorCompletion: live }));
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(live, false, "normal parent/pipe close must not leave its owned helper working");
  assert.equal(JSON.parse(fs.readFileSync(path.join(checked.evidence, "recovery.json"))).accepted_invocation.attempt, 1);
});

test("bounded review budget keeps publication App mint after validated revision-bound completion", () => {
  const steps = workflow.jobs.review.steps;
  const beforeMint = [
    "Run bounded evidence-first OpenCode review",
    "Reverify full input and bind final submission",
    "Validate final review submission",
    "Verify review remained revision-bound",
  ].map((name) => namedStep("review", name));
  const token = namedStep("review", "Create eta-mu GitHub App token for review publication");
  const publish = namedStep("review", "Publish actual GitHub pull request review");
  const positions = [...beforeMint, token, publish].map((step) => steps.indexOf(step));
  assert.ok(positions.every((position, index) => index === 0 || position > positions[index - 1]),
    "publication token must be newly minted after the complete review and every final guard");
  for (const step of [...beforeMint, token, publish]) {
    assert.notEqual(step["continue-on-error"], true, `${step.name} cannot bypass failure`);
  }
  assert.equal(token.if, undefined, "App mint keeps the default success prerequisite");
  assert.equal(publish.if, undefined, "publication keeps the default success prerequisite");
  assert.equal(token.id, "eta_mu_publish_token");
  assert.match(token.uses, /^actions\/create-github-app-token@[0-9a-f]{40}$/);
  assert.deepEqual(steps.filter((step) => step.uses?.startsWith("actions/create-github-app-token@"))
    .map((step) => step.id), ["eta_mu_publish_token"]);
  assert.equal(token.with["skip-token-revoke"], undefined, "the existing default revocation is retained");
  assert.equal(token.with["permission-metadata"], "read");
  assert.equal(token.with["permission-pull-requests"], "write");
  assert.equal(publish.with["github-token"], "${{ steps.eta_mu_publish_token.outputs.token }}");
  assert.equal(publish.env.REVIEW_SUBMISSION_FILE, "${{ steps.final_review_input.outputs.submission_file }}");
});

// Babashka is the declared test runtime; use its EDN reader and bundled JSON renderer.
function renderReviewHostMetadataFromEdn() {
  const rendered = spawnSync("bb", ["-e", `
    (require '[clojure.edn :as edn] '[cheshire.core :as json])
    (let [metadata (edn/read-string (slurp (first *command-line-args*)))]
      (assert (and (map? metadata)
                   (every? string? (keys metadata))
                   (every? string? (vals metadata))))
      (print (json/generate-string metadata)))
  `, path.join(root, ".github/review-host-tool-metadata.edn")], {
    cwd: root, encoding: "utf8", timeout: 10000,
  });
  assert.ifError(rendered.error);
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.equal(rendered.stderr, "");
  return JSON.parse(rendered.stdout);
}

test("embedded review metadata JSON matches canonical tracked EDN rendering", () => {
  const assembly = namedStep("prepare_review_context", "Assemble revision-bound review context");
  const embedded = assembly.run.match(
    /<<'ETA_MU_REVIEW_HOST_METADATA_JSON'\n([\s\S]*?)\nETA_MU_REVIEW_HOST_METADATA_JSON/,
  );
  assert.ok(embedded, "review context must carry the rendered metadata JSON");
  assert.deepEqual(JSON.parse(embedded[1]), renderReviewHostMetadataFromEdn());
});


/** Stage the actual compiled owner; synthetic call data grants no review credit. */
function canonicalContextFixture(checked, contextBytes = Buffer.from("outside encounter 😀\nsecond context line\n")) {
  const moduleFile = process.env.ETA_MU_CANONICAL_CONTEXT_MODULE;
  assert.ok(moduleFile && path.isAbsolute(moduleFile), "ETA_MU_CANONICAL_CONTEXT_MODULE must name the compiled Muse owner");
  const context = path.join(checked.consumer, ".review-context");
  fs.mkdirSync(path.join(context, "machinery"), { recursive: true });
  fs.mkdirSync(path.join(context, "metadata"), { recursive: true });
  const verifierFile = path.join(context, "machinery/review-invocation.cjs");
  fs.copyFileSync(moduleFile, verifierFile);
  const verifier = createRequire(import.meta.url)(verifierFile);
  const tools = ["review_begin", "review_read_diff_chunk", "review_assess_diff_chunk", "review_record_evidence",
    "review_propose_finding", "review_classify_finding", "review_status", "review_submit"];
  const registryFile = path.join(context, "metadata/exposed-tools.txt");
  fs.writeFileSync(registryFile, tools.join("\n") + "\n");
  const contextFile = path.resolve(checked.evidence, "pr-context.md");
  fs.writeFileSync(contextFile, contextBytes);
  const full = fs.readFileSync(path.join(checked.evidence, "basehead.diff"));
  const manifestBytes = fs.readFileSync(path.join(checked.evidence, "input-manifest.json"));
  const submissionFile = path.join(checked.evidence, "submission.json");
  const expectedContext = verifier.prepareReviewInvocationContext(full, manifestBytes, tools, submissionFile, contextBytes, contextFile);
  assert.throws(() => verifier.prepareReviewInvocationContext(full, manifestBytes, tools, submissionFile), /invalid full-input context/);
  assert.deepEqual(expectedContext.contextSource, { path: contextFile, bytes: contextBytes.length, sha256: transportSha256(contextBytes) });
  const checksum = execFileSync("sha256sum", ["machinery/review-invocation.cjs", "metadata/exposed-tools.txt"], { cwd: context });
  fs.writeFileSync(path.join(context, "SHA256SUMS"), checksum);
  const output = path.join(checked.env.RUNNER_TEMP, "invocation-outputs");
  fs.writeFileSync(output, "");
  return { checked, context, verifier, verifierFile, registryFile, contextFile, contextBytes, full,
    expectedContext, submissionFile, output, tools, digest: transportSha256(checksum),
    env: { REVIEW_INVOCATION_VERIFIER_FILE: verifierFile, REVIEW_TOOL_REGISTRY_FILE: registryFile, GITHUB_OUTPUT: output } };
}

/** Encode synthetic adapter input using canonical geometry and the observed HOST frame shape. */
function canonicalContextResponse(fixture, { omitRead = false, omitSubmit = false, corruptEof = false } = {}) {
  const ctx = fixture.expectedContext;
  const stages = ["deterministic", "map-change", "generate-candidates", "adversarial-validate", "publish"];
  const sessionID = "ses_synthetic_caller_context";
  const events = [];
  let clock = 1;
  const call = (tool, input, output) => {
    const n = events.length + 1;
    events.push({ type: "tool_use", timestamp: clock, sessionID,
      part: { type: "tool", id: `synthetic-part-${n}`, callID: `synthetic-call-${n}`, sessionID, tool,
        state: { status: "completed", input, time: { start: clock, end: clock },
          output: JSON.stringify({ ...output, "context-protocol": "open-hax.review-context/v1",
            "context-source": ctx.contextSource, "context-observation": { status: ctx.contextSource ? "present" : "absent", source: ctx.contextSource } }) } } });
    clock += 1;
  };
  call("review_begin", {}, { "ok?": true, stage: stages[0], stages, "input-source": ctx.inputSource,
    "diff-stats": { files: 2, bytes: fixture.full.toString("utf8").length, "truncated?": false },
    "input-coverage": { chunks: ctx.pages.length, delivered: 0, assessed: 0, missing: ctx.pages.map(p => p.id) } });
  if (!omitRead) {
    const lines = ctx.contextLines.map((line, i) => `${i + 1}: ${line}`).join("\n");
    const eof = corruptEof ? "synthetic incomplete delivery" : `(End of file - total ${ctx.contextLines.length} lines)`;
    events.push({ type: "tool_use", timestamp: clock, sessionID,
      part: { type: "tool", id: "synthetic-context-read", callID: "synthetic-context-read", sessionID, tool: "read",
        state: { status: "completed", input: { filePath: fixture.contextFile, offset: 1, limit: Math.max(1, ctx.contextLines.length) },
          time: { start: clock, end: clock },
          metadata: { loaded: [], preview: ctx.contextLines.slice(0, 20).join("\n"), truncated: false,
            display: { type: "file", path: fixture.contextFile, text: ctx.contextLines.join("\n"),
              lineStart: 1, lineEnd: ctx.contextLines.length, totalLines: ctx.contextLines.length, truncated: false } },
          output: `<path>${fixture.contextFile}</path>\n<type>file</type>\n<content>\n${lines}\n\n${eof}\n</content>` } } });
    clock += 1;
  }
  const assessments = ctx.pages.map(p => ({ ...p, note: "Synthetic adapter fixture assessment; no provider judgment." }));
  for (const [i, page] of ctx.pages.entries()) {
    call("review_read_diff_chunk", { id: page.id }, { "ok?": true, chunk: { ...page, text: fixture.full.toString("utf8").slice(page.start, page.end) } });
    call("review_assess_diff_chunk", { id: page.id, note: assessments[i].note }, { "ok?": true, "chunk-id": page.id,
      coverage: { chunks: ctx.pages.length, delivered: i + 1, assessed: i + 1, missing: ctx.pages.slice(i + 1).map(p => p.id) } });
  }
  for (const stage of stages) call("review_record_evidence", { stage, note: `Synthetic ${stage} adapter control.` }, { "ok?": true });
  const submission = { schema: "open-hax.github-review/v1", event: "COMMENT", summary: "Synthetic caller control; no review credit.", comments: [],
    "context-protocol": "open-hax.review-context/v1", "context-source": ctx.contextSource,
    "input-source": ctx.inputSource, "input-coverage": { chunks: ctx.pages.length, delivered: ctx.pages.length, assessed: ctx.pages.length, missing: [] },
    "input-assessments": assessments };
  if (!omitSubmit) call("review_submit", { summary: submission.summary }, { "ok?": true, event: "COMMENT", file: fixture.submissionFile, "inline-comments": 0 });
  events.push({ type: "step_finish", timestamp: clock, sessionID, part: { type: "step-finish", id: "synthetic-stop", sessionID, reason: "stop" } });
  return { response: Buffer.from(events.map(e => JSON.stringify(e)).join("\n") + "\n"), submission: Buffer.from(JSON.stringify(submission)) };
}

/** Run the real supervisor with an inert local child, never OpenCode or a provider. */
function canonicalSupervisor(fixture, { retryAfterMissingSubmit = false, responseOptions = {} } = {}) {
  const directory = fixture.checked.evidence;
  const child = path.join(directory, "synthetic-opencode.mjs");
  const prompt = path.join(directory, "synthetic-prompt.md");
  const marker = path.join(directory, "synthetic-child-entered");
  const data = canonicalContextResponse(fixture, responseOptions);
  fs.writeFileSync(prompt, "Synthetic caller control #{{PR_NUMBER}}.\n");
  const first = canonicalContextResponse(fixture, { omitSubmit: true });
  const countFile = path.join(directory, "synthetic-attempt-count");
  fs.writeFileSync(child, `#!/usr/bin/env node\nimport fs from "node:fs";\nconst countFile=${JSON.stringify(countFile)};\nconst attempt=fs.existsSync(countFile)?Number(fs.readFileSync(countFile,"utf8"))+1:1;\nfs.writeFileSync(countFile,String(attempt));\nfs.writeFileSync(${JSON.stringify(marker)}, "entered");\nif (${JSON.stringify(retryAfterMissingSubmit)} && attempt===1) {\n  process.stdout.write(${JSON.stringify(first.response.toString("utf8"))});\n  fs.appendFileSync(${JSON.stringify(fixture.contextFile)}, "mutated between children\\n");\n} else {\n  fs.writeFileSync(${JSON.stringify(fixture.submissionFile)}, ${JSON.stringify(data.submission.toString("utf8"))});\n  process.stdout.write(${JSON.stringify(data.response.toString("utf8"))});\n}\n`);
  fs.chmodSync(child, 0o755);
  const result = spawnSync(process.execPath, [path.join(root, ".github/scripts/run-opencode-review-recovery.mjs")], {
    cwd: root, encoding: "utf8", env: { ...localReviewBudgetFixture(), PATH: process.env.PATH, PR_NUMBER: "42", REVIEW_MODEL: "synthetic/no-provider",
      OPENCODE_BIN: child, REVIEW_EVIDENCE_DIR: directory, REVIEW_PROMPT_FILE: prompt, ...fixture.env } });
  return { result, marker };
}

test("delivered assessments after single reads require custody before any child", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eta-delivered-custody-red-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const tools = ["review_read_diff_chunk", "review_assess_delivered_diff_batch"];
  let attempts = 0;
  await assert.rejects(runReviewRecovery({
    evidenceDirectory: directory,
    basePrompt: "Missing physical custody control; no provider or publication.",
    reviewTools: tools,
    expectedContext: { reviewTools: tools },
    verifyReviewInvocation: () => { throw new Error("verifier must not run without custody"); },
    invokeAttempt: async () => {
      attempts += 1;
      throw new Error("child entered without required physical custody");
    },
  }), /canonical batch host capture is required before model execution/);
  assert.equal(attempts, 0, "single reads do not remove the new assessor's host obligation");
  assert.equal(fs.existsSync(path.join(directory, "submission.json")), false);
});

test("canonical bounded batches: unsupported host refuses before the model-attempt adapter", async (t) => {
  const checked = freshReviewInputCheck(fullInputFixture(t, { unicode: true }));
  assert.equal(checked.result.status, 0, checked.result.stderr);
  const fixture = canonicalContextFixture(checked);
  const tools = [...fixture.tools, "review_read_diff_batch", "review_assess_diff_batch"];
  fs.writeFileSync(fixture.registryFile, tools.join("\n") + "\n");
  const expectedContext = fixture.verifier.prepareReviewInvocationContext(
    fixture.full, fs.readFileSync(path.join(checked.evidence, "input-manifest.json")),
    tools, fixture.submissionFile, fixture.contextBytes, fixture.contextFile,
  );
  assert.equal(typeof fixture.verifier.prepareReviewBatchHost, "function");
  const unsupported = path.join(checked.evidence, "unsupported-host-control");
  fs.writeFileSync(unsupported, "Inert unsupported executable bytes; never run this control.\n");
  const observe = () => fixture.verifier.prepareReviewBatchHost(
    unsupported, Buffer.from("{}"), {}, checked.consumer,
  );
  assert.throws(observe, /unsupported batch host/);
  // The actual owner decides host eligibility. These inert call frames only
  // show whether the supervisor enters its attempt adapter before that check;
  // they supply no native-host positive, model judgment or review credit.
  const healthy = canonicalContextResponse({ ...fixture, tools, expectedContext });
  let attempts = 0;
  let captures = 0;
  let failure;
  try {
    await runReviewRecovery({
      evidenceDirectory: checked.evidence,
      basePrompt: "Unsupported-host negative control; no provider or publication.",
      submissionFile: fixture.submissionFile,
      reviewTools: tools,
      verifyReviewInvocation: fixture.verifier.verifyReviewInvocation,
      expectedContext,
      verifierSha256: transportSha256(fs.readFileSync(fixture.verifierFile)),
      captureBatchHost: async () => { captures += 1; return observe(); },
      invokeAttempt: async ({ responseFile, stderrFile }) => {
        attempts += 1;
        fs.writeFileSync(responseFile, healthy.response);
        fs.writeFileSync(stderrFile, "");
        fs.writeFileSync(fixture.submissionFile, healthy.submission);
        return { exitCode: 0 };
      },
    });
  } catch (error) { failure = error; }
  assert.equal(attempts, 0, "unsupported batch host must refuse before the attempt adapter");
  assert.equal(captures, 1);
  assert.match(failure?.message ?? "", /unsupported batch host/);
  assert.equal(fs.existsSync(fixture.submissionFile), false);
});

for (const [name, changedBoundary, expectedAttempts, expectedCaptures] of [
  ["first child mutation", "after:1", 1, ["before:1", "after:1"]],
  ["mutation before corrective child", "before:2", 1, ["before:1", "after:1", "before:2"]],
  ["corrective child mutation", "after:2", 2, ["before:1", "after:1", "before:2", "after:2"]],
]) {
  test(`canonical caller custody: ${name} stops without acceptance`, async (t) => {
    const checked = freshReviewInputCheck(fullInputFixture(t));
    const fixture = canonicalContextFixture(checked);
    const first = canonicalContextResponse(fixture, { omitSubmit: true });
    const second = canonicalContextResponse(fixture);
    const captures = [];
    let attempts = 0;
    // Synthetic identity tests transport comparison only. Host eligibility is
    // decided by the real Muse API in the preceding unsupported-host control.
    // Reusing this object also proves a later adapter mutation cannot rewrite
    // the original snapshot retained in supervisor memory.
    const observation = { batchHost: { profile: "synthetic-custody-control" }, custody: { source: "original" } };
    let failure;
    try {
      await runReviewRecovery({ evidenceDirectory: checked.evidence,
        basePrompt: "Synthetic custody negative; no provider or publication.",
        submissionFile: fixture.submissionFile, reviewTools: fixture.tools,
        verifyReviewInvocation: fixture.verifier.verifyReviewInvocation,
        expectedContext: fixture.expectedContext,
        captureBatchHost: async ({ boundary, attempt }) => {
          const key = `${boundary}:${attempt}`;
          captures.push(key);
          if (key === changedBoundary) observation.custody.source = "changed";
          return observation;
        },
        invokeAttempt: async ({ attempt, responseFile, stderrFile }) => {
          attempts += 1;
          const data = attempt === 1 ? first : second;
          fs.writeFileSync(responseFile, data.response);
          fs.writeFileSync(stderrFile, "");
          if (attempt === 2) fs.writeFileSync(fixture.submissionFile, data.submission);
          return { exitCode: 0 };
        },
      });
    } catch (error) { failure = error; }
    assert.equal(attempts, expectedAttempts, "custody failure must stop before another model child");
    assert.deepEqual(captures, expectedCaptures);
    assert.match(failure?.message ?? "", /custody changed/);
    const recovery = JSON.parse(fs.readFileSync(path.join(checked.evidence, "recovery.json")));
    assert.equal(recovery.accepted_invocation, null);
    assert.equal(recovery.batch_custody.original.custody.source, "original");
  });
}

test("canonical caller custody: a throwing child still gets an independent after capture", async (t) => {
  const checked = freshReviewInputCheck(fullInputFixture(t));
  const fixture = canonicalContextFixture(checked);
  const captures = [];
  let attempts = 0;
  await assert.rejects(runReviewRecovery({ evidenceDirectory: checked.evidence,
    basePrompt: "Throwing child negative; no provider or publication.",
    submissionFile: fixture.submissionFile, reviewTools: fixture.tools,
    verifyReviewInvocation: fixture.verifier.verifyReviewInvocation, expectedContext: fixture.expectedContext,
    captureBatchHost: async ({ boundary, attempt }) => {
      captures.push(`${boundary}:${attempt}`);
      return { batchHost: { profile: "synthetic-custody-control" }, custody: { source: "original" } };
    },
    invokeAttempt: async ({ responseFile, stderrFile }) => {
      attempts += 1;
      fs.writeFileSync(responseFile, "");
      fs.writeFileSync(stderrFile, "synthetic child failed\n");
      throw new Error("synthetic child failure");
    },
  }), /synthetic child failure/);
  assert.equal(attempts, 1);
  assert.deepEqual(captures, ["before:1", "after:1"]);
});

function actualCaptureFixture(t) {
  const owner = process.env.ETA_MU_CANONICAL_CONTEXT_MODULE;
  const selectedBinary = process.env.ETA_MU_NATIVE_BATCH_BINARY ||
    path.join(path.dirname(owner), "native-cli/node_modules/opencode-linux-x64/bin/opencode");
  const checked = freshReviewInputCheck(fullInputFixture(t));
  const f = canonicalContextFixture(checked);
  const binary = path.join(checked.env.RUNNER_TEMP, "captured-physical-opencode");
  fs.copyFileSync(selectedBinary, binary, fs.constants.COPYFILE_FICLONE);
  fs.chmodSync(binary, 0o700);
  const home = path.join(checked.env.RUNNER_TEMP, "owned-capture-home");
  const runtime = path.join(checked.env.RUNNER_TEMP, "owned-capture-runtime");
  const otherSkills = path.join(checked.env.RUNNER_TEMP, "other-skills");
  for (const directory of [home, runtime, otherSkills, path.join(home, ".config/opencode"),
    path.join(f.context, "agents/skills")]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(runtime, "inert-source.txt"), "Captured inert source identity; never executed.\n");
  fs.writeFileSync(path.join(f.context, "agents/skills/original.md"), "Original owned skill source.\n");
  fs.writeFileSync(path.join(otherSkills, "different.md"), "Different owned skill source.\n");
  const link = path.join(home, ".agents");
  fs.symlinkSync(path.join(f.context, "agents"), link);
  const configFile = path.join(home, ".config/opencode/opencode.json");
  fs.writeFileSync(configFile, "{}\n");
  const promptFile = path.join(f.context, "machinery/evidence-review.md");
  fs.writeFileSync(promptFile, "Inert adapter capture control; no model invocation.\n");
  const environment = { PATH: process.env.PATH, HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"), XDG_DATA_HOME: path.join(home, ".local/share"),
    XDG_CACHE_HOME: path.join(home, ".cache"), XDG_STATE_HOME: path.join(home, ".local/state"),
    OPENCODE_CONFIG: configFile, OPENCODE_CONFIG_DIR: path.join(home, ".config/opencode"),
    OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_MODELS_FETCH: "true" };
  const captureInput = { binary, environment, cwd: checked.consumer, verifierFile: f.verifierFile,
    registryFile: f.registryFile, evidenceDirectory: checked.evidence, promptFile,
    contextDirectory: f.context, runtimeDirectory: runtime };
  return { checked, f, binary, configFile, environment, captureInput, link, otherSkills };
}

test("actual context custody: the selected physical context has one complete byte owner",
  { skip: process.platform !== "linux" || process.arch !== "x64" }, async (t) => {
  const { checked, f, captureInput } = actualCaptureFixture(t);
  const observed = await captureReviewBatchCustody(captureInput);
  assert.ok(observed.custody.context.files >= 5);
  assert.equal(observed.custody.context.path, fs.realpathSync(f.context));
  assert.match(observed.custody.context.sha256, /^[0-9a-f]{64}$/);
  const prefix = path.relative(checked.consumer, f.context) + path.sep;
  assert.deepEqual(observed.custody.git_untracked_files.filter(row => row.path.startsWith(prefix)), [],
    "only this independently held physical context must leave the duplicate consumer census");
  assert.ok(observed.custody.git_untracked_files.some(row => row.path === path.relative(checked.consumer, f.contextFile)),
    "the staged encounter file outside that root must remain an immutable consumer input");
});

test("actual context custody: sorted DFS JSON identity retains modes, empty bytes, Unicode and internal links",
  { skip: process.platform !== "linux" || process.arch !== "x64" }, async (t) => {
  const { f, captureInput } = actualCaptureFixture(t);
  fs.mkdirSync(path.join(f.context, "a-tree"));
  fs.writeFileSync(path.join(f.context, "a-tree/blank"), "");
  fs.chmodSync(path.join(f.context, "a-tree/blank"), 0o640);
  fs.writeFileSync(path.join(f.context, "a-tree/尾.txt"), "actual finite Unicode bytes ημ\n");
  fs.chmodSync(path.join(f.context, "a-tree/尾.txt"), 0o604);
  fs.symlinkSync("a-tree/尾.txt", path.join(f.context, "link-one"));
  // Explicit known fixture inventory, not a second general directory walker.
  // This is the original sorted depth-first JSON row representation.
  const expected = ["SHA256SUMS", "a-tree/blank", "a-tree/尾.txt", "agents/skills/original.md", "link-one",
    "machinery/evidence-review.md", "machinery/review-invocation.cjs", "metadata/exposed-tools.txt"].map(name =>
    name === "link-one" ? { path: name, link: "a-tree/尾.txt", target: "a-tree/尾.txt" }
      : { path: name, mode: fs.statSync(path.join(f.context, name)).mode & 0o777,
        sha256: transportSha256(fs.readFileSync(path.join(f.context, name))) });
  assert.equal(expected[1].mode, 0o640); assert.equal(expected[2].mode, 0o604);
  const observed = await captureReviewBatchCustody(captureInput);
  assert.deepEqual(observed.custody.context, { path: fs.realpathSync(f.context),
    sha256: transportSha256(JSON.stringify(expected)), files: expected.length });
});

for (const kind of ["root symlink", "escaping internal link", "special context input"]) {
  test(`actual context custody: ${kind} cannot establish a census exemption`,
    { skip: process.platform !== "linux" || process.arch !== "x64" }, async (t) => {
    const { checked, f, captureInput } = actualCaptureFixture(t);
    if (kind === "root symlink") {
      const outside = path.join(checked.env.RUNNER_TEMP, "owned-rebound-context");
      fs.renameSync(f.context, outside); fs.symlinkSync(outside, f.context);
    } else if (kind === "escaping internal link") {
      const outside = path.join(checked.env.RUNNER_TEMP, "owned-external-source");
      fs.writeFileSync(outside, "not an admitted context descendant\n");
      fs.symlinkSync(outside, path.join(f.context, "escaping-link"));
    } else execFileSync("mkfifo", [path.join(f.context, "owned-special-input")]);
    await assert.rejects(captureReviewBatchCustody(captureInput), /physical|source|context|regular|symlink|special|escape/i);
  });
}

test("actual source acquisition RED: finite streaming, shared deadline and aggregate metadata custody",
  { skip: process.platform !== "linux" || process.arch !== "x64" }, async (t) => {
  // Reuse ONE physical copy/fixture for these isolated faults. Only tiny source
  // files are added; there is no dependency install or64MiB filesystem tree.
  const { checked, captureInput } = actualCaptureFixture(t);
  const contextRow = "owned-row-context-ημ", runtimeRow = "owned-row-runtime-ημ", nameLimit = "owned-name-limit-ημ";
  for (const [directory, name, bytes] of [[captureInput.contextDirectory, contextRow, "context row\n"],
    [captureInput.runtimeDirectory, runtimeRow, "runtime row\n"],
    [captureInput.runtimeDirectory, nameLimit, "finite name input\n"],
    [captureInput.runtimeDirectory, "a-first.txt", "x".repeat(8192)],
    [captureInput.runtimeDirectory, "z-after.txt", "must not read after expiry\n"]]) {
    fs.writeFileSync(path.join(directory, name), bytes);
  }
  for (const mode of ["whole-file", "shared-deadline", "stream-clock", "metadata-name", "metadata-aggregate"]) {
    await t.test(mode, { timeout: 45_000 }, async (t) => {
      const state = path.join(checked.env.RUNNER_TEMP, `owned-source-acquisition-${mode}`);
      fs.mkdirSync(state, { mode: 0o700 });
      const input = path.join(state, "input.json");
      fs.writeFileSync(input, JSON.stringify({ state, mode, captureInput, contextRow, runtimeRow, nameLimit,
        runner: path.join(root, ".github/scripts/run-opencode-review-recovery.mjs") }));
      // Same owned worker/public-capture pattern as the existing config faults.
      // Actual physical CLI/Muse/files are retained. Clock and UTF8 measurement
      // faults below are explicitly SYNTHETIC, not native large-tree proof.
      const worker = String.raw`
        import fs from "node:fs";
        import fsp from "node:fs/promises";
        import cp from "node:child_process";
        import crypto from "node:crypto";
        import path from "node:path";
        import { syncBuiltinESMExports } from "node:module";
        import { pathToFileURL } from "node:url";
        const f=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
        const spawn=cp.spawn;
        cp.spawn=(binary,args,options)=>{
          const child=spawn(binary,args,options);
          if(child.pid) fs.appendFileSync(path.join(f.state,"owned-pids.jsonl"),JSON.stringify({
            pid:child.pid,detached:options?.detached===true})+"\n");
          return child;
        };
        syncBuiltinESMExports();
        const {captureReviewBatchCustody}=await import(pathToFileURL(f.runner).href);
        // Normalize the actual CLI and establish unchanged source identity
        // before any synthetic fault; no model or provider is called.
        const baseline=await captureReviewBatchCustody(f.captureInput);
        const realNow=performance.now.bind(performance);
        const deadline=realNow()+30_000;
        let offset=0,clockFault=false,contextCharged=false,runtimeCharged=false;
        let wholeReads=0,streamReads=0,runtimeReadsAfterExpiry=0,laterReads=0,rowHashed=false;
        const measurements=[];
        Object.defineProperty(performance,"now",{value:()=>realNow()+offset});
        const first=path.join(f.captureInput.runtimeDirectory,"a-first.txt");
        const later=path.join(f.captureInput.runtimeDirectory,"z-after.txt");
        const target=file=>typeof file==="string"?path.resolve(file):null;
        const listed=directory=>{
          const actual=target(directory);
          if(f.mode!=="shared-deadline")return;
          if(actual===f.captureInput.contextDirectory&&!contextCharged){contextCharged=true;offset+=16_000;}
          if(actual===f.captureInput.runtimeDirectory&&!runtimeCharged){runtimeCharged=true;offset+=16_000;clockFault=true;}
        };
        const reading=file=>{
          const actual=target(file);
          if(actual?.startsWith(f.captureInput.runtimeDirectory+path.sep)&&performance.now()>=deadline)runtimeReadsAfterExpiry++;
          if(actual===later)laterReads++;
        };
        const jump=()=>{if(!clockFault){clockFault=true;offset+=31_000;}};
        const readFile=fs.readFileSync,readAsync=fsp.readFile,stream=fs.createReadStream;
        const readdir=fs.readdirSync,readdirAsync=fsp.readdir,opendir=fsp.opendir;
        const byteLength=Buffer.byteLength,createHash=crypto.createHash;
        fs.readdirSync=function(directory,...args){const rows=readdir.call(this,directory,...args);listed(directory);return rows;};
        fsp.readdir=async function(directory,...args){const rows=await readdirAsync.call(this,directory,...args);listed(directory);return rows;};
        fsp.opendir=async function(directory,...args){
          const handle=await opendir.call(this,directory,...args);
          return {path:handle.path,
            read:async()=>{const row=await handle.read();if(row===null)listed(directory);return row;},
            close:()=>handle.close(),
            async *[Symbol.asyncIterator](){for await(const row of handle)yield row;listed(directory);}};
        };
        fs.readFileSync=function(file,...args){
          reading(file);
          if(target(file)===first){
            wholeReads++;
            if(f.mode==="whole-file")throw Error("SYNTHETIC owned payload refuses whole-file buffering");
          }
          const bytes=readFile.call(this,file,...args);
          if(f.mode==="stream-clock"&&target(file)===first)jump();
          return bytes;
        };
        fsp.readFile=async function(file,...args){
          reading(file);
          if(target(file)===first){wholeReads++;if(f.mode==="whole-file")throw Error("SYNTHETIC owned payload refuses whole-file buffering");}
          const bytes=await readAsync.call(this,file,...args);
          if(f.mode==="stream-clock"&&target(file)===first)jump();return bytes;
        };
        fs.createReadStream=function(file,...args){
          reading(file);const result=stream.call(this,file,...args);
          if(target(file)===first){streamReads++;if(f.mode==="stream-clock")result.prependOnceListener("data",jump);}
          return result;
        };
        Buffer.byteLength=function(value,encoding){
          const actual=byteLength.call(this,value,encoding);
          if(typeof value!=="string")return actual;
          if(f.mode==="metadata-name"&&value.split("\0").includes(f.nameLimit)){
            const bytes=64*1024*1024+1;
            measurements.push({kind:"name",role:"runtime",actual,reported:bytes});return bytes;
          }
          if(f.mode==="metadata-aggregate"&&value.startsWith('{"path":')){
            const role=value.includes('"path":"'+f.contextRow+'"')?"context":
              value.includes('"path":"'+f.runtimeRow+'"')?"runtime":null;
            if(role){
              // Two completed tiny rows account for32MiB each in this ONLY
              // synthetic measurement. Existing names/separators/other rows
              // make the shared consumed total exceed64MiB on the second.
              const bytes=32*1024*1024;
              measurements.push({kind:"row",role,actual,reported:bytes});return bytes;
            }
          }
          return actual;
        };
        crypto.createHash=function(...args){
          const hash=createHash.apply(this,args),update=hash.update;
          hash.update=function(value,...options){
            const text=typeof value==="string"?value:Buffer.isBuffer(value)?value.toString("utf8"):"";
            if(f.mode==="metadata-name"&&text.includes('"path":"'+f.nameLimit+'"'))rowHashed=true;
            if(f.mode==="metadata-aggregate"&&text.includes('"path":"'+f.runtimeRow+'"'))rowHashed=true;
            return update.call(this,value,...options);
          };return hash;
        };
        syncBuiltinESMExports();
        let result;
        try{
          const observed=await captureReviewBatchCustody({...f.captureInput,deadline});
          result={rejected:false,sameContext:JSON.stringify(observed.custody.context)===JSON.stringify(baseline.custody.context),
            sameRuntime:JSON.stringify(observed.custody.runtime)===JSON.stringify(baseline.custody.runtime)};
        }catch(error){result={rejected:true,error:error.message};}
        finally{
          fs.readFileSync=readFile;fsp.readFile=readAsync;fs.createReadStream=stream;
          fs.readdirSync=readdir;fsp.readdir=readdirAsync;fsp.opendir=opendir;
          Buffer.byteLength=byteLength;crypto.createHash=createHash;syncBuiltinESMExports();
        }
        fs.writeFileSync(path.join(f.state,"result.json"),JSON.stringify({...result,wholeReads,streamReads,
          runtimeReadsAfterExpiry,laterReads,clockFault,contextCharged,runtimeCharged,measurements,rowHashed}));
      `;
      const child = spawn(process.execPath, ["--input-type=module", "--eval", worker, input],
        { detached: true, env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] });
      const stdout = [], stderr = [];
      child.stdout.on("data", bytes => stdout.push(bytes)); child.stderr.on("data", bytes => stderr.push(bytes));
      let outerExpired = false;
      const owned = () => {
        const file = path.join(state, "owned-pids.jsonl");
        return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
      };
      const stop = () => {
        for (const row of owned()) if (Number.isSafeInteger(row.pid) && row.pid > 1) {
          if (row.detached) try { process.kill(-row.pid, "SIGKILL"); } catch { /* Only this fixture's owned group. */ }
          try { process.kill(row.pid, "SIGKILL"); } catch { /* Already closed. */ }
        }
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* Owned worker already closed. */ }
      };
      const timer = setTimeout(() => { outerExpired = true; stop(); }, 35_000);
      t.after(() => { clearTimeout(timer); stop(); });
      let exit;
      try {
        exit = await new Promise((resolve, reject) => {
          child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
        });
      } finally { clearTimeout(timer); stop(); }
      const resultFile = path.join(state, "result.json");
      const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, "utf8")) : null;
      const cleanup = [{ pid: child.pid }, ...owned()].map(row => {
        try {
          const status = fs.readFileSync(`/proc/${row.pid}/status`, "utf8").match(/^State:\s+([A-Z])/m)?.[1];
          return { pid: row.pid, live: !["Z", "X"].includes(status) };
        } catch (error) { if (error.code === "ENOENT") return { pid: row.pid, live: false }; throw error; }
      });
      t.diagnostic(JSON.stringify({ mode, outerExpired, exit, result, cleanup,
        stderr: Buffer.concat(stderr).toString("utf8").slice(-2000), stdoutBytes: Buffer.concat(stdout).length }));
      assert.equal(outerExpired, false, "the public capture must return before owned containment");
      assert.equal(exit.code, 0, Buffer.concat(stderr).toString("utf8"));
      assert.ok(cleanup.every(row => !row.live), "every recorded owned worker/config process must be terminated");
      assert.ok(result, "the actual public capture must produce its retained result");
      if (mode === "whole-file") {
        assert.equal(result.rejected, false, "finite regular source payload must not use whole-file buffering");
        assert.equal(result.wholeReads, 0); assert.ok(result.streamReads > 0);
        assert.equal(result.sameContext, true); assert.equal(result.sameRuntime, true);
      } else if (mode === "shared-deadline" || mode === "stream-clock") {
        assert.equal(result.clockFault, true, "the explicitly synthetic elapsed-time boundary must actually occur");
        if (mode === "shared-deadline") {
          assert.equal(result.contextCharged, true); assert.equal(result.runtimeCharged, true);
        }
        assert.equal(result.rejected, true); assert.match(result.error, /deadline|expired|abort/i);
        assert.equal(result.runtimeReadsAfterExpiry, 0, "no later payload may start after the original shared deadline");
        if (mode === "stream-clock") assert.equal(result.laterReads, 0);
      } else {
        assert.equal(result.rejected, true, "metadata overflow must refuse, never publish a partial identity");
        assert.match(result.error, /metadata|acquisition|bound|limit|overflow/i);
        if (mode === "metadata-name") assert.ok(result.measurements.some(row => row.kind === "name"));
        else {
          assert.ok(result.measurements.some(row => row.role === "context"));
          assert.ok(result.measurements.some(row => row.role === "runtime"),
            "hashing/releasing context rows must not refund or renew the consumed allowance for runtime");
        }
        assert.equal(result.rowHashed, false, "the overflowing complete name/row must refuse before entering the tree hash");
      }
    });
  }
});

// The host/config capture is production code and a real physical CLI. Only
// invokeAttempt is inert: these controls grant no native model-positive credit.
for (const boundary of ["before", "after"]) for (const field of ["executable", "resolved-config", "environment", "cwd", "skills-link"]) {
  test(`actual corrective capture: ${field} mutation ${boundary} child two refuses`,
    { skip: process.platform !== "linux" || process.arch !== "x64" }, async (t) => {
    const { checked, f, binary, configFile, environment, captureInput, link, otherSkills } = actualCaptureFixture(t);
    const first = canonicalContextResponse(f, { omitSubmit: true }), second = canonicalContextResponse(f);
    const alternate = path.join(checked.env.RUNNER_TEMP, "alternate-cwd");
    if (field === "cwd") execFileSync("git", ["clone", "-q", "--no-hardlinks", checked.consumer, alternate]);
    const mutate = () => {
      if (field === "executable") fs.appendFileSync(binary, "x");
      if (field === "resolved-config") fs.writeFileSync(configFile, JSON.stringify({ username: "ChangedOwnedCaptureUser" }));
      if (field === "environment") environment.PATH += ":/owned-unselected-capture-path";
      if (field === "cwd") captureInput.cwd = alternate;
      if (field === "skills-link") { fs.unlinkSync(link); fs.symlinkSync(otherSkills, link); }
    };
    let attempts = 0, failure;
    try {
      await runReviewRecovery({ evidenceDirectory: checked.evidence, basePrompt: "Actual capture with inert attempt adapters.",
        submissionFile: f.submissionFile, reviewTools: f.tools, verifyReviewInvocation: f.verifier.verifyReviewInvocation,
        expectedContext: f.expectedContext,
        captureBatchHost: async ({ boundary: observedBoundary, attempt }) => {
          if (observedBoundary === boundary && attempt === 2) mutate();
          return captureReviewBatchCustody(captureInput);
        },
        invokeAttempt: async ({ attempt, responseFile, stderrFile }) => {
          attempts += 1;
          const data = attempt === 1 ? first : second;
          fs.writeFileSync(responseFile, data.response); fs.writeFileSync(stderrFile, "");
          if (attempt === 2) fs.writeFileSync(f.submissionFile, data.submission);
          return { exitCode: 0 };
        } });
    } catch (error) { failure = error; }
    assert.equal(attempts, boundary === "before" ? 1 : 2, `${field} must stop at the actual second-child boundary`);
    assert.match(failure?.message ?? "", /skill|custody|unsupported batch host|config capture/);
    const recovery = JSON.parse(fs.readFileSync(path.join(checked.evidence, "recovery.json")));
    assert.equal(recovery.accepted_invocation, null);
    assert.equal(recovery.custody_error.attempt, 2);
    assert.equal(recovery.custody_error.boundary, boundary);
  });
}

/** Existing physical capture and canonical owner; all child call frames are synthetic offline data. */
async function actualCustodyRegression(t, { prepare = () => {}, mutate = () => {},
  boundary = "after", attempt = 1, retry = false, firstKind = "missing", afterChild = () => {} } = {}) {
  const fixture = actualCaptureFixture(t);
  const { checked, f, captureInput } = fixture;
  prepare(fixture);
  const healthy = canonicalContextResponse(f);
  // The trace helper also returns candidate submission bytes. An omitted
  // submission must not persist them, exactly as in the existing caller fixture.
  let first = { response: canonicalContextResponse(f, { omitSubmit: true }).response };
  if (retry && firstKind === "missing") {
    assert.equal(f.verifier.verifyReviewInvocation(first.response, null, f.expectedContext).reason,
      "missing-review-submit", "the real owner must establish missing-submit retry eligibility");
  }
  if (firstKind === "stale") {
    const events = healthy.response.toString("utf8").trim().split("\n").map(JSON.parse);
    const last = events.pop();
    const read = structuredClone(events.find(event => event.part?.tool === "review_read_diff_chunk"));
    read.timestamp = last.timestamp; read.part.id = "synthetic-late-read"; read.part.callID = "synthetic-late-read";
    read.part.state.time = { start: last.timestamp, end: last.timestamp };
    last.timestamp += 1;
    first = { response: Buffer.from([...events, read, last].map(event => JSON.stringify(event)).join("\n") + "\n"),
      submission: healthy.submission };
    assert.equal(f.verifier.verifyReviewInvocation(first.response, first.submission, f.expectedContext).reason,
      "stale-review-coverage", "the real owner must establish stale retry eligibility");
  } else if (firstKind === "submit-json") {
    const events = first.response.toString("utf8").trim().split("\n").map(JSON.parse);
    const last = events.pop();
    const error = 'Invalid input for tool review_submit: JSON parsing failed: Text: {"summary":"unfinished' +
      "\nError message: JSON Parse error: Unterminated string";
    events.push({ type: "tool_use", timestamp: last.timestamp, sessionID: last.sessionID,
      part: { type: "tool", id: "synthetic-invalid-submit", callID: "synthetic-invalid-submit", sessionID: last.sessionID,
        tool: "invalid", state: { status: "completed", input: { tool: "review_submit", error },
          time: { start: last.timestamp, end: last.timestamp }, metadata: { truncated: false },
          output: `The arguments provided to the tool are invalid: ${error}` } } });
    last.timestamp += 1; events.push(last);
    first = { response: Buffer.from(events.map(event => JSON.stringify(event)).join("\n") + "\n") };
    assert.equal(f.verifier.verifyReviewInvocation(first.response, null, f.expectedContext).code,
      "unavailable-host-tool", "the real owner must refuse the original malformed submit transport");
  }
  let entered = 0, failure, result, changed = false;
  try {
    result = await runReviewRecovery({ evidenceDirectory: checked.evidence,
      basePrompt: "Synthetic physical-custody regression; no provider or review credit.",
      submissionFile: f.submissionFile, reviewTools: f.tools,
      verifyReviewInvocation: f.verifier.verifyReviewInvocation, expectedContext: f.expectedContext,
      captureBatchHost: async (point) => {
        if (point.boundary === boundary && point.attempt === attempt) {
          mutate(fixture); changed = true;
        }
        return captureReviewBatchCustody(captureInput);
      },
      invokeAttempt: async ({ attempt: childAttempt, responseFile, stderrFile }) => {
        entered += 1;
        const data = retry && childAttempt === 1 ? first : healthy;
        fs.writeFileSync(responseFile, data.response);
        fs.writeFileSync(stderrFile, `synthetic owned stderr ${childAttempt}\n`);
        if (data.submission) fs.writeFileSync(f.submissionFile, data.submission);
        const eventFile = path.join(checked.evidence, "review-events.jsonl");
        // The inert child must not open a planted FIFO: the assertion below
        // checks whether production refused the role BEFORE entering this child.
        if (!fs.existsSync(eventFile) || fs.lstatSync(eventFile).isFile()) {
          fs.appendFileSync(eventFile, JSON.stringify({ kind: "synthetic-owned-output", attempt: childAttempt }) + "\n");
        }
        afterChild(fixture, childAttempt);
        return { exitCode: 0 };
      } });
  } catch (error) { failure = error; }
  t.diagnostic(JSON.stringify({ entered, changed, accepted: Boolean(result?.accepted_invocation),
    failure: failure?.message ?? null }));
  return { ...fixture, entered, changed, failure, result };
}

for (const role of ["selected context", "context prefix sibling"]) {
  test(`actual context custody: ${role} mutation still stops after the actual child`,
    { skip: process.platform !== "linux" || process.arch !== "x64" }, async (t) => {
    let selected;
    const outcome = await actualCustodyRegression(t, {
      prepare: ({ checked, f }) => {
        selected = role === "selected context" ? path.join(f.context, "held-context.txt")
          : path.join(checked.consumer, ".review-context-extra/held-neighbor.txt");
        fs.mkdirSync(path.dirname(selected), { recursive: true }); fs.writeFileSync(selected, "held original bytes\n");
      },
      mutate: () => fs.writeFileSync(selected, "different post-child bytes\n") });
    assert.equal(outcome.entered, 1); assert.equal(outcome.changed, true);
    assert.match(outcome.failure?.message ?? "", /source|context|custody|input/i);
    assert.equal(outcome.result?.accepted_invocation, undefined);
  });
}

for (const scenario of ["untracked bytes", "ignored bytes", "immutable evidence neighbor", "new ignored input",
  "deleted input", "symlink input", "special input"]) {
  test(`actual custody regression: ${scenario} refuses after the actual child`,
    { skip: process.platform !== "linux" || process.arch !== "x64" }, async (t) => {
    const outcome = await actualCustodyRegression(t, {
      prepare: ({ checked }) => {
        fs.appendFileSync(path.join(checked.consumer, ".git/info/exclude"), "\nignored-custody.txt\n");
        const file = scenario === "immutable evidence neighbor"
          ? path.join(checked.evidence, "downloaded-support.txt")
          : path.join(checked.consumer, scenario.includes("ignored") ? "ignored-custody.txt" : "supporting.txt");
        if (scenario !== "new ignored input") fs.writeFileSync(file, "original input bytes\n");
      },
      mutate: ({ checked }) => {
        const file = scenario === "immutable evidence neighbor"
          ? path.join(checked.evidence, "downloaded-support.txt")
          : path.join(checked.consumer, scenario.includes("ignored") ? "ignored-custody.txt" : "supporting.txt");
        if (scenario === "deleted input") fs.unlinkSync(file);
        else if (scenario === "symlink input") {
          fs.unlinkSync(file);
          const target = path.join(checked.env.RUNNER_TEMP, "owned-link-target");
          fs.writeFileSync(target, "original input bytes\n"); fs.symlinkSync(target, file);
        } else if (scenario === "special input") {
          fs.unlinkSync(file); execFileSync("mkfifo", [file]);
        } else fs.writeFileSync(file, "modified input bytes\n");
      } });
    assert.equal(outcome.entered, 1, "the initial actual capture must succeed before input mutation");
    assert.equal(outcome.changed, true);
    assert.ok(outcome.failure, `${scenario} must not reach accepted_invocation`);
    assert.match(outcome.failure.message, /custody|untracked|input|regular|symlink|special/i);
    assert.equal(outcome.result?.accepted_invocation, undefined);
  });
}

for (const name of ["recovery.json", "model-response-attempt-1.txt", "model-response-attempt-2.txt",
  "opencode-stderr-attempt-1.log", "opencode-stderr-attempt-2.log", "submission.json", "submission-attempt-1.json",
  "review-submit-json-attempt-1.DERIVED.ndjson", "review-submit-json-attempt-1.OMITTED.ndjson",
  "final-input-coverage-attempt-1.DERIVED.ndjson", "final-input-coverage-attempt-1.OMITTED.ndjson", "review-events.jsonl"]) {
  test(`actual custody regression: preplanted owned output ${name} refuses before child`,
    { skip: process.platform !== "linux" || process.arch !== "x64" }, async (t) => {
    const outcome = await actualCustodyRegression(t, {
      prepare: ({ checked }) => fs.writeFileSync(path.join(checked.evidence, name), "preplanted owned-fixture bytes\n") });
    assert.equal(outcome.entered, 0, "existing input must not become a fresh mutable output");
    assert.ok(outcome.failure);
    assert.match(outcome.failure.message, /pre-existing|preexisting|output|custody/i);
  });
}

for (const kind of ["dangling response symlink", "projection symlink", "special event output"]) {
  test(`actual custody regression: ${kind} refuses before child`,
    { skip: process.platform !== "linux" || process.arch !== "x64" }, async (t) => {
    const outcome = await actualCustodyRegression(t, {
      prepare: ({ checked }) => {
        const target = path.join(checked.env.RUNNER_TEMP, "owned-output-target");
        if (kind === "special event output") execFileSync("mkfifo", [path.join(checked.evidence, "review-events.jsonl")]);
        else {
          if (kind === "projection symlink") fs.writeFileSync(target, "owned target\n");
          fs.symlinkSync(target, path.join(checked.evidence, kind === "projection symlink"
            ? "review-submit-json-attempt-1.DERIVED.ndjson" : "model-response-attempt-1.txt"));
        }
      } });
    assert.equal(outcome.entered, 0, "nonregular output roles must refuse before the child adapter");
    assert.ok(outcome.failure);
    assert.match(outcome.failure.message, /pre-existing|preexisting|output|custody|regular|symlink|special/i);
  });
}

for (const [name, firstKind] of [["response", "missing"], ["stderr", "missing"], ["retained submission", "stale"],
  ["derived submit projection", "submit-json"], ["omitted submit projection", "submit-json"],
  ["event prefix", "missing"], ["raw recovery", "missing"]]) {
  test(`actual custody regression: sealed prior ${name} change refuses before corrective child`,
    { skip: process.platform !== "linux" || process.arch !== "x64" }, async (t) => {
    const outcome = await actualCustodyRegression(t, { retry: true, firstKind, boundary: "before", attempt: 2,
      mutate: ({ checked }) => {
        const names = { response: "model-response-attempt-1.txt", stderr: "opencode-stderr-attempt-1.log",
          "retained submission": "submission-attempt-1.json",
          "derived submit projection": "review-submit-json-attempt-1.DERIVED.ndjson",
          "omitted submit projection": "review-submit-json-attempt-1.OMITTED.ndjson",
          "event prefix": "review-events.jsonl", "raw recovery": "recovery.json" };
        const file = path.join(checked.evidence, names[name]);
        assert.ok(fs.lstatSync(file).isFile(), "the existing producer must have created the prior artifact");
        if (name === "event prefix") fs.writeFileSync(file, "rewritten prefix\n");
        else fs.appendFileSync(file, " \n");
      } });
    assert.equal(outcome.changed, true, "the actual first attempt must reach its admitted recovery boundary");
    assert.equal(outcome.entered, 1, "changed sealed bytes must stop before child two");
    assert.ok(outcome.failure);
    assert.match(outcome.failure.message, /custody|changed|output|recovery|retained|prefix/i);
    assert.equal(outcome.result?.accepted_invocation, undefined);
    const raw = fs.readFileSync(path.join(outcome.checked.evidence, "recovery.json"));
    if (name === "raw recovery") {
      assert.ok(raw.toString("utf8").endsWith(" \n"), "untrusted raw recovery drift must not be overwritten");
    } else {
      const retained = JSON.parse(raw);
      assert.equal(retained.accepted_invocation, null);
      assert.equal(retained.custody_error.boundary, "before");
      assert.equal(retained.custody_error.attempt, 2);
    }
  });
}

for (const boundary of ["before", "after"]) for (const name of ["response", "event prefix"]) {
  test(`actual custody refusal metadata: ${name} at initial ${boundary} output check is retained`,
    { skip: process.platform !== "linux" || process.arch !== "x64" }, async (t) => {
    let changed = false;
    let metadataFile;
    const originalWrite = fs.writeFileSync;
    const mutate = checked => {
      const file = path.join(checked.evidence, name === "response"
        ? "model-response-attempt-1.txt" : "review-events.jsonl");
      assert.ok(fs.lstatSync(file).isFile(), "the prior attempt must create the real sealed role");
      if (name === "event prefix") originalWrite(file, "rewritten owned event prefix\n");
      else fs.appendFileSync(file, "changed sealed response\n");
      changed = true;
    };
    let fixtureChecked;
    // The actual supervisor write completes first. This injects only an owned
    // file fault between its retry decision and the next public boundary.
    fs.writeFileSync = function (file, bytes, ...options) {
      const result = originalWrite.call(this, file, bytes, ...options);
      if (boundary === "before" && !changed && file === metadataFile) {
        const record = JSON.parse(bytes.toString());
        if (record.recovery_reason === "missing_review_submit") mutate(fixtureChecked);
      }
      return result;
    };
    t.after(() => { fs.writeFileSync = originalWrite; });
    let outcome;
    try {
      outcome = await actualCustodyRegression(t, { retry: true, boundary: "unused",
        prepare: ({ checked }) => {
          fixtureChecked = checked;
          metadataFile = path.join(checked.evidence, "recovery.json");
        },
        afterChild: ({ checked }, attempt) => { if (boundary === "after" && attempt === 2) mutate(checked); } });
    } finally { fs.writeFileSync = originalWrite; }
    assert.equal(changed, true, "the fault must occur after a genuine first-attempt seal");
    assert.equal(outcome.entered, boundary === "before" ? 1 : 2);
    assert.match(outcome.failure?.message ?? "", /custody|sealed|prefix|changed/);
    const recovery = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
    assert.equal(recovery.accepted_invocation, null);
    assert.equal(recovery.custody_error?.boundary, boundary, "output-check refusal must retain its actual boundary");
    assert.equal(recovery.custody_error?.attempt, 2, "output-check refusal must retain its actual attempt");
  });
}

test("actual custody refusal metadata: final accepted check revokes the persisted acceptance",
  { skip: process.platform !== "linux" || process.arch !== "x64" }, async (t) => {
  const { checked, f, captureInput } = actualCaptureFixture(t);
  const healthy = canonicalContextResponse(f);
  const metadataFile = path.join(checked.evidence, "recovery.json");
  const originalWrite = fs.writeFileSync;
  let injected = false, acceptance, failure, entered = 0;
  fs.writeFileSync = function (file, bytes, ...options) {
    const result = originalWrite.call(this, file, bytes, ...options);
    if (file === metadataFile && !injected) {
      const actual = JSON.parse(fs.readFileSync(file, "utf8"));
      if (actual.accepted_invocation) {
        // Exact real-write boundary: do not mutate recovery itself or replace
        // the verifier. The original accepted record remains held/trusted.
        acceptance = structuredClone(actual.accepted_invocation);
        injected = true;
        fs.appendFileSync(path.join(checked.evidence, "opencode-stderr-attempt-1.log"), "post-acceptance owned fault\n");
      }
    }
    return result;
  };
  t.after(() => { fs.writeFileSync = originalWrite; });
  try {
    await runReviewRecovery({ evidenceDirectory: checked.evidence,
      basePrompt: "Synthetic accepted-boundary fault; no model/provider/publication.",
      submissionFile: f.submissionFile, reviewTools: f.tools,
      verifyReviewInvocation: f.verifier.verifyReviewInvocation, expectedContext: f.expectedContext,
      captureBatchHost: () => captureReviewBatchCustody(captureInput),
      invokeAttempt: async ({ responseFile, stderrFile }) => {
        entered += 1;
        fs.writeFileSync(responseFile, healthy.response); fs.writeFileSync(stderrFile, "owned original stderr\n");
        fs.writeFileSync(f.submissionFile, healthy.submission);
        return { exitCode: 0 };
      } });
  } catch (error) { failure = error; }
  finally { fs.writeFileSync = originalWrite; }
  assert.equal(entered, 1);
  assert.equal(injected, true, "the actual canonical attempt must persist acceptance before the fault");
  assert.match(failure?.message ?? "", /custody|sealed|changed/);
  const recovery = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
  assert.equal(recovery.accepted_invocation, null, "failed final custody cannot retain an accepted invocation");
  assert.deepEqual(recovery.rejected_accepted_invocation, acceptance);
  assert.equal(recovery.custody_error?.boundary, "accepted");
  assert.equal(recovery.custody_error?.attempt, 1);
  assert.equal(parseOutput(f.output).review_invocation_sha256, undefined);
});

/** Public CLI with real discovery/custody; only the owned model process and clock are synthetic. */
async function actualModelDeadlineRegression(t, { mode, minutes = 60, explicit = true, elapsedMinutes = 0 } = {}) {
  const { checked, f, binary, environment, captureInput } = actualCaptureFixture(t);
  fs.rmSync(checked.invocation, { force: true });
  const state = path.join(checked.env.RUNNER_TEMP, "owned-model-deadline");
  fs.mkdirSync(state, { mode: 0o700 });
  const batches = ["tracked", "unchanged", "hang", "helper", "setup-expired", "reserve", "post-before"].includes(mode);
  const tools = batches ? [...f.tools, "review_read_diff_batch", "review_assess_diff_batch"] : f.tools;
  fs.writeFileSync(f.registryFile, tools.join("\n") + "\n");
  const expectedContext = f.verifier.prepareReviewInvocationContext(f.full,
    fs.readFileSync(path.join(checked.evidence, "input-manifest.json")), tools,
    f.submissionFile, f.contextBytes, f.contextFile);
  const first = canonicalContextResponse({ ...f, tools, expectedContext }, { omitSubmit: true });
  const firstVerdict = mode === "retry" ? f.verifier.verifyReviewInvocation(first.response, null, expectedContext) : null;
  for (const [name, bytes] of [["agents/github-reviewer.md", "---\nmode: primary\n---\nOwned inert model fault fixture.\n"],
    ["plugins/eta-mu-actors.js", "// Owned inert carrier; no model or provider plugin.\n"]]) {
    const file = path.join(environment.HOME, ".config/opencode", name);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
  }
  // Complete the real CLI's ordinary first-use config normalization before
  // the held discovery baseline; normalization is not the fault under test.
  await captureReviewBatchCustody(captureInput);
  const runner = path.join(f.context, "machinery/run-opencode-review-recovery.mjs");
  fs.copyFileSync(path.join(root, ".github/scripts/run-opencode-review-recovery.mjs"), runner);
  const preload = path.join(state, "preload.mjs"), input = path.join(state, "input.json");
  const selected = { id: "mimo-v9.1-flash-free", family: "mimo", status: "active", release_date: "2027-01-01",
    name: "Synthetic offline deadline control", attachment: false, reasoning: false, temperature: true,
    last_updated: "2027-01-01", tool_call: true, modalities: { input: ["text"], output: ["text"] },
    cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, limit: { context: 131072, output: 2048 } };
  const catalog = { opencode: { id: "opencode", name: "Owned offline fixture", env: ["OPENCODE_API_KEY"],
    doc: "https://example.invalid/fixture", api: "https://example.invalid/v1", npm: "@ai-sdk/openai-compatible",
    models: { [selected.id]: selected } } };
  const tracked = path.join(checked.consumer, "tracked.txt");
  const originalTracked = fs.readFileSync(tracked);
  const startingHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: checked.consumer, encoding: "utf8" }).trim();
  const startingWorking = transportSha256(execFileSync("git", ["diff", "--no-ext-diff", "--binary", "HEAD"], { cwd: checked.consumer }));
  fs.writeFileSync(input, JSON.stringify({ state, binary, mode, minutes, elapsedMinutes, tracked,
    catalog, first: first.response.toString("utf8"), startingHead, startingWorking }));
  fs.writeFileSync(preload, String.raw`
    import fs from "node:fs";
    import cp from "node:child_process";
    import path from "node:path";
    import { syncBuiltinESMExports } from "node:module";
    const f = JSON.parse(fs.readFileSync(process.env.OWNED_MODEL_FAULT_INPUT,"utf8"));
    const spawn = cp.spawn, realNow = Date.now, realPerformanceNow = performance.now.bind(performance);
    const realSetTimeout = globalThis.setTimeout;
    let offset = 0, entered = 0, postBeforeJump = false;
    Date.now = () => realNow() + offset;
    Object.defineProperty(performance,"now",{value:()=>realPerformanceNow()+offset});
    // This is a synthetic clock, not a smaller production allowance. Retain
    // every requested long timer; advance both clocks only when it actually fires.
    globalThis.setTimeout = (callback,delay,...args) => {
      if (entered && delay > 30_000) {
        fs.appendFileSync(path.join(f.state,"timers.jsonl"),JSON.stringify({delay,attempt:entered})+"\n");
        return realSetTimeout(()=>{offset+=delay;callback(...args);},500);
      }
      return realSetTimeout(callback,delay,...args);
    };
    const write = fs.writeFileSync;
    fs.writeFileSync = function(file,bytes,...options) {
      const result=write.call(this,file,bytes,...options);
      if (f.mode === "post-before" && !postBeforeJump &&
          file === path.join(process.env.REVIEW_EVIDENCE_DIR,"recovery.json")) {
        const held=JSON.parse(bytes.toString()), captures=held.batch_custody?.captures;
        if (captures?.length === 1 && captures[0].boundary === "before" &&
            captures[0].attempt === 1 && held.attempts.length === 0 && !held.custody_error) {
          // Advance only AFTER the real successful before-capture write, after
          // its final time check and immediately before the model adapter entry.
          postBeforeJump=true;offset+=61*60_000;
          write(path.join(f.state,"elapsed.json"),JSON.stringify({phase:"after-before-write",offset,now:Date.now()}));
        }
      }
      if (["setup-expired","reserve"].includes(f.mode) &&
          file === path.join(process.env.REVIEW_EVIDENCE_DIR,"model-discovery.json") &&
          JSON.parse(bytes.toString()).status === "selected") {
        // The actual discovery owner has completed, outside its30s acquisition
        // deadline. Do not turn this into a catalog-deadline negative instead.
        offset+=f.elapsedMinutes*60_000;
        write(path.join(f.state,"elapsed.json"),JSON.stringify({offset,now:Date.now(),
          remainingMs:f.minutes*60_000-(Date.now()-Number(process.env.REVIEW_JOB_STARTED_AT_MS))}));
      }
      return result;
    };
    globalThis.fetch = async (url,options) => {
      if (url !== "https://models.opencode.ai/api.json" || options.credentials !== "omit")
        throw Error("unexpected offline catalog request");
      if (f.mode === "tracked") {
        fs.appendFileSync(f.tracked,"changed during actual asynchronous discovery\n");
        fs.writeFileSync(path.join(f.state,"tracked-changed"),"changed");
      }
      const response = new Response(JSON.stringify(f.catalog),{status:200});
      Object.defineProperty(response,"url",{value:url});return response;
    };
    cp.spawn = (binary,args,options) => {
      if (binary !== f.binary || args[0] !== "run") return spawn(binary,args,options);
      entered += 1;
      fs.appendFileSync(path.join(f.state,"launches.jsonl"),JSON.stringify({attempt:entered,args,
        binary,detached:options.detached ?? false,now:Date.now(),monotonic:performance.now()})+"\n");
      const pidFile=path.join(f.state,"fault-"+entered+".pid"), helperFile=path.join(f.state,"helper-"+entered+".pid");
      const helper='const fs=require("node:fs");process.on("SIGTERM",()=>{});'+
        'fs.writeFileSync('+JSON.stringify(helperFile)+',String(process.pid));setInterval(()=>{},1000);';
      const code = f.mode === "hang" || f.mode === "helper"
        ? 'const fs=require("node:fs"),cp=require("node:child_process");'+
          'process.on("SIGTERM",()=>fs.appendFileSync('+JSON.stringify(path.join(f.state,"term"))+',"TERM\\n"));'+
          'fs.writeFileSync('+JSON.stringify(pidFile)+',String(process.pid));'+
          (f.mode === "helper" ? 'cp.spawn(process.execPath,["-e",'+JSON.stringify(helper)+'],{stdio:["ignore",1,2]});'+
            'const ready=setInterval(()=>{if(fs.existsSync('+JSON.stringify(helperFile)+')){clearInterval(ready);process.exit(0);}},10);'
            : 'setInterval(()=>{},1000);')
        : 'const fs=require("node:fs");fs.writeFileSync('+JSON.stringify(pidFile)+',String(process.pid));'+
          (f.mode === "retry" && entered === 1 ? 'process.stdout.write('+JSON.stringify(f.first)+');'
            : 'process.stderr.write("owned model fault exits without a review\\n");process.exitCode=1;');
      const child=spawn(process.execPath,["-e",code],options);
      if(f.mode === "retry" && entered === 1) child.once("close",()=>{
        offset+=f.elapsedMinutes*60_000;
        fs.writeFileSync(path.join(f.state,"elapsed.json"),JSON.stringify({offset,now:Date.now()}));
      });
      return child;
    };
    syncBuiltinESMExports();
  `);
  const env = { PATH: process.env.PATH, HOME: checked.env.RUNNER_TEMP, PR_NUMBER: "42",
    OPENCODE_BIN: binary, REVIEW_MODEL_DISCOVERY: "opencode-free-mimo-flash-v1", REVIEW_EXPECTED_OPENCODE_VERSION: nativeBatchVersion,
    REVIEW_CHILD_HOME: environment.HOME, REVIEW_CHILD_RUNTIME: captureInput.runtimeDirectory,
    REVIEW_EVIDENCE_DIR: checked.evidence, REVIEW_PROMPT_FILE: captureInput.promptFile,
    REVIEW_TOOL_REGISTRY_FILE: f.registryFile, REVIEW_INVOCATION_VERIFIER_FILE: f.verifierFile,
    GITHUB_OUTPUT: f.output, OWNED_MODEL_FAULT_INPUT: input,
    // Synthetic trusted job-anchor/selected-budget data for this owned fixture.
    // Actual hosted anchor acquisition remains an unapplied main-owned choice.
    REVIEW_JOB_STARTED_AT_MS: String(Date.now()),
    ...(explicit ? { REVIEW_TIMEOUT_MINUTES: String(minutes) } : {}) };
  const child = spawn(process.execPath,["--import",preload,runner],{
    cwd:checked.consumer,env,detached:true,stdio:["ignore","pipe","pipe"] });
  const stdout=[],stderr=[];
  child.stdout.on("data",bytes=>stdout.push(bytes)); child.stderr.on("data",bytes=>stderr.push(bytes));
  const live = pid => {
    try { return !["Z","X"].includes(fs.readFileSync(`/proc/${pid}/status`,"utf8").match(/^State:\s+([A-Z])/m)?.[1]); }
    catch(error) { if(error.code === "ENOENT")return false;throw error; }
  };
  const ownedPids = () => [child.pid,...(fs.existsSync(state)?fs.readdirSync(state):[]).filter(name=>/^(fault|helper)-\d+\.pid$/.test(name))
    .map(name=>Number(fs.readFileSync(path.join(state,name),"utf8")))];
  const stop=()=>{for(const pid of ownedPids()){
    if(!Number.isSafeInteger(pid)||pid<=1)continue;
    try{process.kill(-pid,"SIGKILL");}catch{}
    try{process.kill(pid,"SIGKILL");}catch{}
  }};
  let outerExpired=false,exit;
  const timer=setTimeout(()=>{outerExpired=true;stop();},12_000);
  t.after(()=>{clearTimeout(timer);stop();});
  try {exit=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",(code,signal)=>resolve({code,signal}));});}
  finally {clearTimeout(timer);stop();}
  // Give only owned orphan processes time to report their terminated state.
  for(let n=0;n<50 && ownedPids().some(live);n+=1) await new Promise(resolve=>setTimeout(resolve,10));
  const cleanup=ownedPids().map(pid=>({pid,live:live(pid)}));
  const readJson=name=>fs.existsSync(path.join(state,name))?JSON.parse(fs.readFileSync(path.join(state,name),"utf8")):null;
  const launches=fs.existsSync(path.join(state,"launches.jsonl"))?fs.readFileSync(path.join(state,"launches.jsonl"),"utf8").trim().split("\n").filter(Boolean).map(JSON.parse):[];
  const recoveryFile=path.join(checked.evidence,"recovery.json");
  const recovery=fs.existsSync(recoveryFile)?JSON.parse(fs.readFileSync(recoveryFile,"utf8")):null;
  const outcome={mode,minutes,explicit,elapsedMinutes,exit,outerExpired,launches,cleanup,recovery,firstVerdict,
    changed:fs.existsSync(path.join(state,"tracked-changed")),elapsed:readJson("elapsed.json"),
    discoveryStatus:fs.existsSync(path.join(checked.evidence,"model-discovery.json"))
      ? JSON.parse(fs.readFileSync(path.join(checked.evidence,"model-discovery.json"),"utf8")).status : null,
    helperStarted:fs.readdirSync(state).some(name=>/^helper-\d+\.pid$/.test(name)),
    timers:fs.existsSync(path.join(state,"timers.jsonl"))?fs.readFileSync(path.join(state,"timers.jsonl"),"utf8"):"",
    stdout:Buffer.concat(stdout).toString("utf8"),stderr:Buffer.concat(stderr).toString("utf8"),
    output:parseOutput(f.output),startingHead,startingWorking,
    ...(mode === "post-before" ? { retainedCaptures: ["model-response-attempt-1.txt","opencode-stderr-attempt-1.log"].map(name => {
      const file=path.join(checked.evidence,name), exists=fs.existsSync(file), bytes=exists?fs.readFileSync(file):null;
      return {name,exists,bytes:bytes?.length ?? null,sha256:bytes?transportSha256(bytes):null};
    }) } : {})};
  if(process.env.ETA_MU_NATIVE_PROOF_DIR){
    const retained=path.join(process.env.ETA_MU_NATIVE_PROOF_DIR,`model-${mode}-${explicit?minutes:"default"}-${elapsedMinutes}`);
    fs.mkdirSync(retained,{recursive:true,mode:0o700});
    for(const [name,bytes] of [["outcome.json",JSON.stringify(outcome,null,2)+"\n"],
      ["preload.mjs",fs.readFileSync(preload)],["input.json",fs.readFileSync(input)]])
      fs.writeFileSync(path.join(retained,name),bytes,{mode:0o600});
    for(const name of ["model-discovery.json","recovery.json","model-response-attempt-1.txt","model-response-attempt-2.txt",
      "opencode-stderr-attempt-1.log","opencode-stderr-attempt-2.log"]){
      const file=path.join(checked.evidence,name);if(fs.existsSync(file))fs.writeFileSync(path.join(retained,name),fs.readFileSync(file),{mode:0o600});
    }
  }
  // Restore only this fixture's known fault after its final observation.
  fs.writeFileSync(tracked,originalTracked);
  t.diagnostic(JSON.stringify({mode,minutes,explicit,elapsedMinutes,outerExpired,exit,launches:launches.length,
    changed:outcome.changed,helperStarted:outcome.helperStarted,cleanup,
    captures:recovery?.batch_custody?.captures?.map(row=>`${row.boundary}:${row.attempt}`),
    attempts:recovery?.attempts?.map(row=>({attempt:row.attempt,state:row.invocation_state,error:row.invocation_error})),
    error:outcome.stderr.slice(-1500)}));
  assert.ok(cleanup.every(row=>!row.live),"every owned model fault/worker must be terminated after containment");
  return outcome;
}

for(const mode of ["unchanged","tracked"]){
  test(`actual model custody RED: ${mode} tracked baseline across discovery`,
    {timeout:20_000,skip:process.platform!=="linux"||process.arch!=="x64"},async t=>{
      const result=await actualModelDeadlineRegression(t,{mode});
      assert.equal(result.outerExpired,false,"ordinary discovery must finish without containment");
      assert.equal(result.changed,mode==="tracked","the real tracked-file fault must occur inside discovery");
      assert.equal(result.launches.length,mode==="tracked"?0:1,"changed pre-discovery Git identity must refuse before model entry");
      if(mode==="tracked"){
        assert.match(result.stderr,/source|custody|Git|tracked/i);
        assert.equal(result.recovery?.accepted_invocation,null);
      }else{
        assert.deepEqual(result.recovery.batch_custody.captures.map(row=>`${row.boundary}:${row.attempt}`),["before:1","after:1"]);
        assert.equal(result.recovery.batch_custody.original.custody.git_head,result.startingHead);
        assert.equal(result.recovery.batch_custody.original.custody.git_working_sha256,result.startingWorking);
      }
    });
}

for(const mode of ["hang","helper"]){
  test(`actual model deadline RED: ${mode} terminates before owned containment`,
    {timeout:45_000,skip:process.platform!=="linux"||process.arch!=="x64"},async t=>{
      const result=await actualModelDeadlineRegression(t,{mode});
      assert.equal(result.launches.length,1,"the public model adapter must actually enter its owned fault");
      if(mode==="helper")assert.equal(result.helperStarted,true,"a pipe-holding descendant must actually start");
      assert.equal(result.outerExpired,false,"the model supervisor must terminate/reap before outer containment");
      assert.equal(result.recovery?.accepted_invocation,null);
      assert.deepEqual(result.recovery.batch_custody.captures.map(row=>`${row.boundary}:${row.attempt}`),["before:1","after:1"]);
      assert.equal(result.recovery.attempts.length,1);
      assert.equal(result.recovery.attempts[0].invocation_state,"rejected");
      assert.match(result.recovery.attempts[0].invocation_error,/deadline|timed? ?out|signal|descendant|process group/i);
      assert.equal(result.output.review_invocation_sha256,undefined);
    });
}

for(const [minutes,explicit,elapsedMinutes,expected] of [[60,false,61,1],[120,true,61,2],[120,true,121,1],[180,true,181,1]]){
  test(`actual model shared budget RED: ${explicit?minutes:"default60"} minutes after ${elapsedMinutes} elapsed`,
    {timeout:20_000,skip:process.platform!=="linux"||process.arch!=="x64"},async t=>{
      const result=await actualModelDeadlineRegression(t,{mode:"retry",minutes,explicit,elapsedMinutes});
      assert.equal(result.outerExpired,false);
      assert.ok(result.elapsed,"the actual first child must close before the synthetic elapsed-time fault");
      assert.equal(result.firstVerdict.reason,"missing-review-submit","the actual owner must establish the first trace's omission independently of deadline refusal");
      if(expected===2)assert.equal(result.recovery?.recovery_reason,"missing_review_submit","an in-budget omission must retain the existing retry decision");
      assert.equal(result.launches.length,expected,"attempt two must share the selected whole-job deadline, without a reset or hardcoded60");
      assert.equal(result.recovery.max_attempts,2);
      assert.equal(result.recovery.accepted_invocation,null);
      assert.equal(result.output.review_invocation_sha256,undefined);
    });
}

for(const [mode,elapsedMinutes] of [["setup-expired",61],["reserve",60-20/60]]){
  test(`actual model prelaunch budget RED: ${mode} refuses before the first child`,
    {timeout:20_000,skip:process.platform!=="linux"||process.arch!=="x64"},async t=>{
      const result=await actualModelDeadlineRegression(t,{mode,elapsedMinutes});
      assert.equal(result.outerExpired,false);
      assert.equal(result.discoveryStatus,"selected","the real discovery must complete before the clock fault");
      assert.ok(result.elapsed,"the trusted synthetic elapsed fault must actually occur");
      if(mode==="reserve")assert.ok(result.elapsed.remainingMs>0 && result.elapsed.remainingMs<30_000,
        "time remains, but less than even one existing30s final capture allocation");
      else assert.ok(result.elapsed.remainingMs<0,"the same selected whole-job allocation must actually be exhausted");
      assert.equal(result.launches.length,0,"insufficient whole-job time must refuse before any model child");
      assert.equal(result.recovery?.attempts.length,0,"a prelaunch refusal cannot invent an attempted child");
      assert.equal(result.recovery.accepted_invocation,null);
      assert.match(result.stderr,/deadline|budget|remaining|reserve/i);
      assert.equal(result.output.review_invocation_sha256,undefined);
    });
}

test("actual model post-before clock boundary: refusal retains the deadline without a child or ENOENT",
  {timeout:45_000,skip:process.platform!=="linux"||process.arch!=="x64"},async t=>{
    const result=await actualModelDeadlineRegression(t,{mode:"post-before"});
    assert.equal(result.outerExpired,false);
    assert.equal(result.exit.code,1);
    assert.equal(result.discoveryStatus,"selected");
    assert.equal(result.elapsed?.phase,"after-before-write","the clock fault must follow the real successful before-capture write");
    assert.equal(result.launches.length,0,"the expired adapter entry must not spawn a model child");
    assert.deepEqual(result.recovery.batch_custody.captures.map(row=>`${row.boundary}:${row.attempt}`),["before:1","after:1"]);
    assert.equal(result.recovery.accepted_invocation,null);
    assert.equal(result.recovery.attempts.length,1,"retain the rejected adapter entry without inventing a launched child");
    const attempt=result.recovery.attempts[0];
    assert.equal(attempt.invocation_state,"rejected");
    assert.equal(attempt.verification_state,"not-run-invocation-rejected");
    assert.match(attempt.invocation_error,/deadline/i);
    assert.doesNotMatch(attempt.invocation_error,/ENOENT/);
    assert.doesNotMatch(result.stderr,/ENOENT/);
    for(const capture of result.retainedCaptures){
      assert.equal(capture.exists,true,"recordAttempt must retain actual owned capture files before hashing");
      assert.equal(capture.bytes,0);
      assert.equal(capture.sha256,transportSha256(Buffer.alloc(0)));
      assert.equal(capture.sha256,capture.name.startsWith("model-response")?attempt.response_sha256:attempt.stderr_sha256);
    }
    assert.equal(result.output.review_invocation_sha256,undefined);
  });

for (const command of ["--version", "models"]) for (const descendant of [false, true]) {
  test(`actual discovery deadline: ${command} TERM-resistant ${descendant ? "descendant" : "child"} closes before containment`,
    { timeout: 45_000, skip: process.platform !== "linux" || process.arch !== "x64" }, async (t) => {
    const { checked, binary, environment } = actualCaptureFixture(t);
    const state = path.join(checked.env.RUNNER_TEMP, "owned-discovery-fault");
    fs.mkdirSync(state, { mode: 0o700 });
    const input = path.join(state, "input.json");
    fs.writeFileSync(input, JSON.stringify({ state, binary, environment, command, descendant,
      evidenceDirectory: checked.evidence, expectedVersion: nativeBatchVersion,
      runner: path.join(root, ".github/scripts/run-opencode-review-recovery.mjs") }));
    // Same isolated child-process fault approach as the config deadline tests:
    // retain the real selected binary and public discovery arguments/options.
    // Only the owned faulting process is substituted; no model/provider runs.
    const worker = String.raw`
      import fs from "node:fs";
      import cp from "node:child_process";
      import path from "node:path";
      import { syncBuiltinESMExports } from "node:module";
      import { pathToFileURL } from "node:url";
      const f = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const pidFile = path.join(f.state,"fault.pid"), descendantFile = path.join(f.state,"descendant.pid");
      const grandchild = 'const fs=require("node:fs");process.on("SIGTERM",()=>{});' +
        'fs.writeFileSync(' + JSON.stringify(descendantFile) + ',String(process.pid));setInterval(()=>{},1000);';
      const trap = 'const fs=require("node:fs"),cp=require("node:child_process");' +
        'process.on("SIGTERM",()=>{fs.appendFileSync(' + JSON.stringify(path.join(f.state,"term")) + ',"TERM\\n");' +
          (f.descendant ? 'process.exit(0);' : '') + '});' +
        'fs.writeFileSync(' + JSON.stringify(pidFile) + ',String(process.pid));' +
        (f.descendant ? 'cp.spawn(process.execPath,["-e",' + JSON.stringify(grandchild) + '],{stdio:["ignore",1,2]});' : '') +
        'fs.writeFileSync(' + JSON.stringify(path.join(f.state,"ready")) + ',"ready");setInterval(()=>{},1000);';
      const original = cp.spawn;
      cp.spawn = (binary,args,options) => {
        if (binary !== f.binary) throw Error("unexpected discovery binary");
        const target = f.command === "--version" ? ["--version"] : ["models","opencode","--verbose"];
        if (JSON.stringify(args) !== JSON.stringify(target)) {
          if (f.command === "models" && JSON.stringify(args) === '["--version"]') return original(binary,args,options);
          throw Error("unexpected discovery command");
        }
        fs.writeFileSync(path.join(f.state,"launch.json"),JSON.stringify({binary,args,detached:options.detached ?? false}));
        return original(process.execPath,["-e",trap],options);
      };
      syncBuiltinESMExports();
      // The existing bounded raw-catalog acquisition uses inert bytes. This
      // reaches the actual models launch without any external network request.
      globalThis.fetch = async (url,options) => {
        if (url !== "https://models.opencode.ai/api.json" || options.credentials !== "omit")
          throw Error("unexpected discovery fixture fetch");
        const response = new Response(JSON.stringify({opencode:{id:"opencode",models:{}}}),{status:200});
        Object.defineProperty(response,"url",{value:url});return response;
      };
      const { discoverFreeMiMoFlash } = await import(pathToFileURL(f.runner).href);
      const alive = file => {
        if (!fs.existsSync(file)) return false;
        const pid = Number(fs.readFileSync(file,"utf8"));
        try {
          process.kill(pid,0);
          const state = fs.readFileSync('/proc/' + pid + '/status',"utf8").match(/^State:\s+([A-Z])/m)?.[1];
          if (!state) throw Error("owned discovery process state unavailable");
          return state !== "Z" && state !== "X";
        } catch (error) { if (["ESRCH","ENOENT"].includes(error.code)) return false; throw error; }
      };
      let result;
      try {
        await discoverFreeMiMoFlash({evidenceDirectory:f.evidenceDirectory,binary:f.binary,
          environment:f.environment,expectedVersion:f.expectedVersion});
        result = {rejected:false};
      } catch (error) { result = {rejected:true,error:error.message}; }
      const proofFile = path.join(f.evidenceDirectory,"model-discovery.json");
      fs.writeFileSync(path.join(f.state,"result.json"),JSON.stringify({...result,
        faultAlive:alive(pidFile),descendantAlive:alive(descendantFile),
        proof:fs.existsSync(proofFile) ? JSON.parse(fs.readFileSync(proofFile,"utf8")) : null}));
    `;
    const child = spawn(process.execPath, ["--input-type=module", "--eval", worker, input],
      { detached: true, env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    child.stdout.on("data", bytes => stdout.push(bytes)); child.stderr.on("data", bytes => stderr.push(bytes));
    let outerExpired = false;
    const stop = () => {
      for (const name of ["fault.pid", "descendant.pid"]) {
        const file = path.join(state, name);
        if (!fs.existsSync(file)) continue;
        const pid = Number(fs.readFileSync(file, "utf8"));
        if (!Number.isSafeInteger(pid) || pid <= 1) continue;
        try { process.kill(-pid, "SIGKILL"); } catch { /* Only an owned group, if detached. */ }
        try { process.kill(pid, "SIGKILL"); } catch { /* Already terminated. */ }
      }
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already closed. */ }
    };
    const timer = setTimeout(() => { outerExpired = true; stop(); }, 35_000);
    t.after(() => { clearTimeout(timer); stop(); });
    let exit;
    try {
      exit = await new Promise((resolve, reject) => {
        child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
      });
    } finally { clearTimeout(timer); stop(); }
    const resultFile = path.join(state, "result.json");
    const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, "utf8")) : null;
    const launchFile = path.join(state, "launch.json");
    const launch = fs.existsSync(launchFile) ? JSON.parse(fs.readFileSync(launchFile, "utf8")) : null;
    t.diagnostic(JSON.stringify({ command, descendant, outerExpired, exit, launch,
      result: result && { rejected: result.rejected, error: result.error, faultAlive: result.faultAlive,
        descendantAlive: result.descendantAlive, proofStatus: result.proof?.status },
      entered: fs.existsSync(path.join(state, "ready")), termObserved: fs.existsSync(path.join(state, "term")),
      stderr: Buffer.concat(stderr).toString("utf8").slice(-2000), stdoutBytes: Buffer.concat(stdout).length }));
    assert.ok(fs.existsSync(path.join(state, "ready")), "the actual public discovery command must enter the owned fault");
    assert.deepEqual(launch.args, command === "--version" ? ["--version"] : ["models", "opencode", "--verbose"]);
    if (descendant) assert.ok(fs.existsSync(path.join(state, "descendant.pid")), "the pipe-holding helper must actually start");
    assert.equal(outerExpired, false, "discovery must terminate its owned group before outer containment");
    assert.equal(result?.rejected, true);
    assert.match(result.error, /discovery|version|catalog|deadline|capture/i);
    assert.equal(result.proof.status, "refused");
    assert.equal(result.proof.selected_model, null);
    assert.equal(result.faultAlive, false);
    assert.equal(result.descendantAlive, false);
  });
}

for (const descendant of [false, true]) {
  test(`actual custody regression: TERM-resistant config ${descendant ? "descendant" : "child"} reaches bounded refusal`,
    { timeout: 45_000, skip: process.platform !== "linux" || process.arch !== "x64" }, async (t) => {
    const { checked, captureInput } = actualCaptureFixture(t);
    const state = path.join(checked.env.RUNNER_TEMP, "owned-config-fault");
    fs.mkdirSync(state, { mode: 0o700 });
    const input = path.join(state, "input.json");
    fs.writeFileSync(input, JSON.stringify({ captureInput, state, descendant,
      runner: path.join(root, ".github/scripts/run-opencode-review-recovery.mjs") }));
    // Isolated process-fault injection only. Both APIs retain the exact actual
    // config-launch arguments/options; no healthy config or verdict is stubbed.
    // The real physical binary still passes the actual canonical preflight.
    const worker = String.raw`
      import fs from "node:fs";
      import cp from "node:child_process";
      import path from "node:path";
      import { syncBuiltinESMExports } from "node:module";
      import { pathToFileURL } from "node:url";
      const f = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const pidFile = path.join(f.state, "fault.pid"), grandchildFile = path.join(f.state, "descendant.pid");
      const readyFile = path.join(f.state, "ready"), termFile = path.join(f.state, "term");
      const grandchild = 'const fs=require("node:fs");process.on("SIGTERM",()=>{});' +
        'fs.writeFileSync(' + JSON.stringify(grandchildFile) + ',String(process.pid));setInterval(()=>{},1000);';
      const trap = 'const fs=require("node:fs"),cp=require("node:child_process");' +
        'process.on("SIGTERM",()=>{fs.appendFileSync(' + JSON.stringify(termFile) + ',"TERM\\n");' +
          (f.descendant ? 'process.exit(0);' : '') + '});' +
        'fs.writeFileSync(' + JSON.stringify(pidFile) + ',String(process.pid));' +
        (f.descendant ? 'cp.spawn(process.execPath,["-e",' + JSON.stringify(grandchild) + '],{stdio:["ignore",1,2]});' : '') +
        'fs.writeFileSync(' + JSON.stringify(readyFile) + ',"ready");setInterval(()=>{},1000);';
      const sync = cp.spawnSync, async = cp.spawn;
      const redirect = (binary, args, options) => {
        if (binary !== f.captureInput.binary || JSON.stringify(args) !== '["debug","config"]')
          throw Error("unexpected synthetic config launch");
        fs.writeFileSync(path.join(f.state,"launch.json"),JSON.stringify({binary,args,timeout:options.timeout ?? null,detached:options.detached ?? false}));
        return [process.execPath,["-e",trap],options];
      };
      cp.spawnSync = (binary,args,options) => sync(...redirect(binary,args,options));
      cp.spawn = (binary,args,options) => async(...redirect(binary,args,options));
      syncBuiltinESMExports();
      const { captureReviewBatchCustody } = await import(pathToFileURL(f.runner).href);
      const alive = file => {
        if (!fs.existsSync(file)) return false;
        const pid = Number(fs.readFileSync(file,"utf8"));
        try {
          process.kill(pid,0);
          // A terminated orphan may briefly await init's reaping. It cannot
          // retain pipes or perform work; do not confuse it with a live child.
          const status = fs.readFileSync('/proc/' + pid + '/status',"utf8");
          const state = status.match(/^State:\s+([A-Z])/m)?.[1];
          if (!state) throw Error("owned config process state is unavailable");
          return state !== "Z" && state !== "X";
        } catch (error) { if (["ESRCH","ENOENT"].includes(error.code)) return false; throw error; }
      };
      const retain = result => fs.writeFileSync(path.join(f.state,"result.json"),JSON.stringify({
        ...result, faultAlive:alive(pidFile), descendantAlive:alive(grandchildFile) }));
      try {
        await captureReviewBatchCustody(f.captureInput);
        retain({rejected:false});
      } catch (error) {
        retain({rejected:true,error:error.message});
      }
    `;
    const child = spawn(process.execPath, ["--input-type=module", "--eval", worker, input],
      { detached: true, env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    child.stdout.on("data", bytes => stdout.push(bytes)); child.stderr.on("data", bytes => stderr.push(bytes));
    let outerExpired = false;
    const stop = () => {
      // Only groups/PIDs created by this fixture. No broad matching or global kill.
      for (const name of ["fault.pid", "descendant.pid"]) {
        const file = path.join(state, name);
        if (!fs.existsSync(file)) continue;
        const pid = Number(fs.readFileSync(file, "utf8"));
        if (!Number.isSafeInteger(pid) || pid <= 1) continue;
        try { process.kill(-pid, "SIGKILL"); } catch { /* It may share the worker's group. */ }
        try { process.kill(pid, "SIGKILL"); } catch { /* Already reaped. */ }
      }
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already closed. */ }
    };
    // Production has 30s. This outer 35s containment is deliberately longer,
    // so a sync TERM trap fails an assertion and cannot hang this test process.
    const timer = setTimeout(() => { outerExpired = true; stop(); }, 35_000);
    t.after(() => { clearTimeout(timer); stop(); });
    let exit;
    try {
      exit = await new Promise((resolve, reject) => {
        child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
      });
    } finally { clearTimeout(timer); stop(); }
    const resultFile = path.join(state, "result.json");
    const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, "utf8")) : null;
    t.diagnostic(JSON.stringify({ descendant, outerExpired, exit, result,
      entered: fs.existsSync(path.join(state, "ready")), termObserved: fs.existsSync(path.join(state, "term")),
      stderr: Buffer.concat(stderr).toString("utf8").slice(-2000), stdoutBytes: Buffer.concat(stdout).length }));
    assert.ok(fs.existsSync(path.join(state, "ready")), "actual config acquisition must enter the injected fault");
    if (descendant) assert.ok(fs.existsSync(path.join(state, "descendant.pid")), "the owned descendant must actually start");
    assert.equal(outerExpired, false, "production must return after owned TERM/KILL cleanup, before the outer bound");
    assert.equal(result?.rejected, true, "a timed-out config cannot become a host observation");
    assert.match(result.error, /config|capture|timed|deadline/i);
    assert.equal(result.faultAlive, false, "production must finish the owned config child before returning");
    assert.equal(result.descendantAlive, false, "production must clean the owned config descendant before returning");
  });
}

for (const protocol of ["strict", "delivered-mixed"]) {
test(`native bounded batches: actual standalone, physical CLI and compiled producer close a whole corrective invocation (${protocol})`,
  { timeout: 240_000, skip: process.platform !== "linux" || process.arch !== "x64" }, async (t) => {
  const owner = process.env.ETA_MU_CANONICAL_CONTEXT_MODULE;
  assert.ok(owner && path.isAbsolute(owner), "compiled Muse owner is required");
  const binary = process.env.ETA_MU_NATIVE_BATCH_BINARY ||
    path.join(path.dirname(owner), "native-cli/node_modules/opencode-linux-x64/bin/opencode");
  assert.ok(binary && path.isAbsolute(binary), "ETA_MU_NATIVE_BATCH_BINARY must select the actual qualified physical CLI");
  const localProfile = path.join(path.dirname(owner), "profile");
  const profile = fs.existsSync(localProfile) ? localProfile : path.resolve(path.dirname(owner), "../muse/opencode");
  const registryFile = fs.existsSync(localProfile)
    ? path.join(localProfile, "exposed-tools.txt")
    : path.resolve(path.dirname(owner), "../metadata/exposed-tools.txt");
  assert.ok(fs.existsSync(registryFile), "compiled fixture profile or canonical workflow metadata tool registry is required");
  const checked = freshReviewInputCheck(fullInputFixture(t, { unicode: true, reviewLines: 2050 }));
  // This old inert adapter marker is removed by finalReviewInputCheck; it is
  // not a source file and must not enter the native invocation's original tree.
  fs.rmSync(checked.invocation, { force: true });
  const f = canonicalContextFixture(checked);
  const ownedBinary = path.join(checked.env.RUNNER_TEMP, "native-physical-opencode");
  fs.copyFileSync(binary, ownedBinary, fs.constants.COPYFILE_FICLONE);
  fs.chmodSync(ownedBinary, 0o700);
  const registry = fs.readFileSync(registryFile, "utf8").trim().split("\n");
  assert.equal(registry.length, 25);
  assert.ok(registry.includes("review_read_diff_batch") && registry.includes("review_assess_diff_batch") &&
    registry.includes("review_assess_delivered_diff_batch"));
  fs.writeFileSync(f.registryFile, registry.join("\n") + "\n");
  const runtime = path.join(checked.env.RUNNER_TEMP, "native-runtime");
  fs.cpSync(profile, runtime, { recursive: true });
  const installed = spawnSync("npm", ["install", "--prefix", runtime, "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: checked.env.RUNNER_TEMP, env: { PATH: process.env.PATH, HOME: checked.env.RUNNER_TEMP, NPM_CONFIG_USERCONFIG: "/dev/null" },
    encoding: "utf8", stdio: "pipe", timeout: 60_000,
  });
  assert.ifError(installed.error);
  assert.equal(installed.status, 0, installed.stderr);
  assert.doesNotMatch(installed.stderr, /^npm warn/m, "native fixture dependencies must satisfy the actual test runtime without warnings");
  const home = path.join(checked.env.RUNNER_TEMP, "native-home");
  fs.mkdirSync(home, { mode: 0o700 });
  fs.mkdirSync(path.join(f.context, "agents/skills"), { recursive: true });
  fs.writeFileSync(path.join(f.context, "agents/skills/native-fixture.md"), "Owned scripted fixture skill source.\n");
  fs.symlinkSync(path.join(f.context, "agents"), path.join(home, ".agents"));
  const cfg = path.join(home, ".config/opencode");
  fs.mkdirSync(path.join(cfg, "agents"), { recursive: true });
  fs.mkdirSync(path.join(cfg, "plugins"));
  fs.mkdirSync(path.join(home, "tmp"));
  fs.copyFileSync(path.join(runtime, "agents/github-reviewer.md"), path.join(cfg, "agents/github-reviewer.md"));
  fs.writeFileSync(path.join(cfg, "plugins/eta-mu-actors.js"),
    `export { EtaMuActorsPlugin } from ${JSON.stringify(pathToFileURL(path.join(runtime, "dist/eta-mu-actors.js")).href)};\n`);
  const promptFile = path.join(f.context, "machinery/evidence-review.md");
  fs.writeFileSync(promptFile, "Scripted native custody diagnostic only. No model judgment or review credit.\n");
  const runner = path.join(f.context, "machinery/run-opencode-review-recovery.mjs");
  fs.copyFileSync(path.join(root, ".github/scripts/run-opencode-review-recovery.mjs"), runner);
  const sums = execFileSync("sha256sum", ["machinery/review-invocation.cjs", "metadata/exposed-tools.txt",
    "machinery/evidence-review.md", "machinery/run-opencode-review-recovery.mjs"], { cwd: f.context });
  fs.writeFileSync(path.join(f.context, "SHA256SUMS"), sums);
  f.digest = transportSha256(sums);
  const names = new Map(), perAttempt = new Map(), observed = [];
  const assessor = protocol === "strict" ? "review_assess_diff_batch" : "review_assess_delivered_diff_batch";
  const nextRead = (id) => ({ "first-id": id, count: protocol === "strict" ? 4 :
    Math.min(4, Math.max(1, f.expectedContext.pages.length - id)) });
  const stages = ["deterministic", "map-change", "generate-candidates", "adversarial-validate", "publish"];
  const server = http.createServer(async (request, response) => {
    try {
      let bytes = "";
      for await (const part of request) { bytes += part; assert.ok(bytes.length < 4 * 1024 * 1024); }
      const body = JSON.parse(bytes);
      const attempt = JSON.stringify(body.messages).includes("Corrective attempt 2 of 2") ? 2 : 1;
      const sequence = perAttempt.get(attempt) ?? [];
      perAttempt.set(attempt, sequence);
      const prior = body.messages.filter(message => message.role === "tool").at(-1);
      const previousName = prior ? names.get(prior.tool_call_id) : null;
      const previous = prior ? (() => { try { return JSON.parse(prior.content); } catch { return null; } })() : null;
      let name, args;
      if (!previousName) { name = "review_begin"; args = {}; }
      else if (previousName === "review_begin") { name = "read"; args = { filePath: f.contextFile, offset: 1, limit: 200 }; }
      else if (previousName === "read") {
        name = protocol === "strict" ? "review_read_diff_batch" : "review_read_diff_chunk";
        args = protocol === "strict" ? nextRead(1) : { id: 1 };
      }
      else if (previousName === "review_read_diff_batch" || previousName === "review_read_diff_chunk") {
        assert.equal(previous["ok?"], true, JSON.stringify(previous));
        sequence.push(previous);
        name = assessor;
        const pages = previous.chunks ?? [previous.chunk];
        const assessments = pages.map(page => ({ id: page.id,
          note: `Original page ${page.id}: scripted native custody diagnostic; no substantive model judgment.` }));
        args = protocol === "strict"
          ? { profile: previous.custody.profile, source_sha256: previous.custody.source_sha256,
              assessments: assessments.map((item, index) => ({ ...item, start: pages[index].start,
                end: pages[index].end, sha256: pages[index].sha256 })) }
          : { assessments };
      } else if (previousName === assessor) {
        assert.equal(previous["ok?"], true, JSON.stringify(previous));
        const last = sequence.at(-1);
        const next = last.batch ? last.batch["next-id"] :
          (last.chunk.id < f.expectedContext.pages.length ? last.chunk.id + 1 : null);
        if (next !== null) { name = "review_read_diff_batch"; args = nextRead(next); }
        else { name = "review_record_evidence"; args = { stage: stages[0], note: "Scripted native stage control; no model judgment." }; }
      } else if (previousName === "review_record_evidence") {
        assert.equal(previous["ok?"], true, JSON.stringify(previous));
        const recorded = observed.filter(call => call.attempt === attempt && call.name === "review_record_evidence").length;
        if (recorded < stages.length) { name = "review_record_evidence"; args = { stage: stages[recorded], note: `Scripted stage ${recorded} control.` }; }
        else if (attempt === 2) { name = "review_submit"; args = { summary: "Scripted native whole-input custody diagnostic only; no semantic review or publication." }; }
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      const emit = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({
        id: "native-caller-fixture", object: "chat.completion.chunk", created: 1, model: body.model,
        choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`);
      emit({ role: "assistant" });
      if (name) {
        const id = `native-${attempt}-${observed.length}`;
        names.set(id, name); observed.push({ attempt, name, args });
        emit({ tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
        emit({}, "tool_calls");
      } else { emit({ content: "Scripted diagnostic stopped." }); emit({}, "stop"); }
      response.end("data: [DONE]\n\n");
    } catch (error) {
      t.diagnostic(`scripted SSE adapter refused ${request.url}: ${error.message}`);
      if (!response.headersSent) response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "scripted fixture refused: " + error.message } }));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const api = `http://127.0.0.1:${server.address().port}/v1`;
  const selected = { id: "mimo-v9.1-flash-free", family: "mimo", status: "active", release_date: "2027-01-01",
    name: "Scripted future MiMo Flash", attachment: false, reasoning: false, temperature: true,
    last_updated: "2027-01-01",
    tool_call: true, modalities: { input: ["text"], output: ["text"] },
    cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, limit: { context: 131072, output: 2048 } };
  const catalog = { opencode: { id: "opencode", name: "OpenCode fixture", env: ["OPENCODE_API_KEY"],
    doc: "https://example.invalid/fixture", api, npm: "@ai-sdk/openai-compatible", models: { [selected.id]: selected } } };
  const config = JSON.parse(fs.readFileSync(path.join(runtime, "opencode.json")));
  config.provider = { opencode: { options: { baseURL: api, apiKey: "synthetic-local-fixture" } } };
  config.enabled_providers = ["opencode"];
  config.agent = { title: { disable: true }, summary: { disable: true } };
  fs.writeFileSync(path.join(cfg, "opencode.json"), JSON.stringify(config));
  const preload = path.join(checked.evidence, "scripted-catalog-preload.mjs");
  fs.writeFileSync(preload, `globalThis.fetch = async (url, options) => {
    if (url !== "https://models.opencode.ai/api.json" || options.credentials !== "omit") throw Error("unexpected fixture fetch");
    const response = new Response(${JSON.stringify(JSON.stringify(catalog))}, { status: 200 });
    Object.defineProperty(response, "url", { value: url }); return response;
  };\n`);
  const environment = { ...localReviewBudgetFixture(), PATH: process.env.PATH, HOME: checked.env.RUNNER_TEMP, PR_NUMBER: "42",
    OPENCODE_BIN: ownedBinary, REVIEW_MODEL_DISCOVERY: "opencode-free-mimo-flash-v1", REVIEW_EXPECTED_OPENCODE_VERSION: nativeBatchVersion,
    REVIEW_CHILD_HOME: home, REVIEW_CHILD_RUNTIME: runtime, REVIEW_EVIDENCE_DIR: checked.evidence,
    REVIEW_PROMPT_FILE: promptFile, REVIEW_TOOL_REGISTRY_FILE: f.registryFile,
    REVIEW_INVOCATION_VERIFIER_FILE: f.verifierFile, GITHUB_OUTPUT: f.output };
  const child = spawn(process.execPath, ["--import", preload, runner], { cwd: checked.consumer,
    env: environment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [], stderr = [];
  child.stdout.on("data", bytes => stdout.push(bytes)); child.stderr.on("data", bytes => stderr.push(bytes));
  const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 120_000);
  t.after(() => { clearTimeout(timer); try { process.kill(-child.pid, "SIGKILL"); } catch {} });
  const exit = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
  clearTimeout(timer);
  const diagnostic = Buffer.concat(stderr).toString("utf8");
  if (exit.code !== 0 && process.env.ETA_MU_NATIVE_PROOF_DIR) {
    const failureDirectory = process.env.ETA_MU_NATIVE_PROOF_DIR + `-${protocol}-failure`;
    assert.ok(path.isAbsolute(failureDirectory)); fs.mkdirSync(failureDirectory, { mode: 0o700 });
    fs.writeFileSync(path.join(failureDirectory, "supervisor.stderr"), diagnostic, { mode: 0o600 });
    // This HOME is the credential-free, scripted fixture, never an operator HOME.
    for (const [name, file] of [["cli-logs", path.join(home, ".local/share/opencode/log")],
      ["global-package.json", path.join(cfg, "package.json")],
      ["global-sdk-package.json", path.join(cfg, "node_modules/@opencode-ai/plugin/package.json")]]) {
      if (fs.existsSync(file)) fs.cpSync(file, path.join(failureDirectory, name), { recursive: true });
    }
  }
  const catalogFailure = exit.code === 0 ? "" : ["model-discovery.json", "model-catalog.stderr", "model-catalog.stdout", "opencode-stderr-attempt-1.log", "recovery.json"]
    .map(name => { const file = path.join(checked.evidence, name); return fs.existsSync(file) ? `${name}: ${fs.readFileSync(file, "utf8").slice(0, 6000)}` : name + ": absent"; }).join("\n");
  assert.equal(exit.code, 0, diagnostic + catalogFailure);
  const recovery = JSON.parse(fs.readFileSync(path.join(checked.evidence, "recovery.json")));
  assert.equal(recovery.attempts.length, 2);
  assert.equal(recovery.accepted_invocation.attempt, 2);
  assert.equal(recovery.recovery_reason, "missing_review_submit");
  assert.equal(recovery.batch_custody.captures.length, 4);
  const eventBytes = fs.readFileSync(path.join(checked.evidence, "review-events.jsonl"));
  for (const capture of recovery.batch_custody.captures) {
    const prefix = capture.outputs["review-events.jsonl"];
    if (capture.boundary === "before" && capture.attempt === 1) assert.equal(prefix, undefined);
    else {
      assert.ok(prefix.bytes > 0 && prefix.bytes <= eventBytes.length);
      assert.equal(prefix.sha256, transportSha256(eventBytes.subarray(0, prefix.bytes)),
        "each actual child boundary must retain its complete event prefix identity");
    }
  }
  const actual = JSON.parse(fs.readFileSync(f.submissionFile));
  assert.ok(actual["input-assessments"].length >= 5);
  assert.equal(new Set(actual["input-assessments"].map(page => page.note)).size, actual["input-assessments"].length);
  for (const attempt of [1, 2]) {
    const groups = perAttempt.get(attempt);
    assert.ok(groups.some(group => group.chunks?.length > 1));
    assert.equal(groups.at(-1).batch["next-id"], null);
    if (protocol === "delivered-mixed") {
      assert.equal(groups[0].chunk.id, 1, "an actual single read feeds the delivered assessor");
      assert.equal(groups.at(-1).chunks.length, 1, "the final one-page group is explicitly assessed");
      for (const call of observed.filter(call => call.attempt === attempt && call.name === assessor)) {
        assert.deepEqual(Object.keys(call.args), ["assessments"]);
        assert.ok(call.args.assessments.every(item => Object.keys(item).sort().join(",") === "id,note"));
      }
    }
    assert.ok(groups.at(-1).chunks.length < 4, "actual final partial group is exercised");
    assert.deepEqual(groups.flatMap(group => (group.chunks ?? [group.chunk]).map(page => page.id)), actual["input-assessments"].map(page => page.id));
  }
  assert.ok(recovery.accepted_invocation.canonical_verdict.contextReadCoverage.eof);
  assert.equal(transportSha256(JSON.stringify(recovery.accepted_invocation)), parseOutput(f.output).review_invocation_sha256);
  f.invocationDigest = parseOutput(f.output).review_invocation_sha256;
  const finalEnvironment = { REVIEW_CHILD_HOME: home, REVIEW_CHILD_RUNTIME: runtime,
    REVIEW_EXPECTED_OPENCODE_VERSION: nativeBatchVersion };
  const final = finalReviewInputCheck(checked, f, finalEnvironment);
  assert.equal(final.result.status, 0, final.result.stderr);
  assert.equal(fs.existsSync(final.publication), true, "actual final command must reach the inert publication marker");
  const publicationProof = JSON.parse(fs.readFileSync(path.join(checked.evidence, "submission-verification.json")));
  assert.match(publicationProof.terminal_custody_sha256, /^[0-9a-f]{64}$/);
  assert.equal(publicationProof.recovery_sha256, parseOutput(f.output).review_recovery_sha256);
  const recoveryFile = path.join(checked.evidence, "recovery.json");
  const configFile = path.join(cfg, "opencode.json");
  const bundleFile = path.join(runtime, "dist/eta-mu-actors.js");
  for (const [label, file] of [["actual context", f.contextFile], ["canonical module", f.verifierFile],
    ["registry", f.registryFile], ["actual private config bytes", configFile], ["actual runtime bundle", bundleFile],
    ["retained raw catalog", path.join(checked.evidence, "model-catalog-source.json")]]) {
    const original = fs.readFileSync(file);
    try {
      fs.appendFileSync(file, "\n");
      const refused = finalReviewInputCheck(checked, f, finalEnvironment);
      assert.notEqual(refused.result.status, 0, `${label} mutation must refuse`);
      assert.equal(fs.existsSync(refused.publication), false, `${label} mutation reached publication`);
    } finally { fs.writeFileSync(file, original); }
  }
  const binarySize = fs.statSync(ownedBinary).size;
  try {
    fs.appendFileSync(ownedBinary, "x");
    const refused = finalReviewInputCheck(checked, f, finalEnvironment);
    assert.notEqual(refused.result.status, 0, "changed actual physical executable must refuse");
    assert.equal(fs.existsSync(refused.publication), false);
  } finally { fs.truncateSync(ownedBinary, binarySize); }
  const recoveryBytes = fs.readFileSync(recoveryFile);
  for (const label of ["original", "missing-pair", "changed-pair"]) {
    try {
      const changed = JSON.parse(recoveryBytes);
      if (label === "original") changed.batch_custody.original.custody.config_sha256 = "0".repeat(64);
      if (label === "missing-pair") changed.batch_custody.captures.pop();
      if (label === "changed-pair") changed.batch_custody.captures[1].boundary = "before";
      fs.writeFileSync(recoveryFile, JSON.stringify(changed));
      const refused = finalReviewInputCheck(checked, f, finalEnvironment);
      assert.notEqual(refused.result.status, 0, `${label} custody change must refuse`);
      assert.equal(fs.existsSync(refused.publication), false);
    } finally { fs.writeFileSync(recoveryFile, recoveryBytes); }
  }
  const changedEnvironment = finalReviewInputCheck(checked, f, { ...finalEnvironment, PATH: process.env.PATH + ":/unselected-fixture" });
  assert.notEqual(changedEnvironment.result.status, 0, "changed actual terminal environment must refuse");
  assert.equal(fs.existsSync(changedEnvironment.publication), false);
  // Replay retained actual native bytes only as intercepted adapter controls.
  // These negatives grant no fresh host-capture authority or review credit.
  const responseBytes = fs.readFileSync(path.join(checked.evidence, recovery.accepted_invocation.response_file));
  const submissionBytes = fs.readFileSync(f.submissionFile);
  const context = f.verifier.prepareReviewInvocationContext(f.full,
    fs.readFileSync(path.join(checked.evidence, "input-manifest.json")), registry,
    f.submissionFile, f.contextBytes, f.contextFile);
  context.batchHost = recovery.batch_custody.original.batchHost;
  const firstRead = events => events.find(event => event.part?.tool === "review_read_diff_batch");
  const editOutput = (event, mutate) => {
    const output = JSON.parse(event.part.state.output); mutate(output); event.part.state.output = JSON.stringify(output);
  };
  const cases = [
    ["intact control", () => {}],
    ["missing member", events => editOutput(firstRead(events), output => output.chunks.pop())],
    ["duplicate member", events => editOutput(firstRead(events), output => { output.chunks[1] = output.chunks[0]; })],
    ["changed original page", events => editOutput(firstRead(events), output => { output.chunks[0].text += "changed"; })],
    ["truncated native output", events => { firstRead(events).part.state.metadata.truncated = true; }],
    ["oversized complete wire", events => { firstRead(events).part.state.output += " ".repeat(48001); }],
    ["missing final partial assessment", events => {
      const last = events.findLastIndex(event => event.part?.tool === assessor); events.splice(last, 1);
    }],
  ];
  for (const [label, mutate] of cases) {
    const events = responseBytes.toString("utf8").trim().split("\n").map(JSON.parse);
    mutate(events);
    const candidate = Buffer.from(events.map(event => JSON.stringify(event)).join("\n") + "\n");
    const directory = fs.mkdtempSync(path.join(checked.evidence, "intercepted-native-control-"));
    fs.rmSync(f.submissionFile);
    let result, failure, attempts = 0;
    try {
      result = await runReviewRecovery({ evidenceDirectory: directory, basePrompt: "Intercepted native transport control; no new model review.",
        submissionFile: f.submissionFile, reviewTools: registry, verifyReviewInvocation: f.verifier.verifyReviewInvocation,
        expectedContext: context, captureBatchHost: async () => structuredClone(recovery.batch_custody.original),
        invokeAttempt: async ({ responseFile, stderrFile }) => {
          attempts += 1; fs.writeFileSync(responseFile, candidate); fs.writeFileSync(stderrFile, "");
          fs.writeFileSync(f.submissionFile, submissionBytes); return { exitCode: 0 };
        } });
    } catch (error) { failure = error; }
    finally { fs.writeFileSync(f.submissionFile, submissionBytes); }
    if (label === "intact control") {
      assert.ok(result?.accepted_invocation, failure?.message);
      assert.equal(attempts, 1);
    } else {
      assert.ok(failure, `${label} must refuse`);
      const refused = JSON.parse(fs.readFileSync(path.join(directory, "recovery.json")));
      assert.equal(refused.accepted_invocation, null, label);
      assert.ok(refused.attempts.every(attempt => attempt.canonical_verdict.ok === false), label);
      assert.ok(attempts <= 2, label);
    }
  }
  if (process.env.ETA_MU_NATIVE_PROOF_DIR) {
    const proofDirectory = process.env.ETA_MU_NATIVE_PROOF_DIR + `-${protocol}`;
    assert.ok(path.isAbsolute(proofDirectory)); fs.mkdirSync(proofDirectory, { mode: 0o700 });
    for (const name of ["recovery.json", "model-response-attempt-1.txt", "model-response-attempt-2.txt", "submission.json",
      "opencode-stderr-attempt-1.log", "opencode-stderr-attempt-2.log", "model-discovery.json",
      "model-catalog.stdout", "model-version.stdout", "model-catalog-source.json", "model-catalog-source-response.json", "review-events.jsonl"]) {
      fs.copyFileSync(path.join(checked.evidence, name), path.join(proofDirectory, name));
      fs.chmodSync(path.join(proofDirectory, name), 0o600);
    }
    fs.writeFileSync(path.join(proofDirectory, "proof.json"), JSON.stringify({
      tier: "actual physical CLI and compiled producer/verifier with scripted local SSE; no provider judgment or publication",
      muse: "riatzukiza/muse@f422d77cf9c6cea46b6791e3f54c98679e949d1f", protocol, registry,
      verifier_sha256: transportSha256(fs.readFileSync(f.verifierFile)),
      binary_sha256: transportSha256(fs.readFileSync(ownedBinary)),
      pages: actual["input-assessments"].length, groups: perAttempt.get(2).length, attempts: 2, captures: 4,
      terminal_custody_sha256: publicationProof.terminal_custody_sha256,
      intercepted_adapter_controls: cases.map(([label]) => label),
    }, null, 2) + "\n", { mode: 0o600 });
  }
  t.diagnostic(`real CLI/canonical producer: ${actual["input-assessments"].length} pages, ${perAttempt.get(2).length} whole groups, 2 isolated invocations, 4 captures; scripted local SSE, no provider judgment`);
});
}

/** Bind a real canonical verdict to selected bytes before exercising the complete final command. */
function bindCanonicalFixture(fixture, options = {}) {
  const data = canonicalContextResponse(fixture, options);
  const verdict = fixture.verifier.verifyReviewInvocation(data.response, data.submission, fixture.expectedContext);
  assert.equal(verdict.ok, true, JSON.stringify(verdict));
  fs.writeFileSync(fixture.submissionFile, data.submission);
  const accepted = { attempt: 1, response_file: "model-response-attempt-1.txt", response_sha256: transportSha256(data.response),
    submission_file: "submission.json", submission_sha256: transportSha256(data.submission), session_id: verdict.sessionID,
    canonical_verdict: verdict, verifier_sha256: transportSha256(fs.readFileSync(fixture.verifierFile)),
    expected_context_sha256: transportSha256(JSON.stringify(fixture.expectedContext)) };
  fs.writeFileSync(path.join(fixture.checked.evidence, accepted.response_file), data.response);
  fs.writeFileSync(path.join(fixture.checked.evidence, "recovery.json"), JSON.stringify({ schema: "open-hax.review-recovery/v1", max_attempts: 2,
    attempts: [{ attempt: 1, exit_code: 0, invocation_state: "completed" }], accepted_invocation: accepted }));
  fixture.invocationDigest = transportSha256(JSON.stringify(accepted));
  fixture.recoveryDigest = transportSha256(fs.readFileSync(path.join(fixture.checked.evidence, "recovery.json")));
}

for (const [name, bytes] of [["UTF8", Buffer.from("outside 😀\n第二行\n")], ["present-empty", Buffer.alloc(0)]]) {
  test(`canonical staged context: supervisor supplies actual ${name} bytes before its child`, (t) => {
    const checked = freshReviewInputCheck(fullInputFixture(t, { unicode: true }));
    assert.equal(checked.result.status, 0, checked.result.stderr);
    const fixture = canonicalContextFixture(checked, bytes);
    const probe = canonicalSupervisor(fixture);
    assert.equal(probe.result.status, 0, probe.result.stderr);
    assert.equal(fs.existsSync(probe.marker), true);
    const recovery = JSON.parse(fs.readFileSync(path.join(checked.evidence, "recovery.json")));
    assert.equal(recovery.accepted_invocation.expected_context_sha256, transportSha256(JSON.stringify(fixture.expectedContext)));
  });
  test(`canonical staged context: full final boundary rebinds actual ${name} bytes before publication`, (t) => {
    const checked = freshReviewInputCheck(fullInputFixture(t, { unicode: true }));
    assert.equal(checked.result.status, 0, checked.result.stderr);
    const fixture = canonicalContextFixture(checked, bytes);
    bindCanonicalFixture(fixture);
    const final = finalReviewInputCheck(checked, fixture);
    assert.equal(final.result.status, 0, final.result.stderr);
    assert.equal(fs.existsSync(final.publication), true);
  });
}

for (const [name, mutate, expectedError] of [
  ["missing", f => fs.rmSync(f.contextFile), /ENOENT/],
  ["unreadable directory", f => { fs.rmSync(f.contextFile); fs.mkdirSync(f.contextFile); }, /EISDIR/],
  ["invalid UTF8", f => fs.writeFileSync(f.contextFile, Buffer.from([0xff])), /invalid full-input context/],
]) {
  test(`canonical staged context: supervisor refuses ${name} before starting a child`, (t) => {
    const checked = freshReviewInputCheck(fullInputFixture(t));
    const fixture = canonicalContextFixture(checked);
    mutate(fixture);
    const probe = canonicalSupervisor(fixture);
    assert.notEqual(probe.result.status, 0);
    assert.equal(fs.existsSync(probe.marker), false);
    const recovery = JSON.parse(fs.readFileSync(path.join(checked.evidence, "recovery.json")));
    assert.equal(recovery.attempts.length, 0);
    assert.match(recovery.setup_error, expectedError);
  });
}

for (const [name, mutate] of [
  ["missing", f => fs.rmSync(f.contextFile)],
  ["changed bytes", f => fs.appendFileSync(f.contextFile, "changed\n")],
  ["invalid UTF8", f => fs.writeFileSync(f.contextFile, Buffer.from([0xff]))],
]) {
  test(`canonical staged context: final reread refuses ${name} without publication`, (t) => {
    const checked = freshReviewInputCheck(fullInputFixture(t));
    const fixture = canonicalContextFixture(checked);
    bindCanonicalFixture(fixture);
    mutate(fixture);
    const final = finalReviewInputCheck(checked, fixture);
    assert.notEqual(final.result.status, 0);
    assert.equal(fs.existsSync(final.publication), false);
  });
}


for (const [inputKind, options] of [["multi-page", { large: true, unicode: true }], ["empty", { empty: true }]]) {
  test(`canonical staged context: initial and corrective prompts require final-page assessment before evidence (${inputKind})`, async (t) => {
    const checked = freshReviewInputCheck(fullInputFixture(t, options));
    assert.equal(checked.result.status, 0, checked.result.stderr);
    const fixture = canonicalContextFixture(checked);
    if (inputKind === "empty") {
      assert.equal(fixture.expectedContext.pages.length, 0);
    } else {
      assert.ok(fixture.expectedContext.pages.length > 1,
        "the canonical input must span multiple pages");
      const finalPage = fixture.expectedContext.pages.at(-1);
      assert.ok(finalPage.end > finalPage.start && finalPage.end - finalPage.start < 8192,
        "the canonical input must include a shorter final page");
    }
    const calls = [];
    const result = await runReviewRecovery({
      evidenceDirectory: checked.evidence,
      basePrompt: "Synthetic strict caller control; no provider or review credit.",
      submissionFile: fixture.submissionFile,
      reviewTools: fixture.tools,
      verifyReviewInvocation: fixture.verifier.verifyReviewInvocation,
      expectedContext: fixture.expectedContext,
      verifierSha256: transportSha256(fs.readFileSync(fixture.verifierFile)),
      invokeAttempt: async ({ attempt, prompt, responseFile, stderrFile }) => {
        calls.push({ attempt, prompt });
        const data = canonicalContextResponse(fixture, { omitSubmit: attempt === 1 });
        fs.writeFileSync(responseFile, data.response);
        fs.writeFileSync(stderrFile, "");
        if (attempt === 2) fs.writeFileSync(fixture.submissionFile, data.submission);
        return { exitCode: 0 };
      },
    });
    assert.deepEqual(calls.map(({ attempt }) => attempt), [1, 2]);
    assert.equal(result.max_attempts, 2);
    assert.equal(result.recovery_reason, "missing_review_submit");
    assert.equal(result.attempts[0].canonical_verdict.reason, "missing-review-submit");
    assert.equal(result.accepted_invocation.attempt, 2);
    assert.equal(result.accepted_invocation.canonical_verdict.ok, true);
    assert.equal(result.accepted_invocation.expected_context_sha256,
      transportSha256(JSON.stringify(fixture.expectedContext)));
    assert.match(calls[1].prompt, /corrective attempt 2 of 2/i);
    for (const { attempt, prompt } of calls) {
      const checkpoint = prompt.match(/Full-input assessment checkpoint[^]*?Supporting-file HOST read contract/);
      assert.ok(checkpoint, `attempt ${attempt} must carry the final-page checkpoint`);
      assert.match(checkpoint[0], /zero full-input chunks[^]*skip page reads and assessments/i);
      assert.match(checkpoint[0], /retain staged-context reading and every evidence-stage requirement[^]*Otherwise:/);
      assert.match(checkpoint[0], /final[^]*review_assess_diff_chunk[^]*actual id[^]*shorter final page/);
      assert.match(checkpoint[0], /coverage\.assessed must equal[^]*coverage\.chunks/);
      assert.match(checkpoint[0], /coverage\.missing must be empty before review_record_evidence/);
      assert.match(checkpoint[0], /Delivered\/read coverage alone does not prove assessment/);
      assert.match(checkpoint[0], /review_assess_delivered_diff_batch[^]*closed[^]*\{id,note\}/);
      assert.match(checkpoint[0], /producer derives source, geometry and digests/);
      assert.match(checkpoint[0], /do not silently downgrade or reinterpret a refused/);
    }
  });
}

// These inert HOST frames exercise the existing narrow retry boundary through
// the compiled Muse owner; they supply no provider judgment or review credit.
for (const omission of ["final", "earlier", "multiple"]) {
  test(`canonical staged context: incomplete assessment never weakens first-stage custody (${omission})`, async (t) => {
    const checked = freshReviewInputCheck(fullInputFixture(t, { large: true, unicode: true }));
    assert.equal(checked.result.status, 0, checked.result.stderr);
    const fixture = canonicalContextFixture(checked);
    const pages = fixture.expectedContext.pages;
    assert.ok(pages.length > 1);
    const finalPage = pages.at(-1);
    assert.ok(finalPage.end > finalPage.start && finalPage.end - finalPage.start < 8192);
    const missing = omission === "final" ? [finalPage.id]
      : omission === "earlier" ? [pages[0].id] : [pages[0].id, finalPage.id];
    const healthy = canonicalContextResponse(fixture);
    const calls = [];
    const run = runReviewRecovery({
      evidenceDirectory: checked.evidence,
      basePrompt: "Synthetic final-assessment recovery control; no review credit.",
      submissionFile: fixture.submissionFile,
      reviewTools: fixture.tools,
      verifyReviewInvocation: fixture.verifier.verifyReviewInvocation,
      expectedContext: fixture.expectedContext,
      verifierSha256: transportSha256(fs.readFileSync(fixture.verifierFile)),
      invokeAttempt: async ({ attempt, responseFile, stderrFile }) => {
        calls.push(attempt);
        if (attempt === 1) {
          const events = healthy.response.toString("utf8").trim().split("\n").map(JSON.parse)
            .filter(event => !(event.part?.tool === "review_assess_diff_chunk"
              && missing.includes(event.part.state.input.id)))
            .filter(event => event.part?.tool !== "review_submit"
              && !(event.part?.tool === "review_record_evidence"
                && event.part.state.input.stage === "publish"));
          const refusal = events.find(event => event.part?.tool === "review_record_evidence"
            && event.part.state.input.stage === "adversarial-validate");
          assert.ok(refusal);
          for (const event of events.filter(event => event.part?.tool === "review_assess_diff_chunk")) {
            const id = event.part.state.input.id;
            const output = JSON.parse(event.part.state.output);
            output.coverage.assessed = id - missing.filter(omitted => omitted <= id).length;
            output.coverage.missing = pages.filter(page => page.id > id || missing.includes(page.id)).map(page => page.id);
            event.part.state.output = JSON.stringify(output);
          }
          refusal.part.state.metadata = { truncated: false };
          refusal.part.state.output = JSON.stringify({ "ok?": false,
            error: `Unassessed full-input chunks remain: ${missing.join(", ")}. Read and assess every changed hunk before publishing.` });
          fs.writeFileSync(responseFile, events.map(event => JSON.stringify(event)).join("\n") + "\n");
        } else {
          fs.writeFileSync(responseFile, healthy.response);
          fs.writeFileSync(fixture.submissionFile, healthy.submission);
        }
        fs.writeFileSync(stderrFile, "");
        return { exitCode: 0 };
      },
    });
    await assert.rejects(run, /review invocation verification failed after attempt 1/);
    assert.deepEqual(calls, [1]);
    const result = JSON.parse(fs.readFileSync(path.join(checked.evidence, "recovery.json")));
    assert.equal(result.max_attempts, 2);
    assert.equal(result.recovery_reason, null);
    assert.equal(result.accepted_invocation, null);
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].canonical_verdict.ok, false);
    assert.equal(result.attempts[0].canonical_verdict.code, "stage-order");
    assert.equal(fs.existsSync(fixture.submissionFile), false);
    if (omission === "final") {
      // The transport candidate is not retry authority: removing its terminal
      // refusal still leaves input incomplete before the first evidence stage.
      const proof = result.attempts[0].final_input_coverage;
      assert.equal(proof.missing_final_page, finalPage.id);
      assert.equal(proof.accepted_review, false);
      assert.equal(proof.tier, "DERIVED_RETRY_ELIGIBILITY_ONLY");
      assert.equal(proof.canonical_verdict.ok, false);
      assert.equal(proof.canonical_verdict.code, "stage-chronology");
      const original = fs.readFileSync(path.join(checked.evidence, result.attempts[0].response_file));
      assert.equal(transportSha256(original), proof.original_response_sha256);
    } else {
      assert.equal(result.attempts[0].final_input_coverage, undefined);
      assert.equal(fs.existsSync(path.join(checked.evidence, "final-input-coverage-attempt-1.DERIVED.ndjson")), false);
    }
  });
}

test("canonical staged context: matching qualified Muse pin supplies both plugin and verifier", () => {
  const pin = "f422d77cf9c6cea46b6791e3f54c98679e949d1f";
  assert.equal(workflow.on.workflow_call.inputs.muse_revision.default, pin);
  const checkout = namedStep("prepare_review_context", "Checkout Muse compatibility compiler");
  assert.equal(checkout.with.ref, "${{ inputs.muse_revision || '" + pin + "' }}");
  assert.equal(namedStep("prepare_review_context", "Assemble revision-bound review context").env.MUSE_REVISION, checkout.with.ref);
});

test("canonical staged context: held supervisor preparation survives the two-child bound, final reread detects mutation", (t) => {
  const checked = freshReviewInputCheck(fullInputFixture(t));
  const fixture = canonicalContextFixture(checked);
  const probe = canonicalSupervisor(fixture, { retryAfterMissingSubmit: true });
  assert.equal(probe.result.status, 0, probe.result.stderr);
  const recovery = JSON.parse(fs.readFileSync(path.join(checked.evidence, "recovery.json")));
  assert.equal(recovery.max_attempts, 2);
  assert.equal(recovery.attempts.length, 2);
  assert.equal(recovery.accepted_invocation.attempt, 2);
  assert.equal(recovery.accepted_invocation.expected_context_sha256, transportSha256(JSON.stringify(fixture.expectedContext)));
  fixture.invocationDigest = parseOutput(fixture.output).review_invocation_sha256;
  const final = finalReviewInputCheck(checked, fixture);
  assert.notEqual(final.result.status, 0);
  assert.equal(fs.existsSync(final.publication), false);
});

for (const kind of ["absence", "foreign path"]) {
  test(`canonical staged context: final boundary refuses model-selected ${kind}`, (t) => {
    const checked = freshReviewInputCheck(fullInputFixture(t));
    const fixture = canonicalContextFixture(checked);
    const contextPath = kind === "absence" ? fixture.contextFile : path.join(checked.evidence, "model-selected.md");
    const bytes = kind === "absence" ? null : fixture.contextBytes;
    fixture.expectedContext = fixture.verifier.prepareReviewInvocationContext(fixture.full,
      fs.readFileSync(path.join(checked.evidence, "input-manifest.json")), fixture.tools, fixture.submissionFile, bytes, contextPath);
    fixture.contextFile = contextPath;
    // A valid separate library control must still be refused by the always-present caller.
    const data = canonicalContextResponse(fixture, { omitRead: kind === "absence" });
    const verdict = fixture.verifier.verifyReviewInvocation(data.response, data.submission, fixture.expectedContext);
    assert.equal(verdict.ok, true, JSON.stringify(verdict));
    fs.writeFileSync(fixture.submissionFile, data.submission);
    const accepted = { attempt: 1, response_file: "model-response-attempt-1.txt", response_sha256: transportSha256(data.response),
      submission_file: "submission.json", submission_sha256: transportSha256(data.submission), session_id: verdict.sessionID,
      canonical_verdict: verdict, verifier_sha256: transportSha256(fs.readFileSync(fixture.verifierFile)),
      expected_context_sha256: transportSha256(JSON.stringify(fixture.expectedContext)) };
    fs.writeFileSync(path.join(checked.evidence, accepted.response_file), data.response);
    fs.writeFileSync(path.join(checked.evidence, "recovery.json"), JSON.stringify({ schema: "open-hax.review-recovery/v1", max_attempts: 2,
      attempts: [{ attempt: 1, exit_code: 0, invocation_state: "completed" }], accepted_invocation: accepted }));
    fixture.invocationDigest = transportSha256(JSON.stringify(accepted));
    const final = finalReviewInputCheck(checked, fixture, { REVIEW_CONTEXT_ABSENT: "true", REVIEW_CONTEXT_PATH: contextPath });
    assert.notEqual(final.result.status, 0);
    assert.equal(fs.existsSync(final.publication), false);
  });
}


test("canonical staged context: deterministic CI supplies the actually compiled module to all regression tests", () => {
  const job = workflow.jobs.deterministic_evidence;
  assert.deepEqual(job.needs, ["prepare_review_context"]);
  assert.equal(job.env.ETA_MU_CANONICAL_CONTEXT_MODULE,
    "${{ github.workspace }}/.opencode/review-evidence/canonical-context/machinery/review-invocation.cjs");
  const download = namedStep("deterministic_evidence", "Download canonical Muse context for caller regressions");
  assert.equal(download.with.name, "${{ needs.prepare_review_context.outputs.artifact_name }}");
  assert.equal(download.with.path, ".opencode/review-evidence/canonical-context");
  const verify = namedStep("deterministic_evidence", "Verify canonical caller-test context");
  assert.match(verify.run, /sha256sum --check --strict SHA256SUMS/);
  assert.ok(job.steps.indexOf(verify) < job.steps.indexOf(namedStep("deterministic_evidence", "Run deterministic gates")));
});


for (const [name, responseOptions] of [["omitted native read", { omitRead: true }], ["missing EOF", { corruptEof: true }]]) {
  test(`canonical staged context: actual supervisor delegates ${name} refusal to Muse`, (t) => {
    const checked = freshReviewInputCheck(fullInputFixture(t));
    const fixture = canonicalContextFixture(checked);
    const probe = canonicalSupervisor(fixture, { responseOptions });
    assert.notEqual(probe.result.status, 0);
    assert.equal(fs.existsSync(probe.marker), true);
    const recovery = JSON.parse(fs.readFileSync(path.join(checked.evidence, "recovery.json")));
    assert.equal(recovery.accepted_invocation, null);
    assert.equal(recovery.attempts.length, 1);
    assert.equal(recovery.attempts[0].canonical_verdict.code, "context-read-coverage-unestablished");
  });
}

test("canonical staged context: actual caller refuses an older verifier that ignores new arguments", (t) => {
  const checked = freshReviewInputCheck(fullInputFixture(t));
  const fixture = canonicalContextFixture(checked);
  fs.writeFileSync(fixture.verifierFile, `exports.prepareReviewInvocationContext=()=>({inputSource:{},pages:[]});
exports.verifyReviewInvocation=()=>{throw new Error("must not reach invocation");};`);
  const probe = canonicalSupervisor(fixture);
  assert.notEqual(probe.result.status, 0);
  assert.equal(fs.existsSync(probe.marker), false);
  const recovery = JSON.parse(fs.readFileSync(path.join(checked.evidence, "recovery.json")));
  assert.equal(recovery.attempts.length, 0);
  assert.equal(recovery.setup_error, "canonical verifier did not bind the actual staged context");
});

test("canonical staged context: sandbox supplies and preserves the real compiled fixture for its full test gate", () => {
  const sandbox = YAML.parse(fs.readFileSync(path.join(root, ".github/workflows/sandbox-bundle.yml"), "utf8"));
  const validate = sandbox.jobs.bundle.steps.find(step => step.name === "Install, validate, test, and build");
  const compile = 'pnpm --dir packages/eta-mu exec nbb ../../.github/scripts/eta_mu/extern/canonical_context_fixture.cljs "$OUT/runtime/canonical-context"';
  const bind = 'export ETA_MU_CANONICAL_CONTEXT_MODULE="$OUT/runtime/canonical-context/review-invocation.cjs"';
  assert.ok(validate.run.includes(compile));
  assert.ok(validate.run.includes(bind));
  assert.ok(validate.run.indexOf(compile) < validate.run.indexOf(bind));
  assert.ok(validate.run.indexOf(bind) < validate.run.indexOf("pnpm test"));
  const collect = sandbox.jobs.bundle.steps.find(step => step.name === "Collect generated outputs and portable toolchains");
  assert.match(collect.run, /entrypoint: "ETA_MU_CANONICAL_CONTEXT_MODULE=.* pnpm test"/);
});

for (const forged of [false, true]) {
  test(`native event context: ${forged ? "replaced valid UTF8 refuses before child" : "actual native bytes reach child"}`, (t) => {
    const checked = freshReviewInputCheck(fullInputFixture(t, { unicode: true }));
    assert.equal(checked.result.status, 0, checked.result.stderr);
    const staged = fs.readFileSync(path.join(checked.evidence, "pr-context.md"));
    const bytes = forged ? Buffer.from(staged.toString("utf8").replace("input fixture", "evilx fixture")) : staged;
    if (forged) {
      assert.equal(bytes.length, staged.length);
      assert.notDeepEqual(bytes, staged);
    }
    const fixture = canonicalContextFixture(checked, bytes);
    const step = workflow.jobs.review.steps.find(candidate => candidate.name === "Verify staged context against native event");
    // Before repair no origin check existed. Exercise the actual canonical
    // supervisor rather than relabel an absent step as a production refusal.
    const origin = step ? runScript(step.run, checked.consumer, checked.env) : { status: 0 };
    const probe = origin.status === 0 ? canonicalSupervisor(fixture) : null;
    console.log(JSON.stringify({ scenario: "native event origin", forged, originStepPresent: Boolean(step),
      originStatus: origin.status, supervisorStatus: probe?.result.status ?? null,
      childEntered: fs.existsSync(path.join(checked.evidence, "synthetic-child-entered")) }));
    if (forged) {
      assert.notEqual(origin.status, 0);
      assert.equal(probe, null);
      assert.match(origin.stdout + origin.stderr, /staged PR context differs from native event/);
      assert.equal(fs.existsSync(path.join(checked.evidence, "synthetic-child-entered")), false);
    } else {
      assert.equal(origin.status, 0, origin.stderr);
      assert.equal(probe.result.status, 0, probe.result.stderr);
      assert.equal(fs.existsSync(probe.marker), true);
    }
  });
}

test("native event context: identical producer formatter is the last step before the reviewer child", () => {
  const producer = namedStep("deterministic_evidence", "Stage pull request diff and context");
  const origin = namedStep("review", "Verify staged context against native event");
  const formatter = source => source.match(/jq -r '\n([\s\S]*?)\n\s*' "\$GITHUB_EVENT_PATH"/)[1];
  assert.equal(formatter(origin.run), formatter(producer.run));
  const steps = workflow.jobs.review.steps;
  assert.equal(steps.indexOf(origin) + 1,
    steps.indexOf(namedStep("review", "Run bounded evidence-first OpenCode review")));
});

// Qualified same-owner discovery controls from fcdf356d, no unrelated native assessment routes.
function freeMiMoRow(id = "mimo-v9.1-flash-free", release = "2027-01-01") {
  return { id, providerID: "opencode", family: "mimo", status: "active", release_date: release,
    api: { id, url: "https://example.invalid/inert", npm: "@ai-sdk/openai-compatible" },
    capabilities: { toolcall: true, input: { text: true }, output: { text: true } },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } } };
}

/** Encode the actual ID-line/pretty-JSON catalog format without connecting to a provider. */
function verboseModelCatalog(rows) {
  return `\x1b[32mModels cache refreshed\x1b[0m\n\n${rows.map((row) =>
    `opencode/${row.id}\n${JSON.stringify(row, null, 2)}`).join("\n")}\n`;
}

for (const id of ["UNRELATED-v1", "unrelated:model", "unrelated+fast"]) {
  test(`catalog label widening retains unrelated ${id} before valid MiMo selection`, () => {
    const ordinary = { ...freeMiMoRow("unrelated-plain"), family: "other" };
    const unrelated = { ...freeMiMoRow(id), family: "other" };
    const valid = freeMiMoRow();
    const expected = [ordinary, unrelated, valid];
    const rows = parseOpenCodeModelCatalog(Buffer.from(verboseModelCatalog(expected)));
    assert.deepEqual(rows, expected, "each native label must retain its exact metadata row");
    assert.deepEqual(selectFreeMiMoFlash(rows), valid);
    assert.deepEqual(selectFreeMiMoFlash(rows, `opencode/${valid.id}`), valid);
    assert.throws(() => selectFreeMiMoFlash(rows, `opencode/${id}`), /not a unique eligible/);
  });
}

test("catalog label widening preserves exact row identity, duplicate IDs and whitespace refusal", () => {
  const unrelated = { ...freeMiMoRow("Unrelated:model+fast"), family: "other" };
  const valid = freeMiMoRow();
  const encode = (row) => Buffer.from(verboseModelCatalog([row, valid]));
  for (const change of [
    { providerID: "other" }, { api: { ...unrelated.api, id: "different" } },
  ]) assert.throws(() => parseOpenCodeModelCatalog(encode({ ...unrelated, ...change })), /identity mismatch/);
  const catalog = verboseModelCatalog([unrelated, valid]);
  assert.throws(() => parseOpenCodeModelCatalog(Buffer.from(
    catalog.replace(`opencode/${unrelated.id}\n`, "opencode/Different:model+fast\n"))), /identity mismatch/);
  assert.throws(() => parseOpenCodeModelCatalog(Buffer.from(
    verboseModelCatalog([unrelated, unrelated, valid]))), /duplicate/);
  for (const id of ["unrelated model", "unrelated\tmodel", "unrelated\nmodel"]) {
    assert.throws(() => parseOpenCodeModelCatalog(encode({
      ...unrelated, id, api: { ...unrelated.api, id },
    })));
  }
});

test("free MiMo selector uses numeric versions and coherent release maxima with verified explicit selection", () => {
  const older = freeMiMoRow("mimo-v2.9-flash-free", "2026-09-01");
  const newer = freeMiMoRow("mimo-v2.10-flash-free", "2026-10-01");
  const rows = parseOpenCodeModelCatalog(Buffer.from(verboseModelCatalog([older, newer])));
  assert.deepEqual(selectFreeMiMoFlash(rows), newer);
  assert.deepEqual(selectFreeMiMoFlash(rows, "opencode/mimo-v2.9-flash-free"), older);
  for (const requested of ["opencode/missing-free", "other/mimo-v2.10-flash-free", "opencode/mimo-v2.10-flash-free "]) {
    assert.throws(() => selectFreeMiMoFlash(rows, requested), /not a unique eligible/);
  }
  for (const candidates of [
    [older, { ...newer, release_date: older.release_date }],
    [{ ...older, release_date: "2026-11-01" }, newer],
    [newer, freeMiMoRow("mimo-v2.10.0-flash-free", "2026-11-01")],
  ]) assert.throws(() => selectFreeMiMoFlash(candidates), /ambiguous latest/);
  for (const date of [undefined, "2026-02-30", "not-a-date"]) {
    assert.throws(() => selectFreeMiMoFlash([{ ...newer, release_date: date }]), /no rankable/);
  }
});

test("free MiMo selection rejects paid branches, incompatible roles and malformed native catalog records", () => {
  const valid = freeMiMoRow();
  const variants = [
    { providerID: "other" }, { family: "kimi" }, { status: "deprecated" },
    { id: "mimo-v9.1-pro-free" }, { capabilities: { ...valid.capabilities, toolcall: false } },
    { capabilities: { ...valid.capabilities, output: { text: false } } },
    { cost: { ...valid.cost, input: 1 } }, { cost: { ...valid.cost, output: 1 } },
    { cost: { ...valid.cost, cache: { read: 1, write: 0 } } },
    { cost: { ...valid.cost, tiers: [{ ...valid.cost, output: 1 }] } },
    { cost: { ...valid.cost, experimentalOver200K: { ...valid.cost, input: 1 } } },
  ];
  for (const change of variants) assert.throws(() => selectFreeMiMoFlash([{ ...valid, ...change }]), /no eligible/);
  const catalog = verboseModelCatalog([valid]);
  for (const bytes of [
    Buffer.from("not a catalog\n" + catalog), Buffer.from(catalog + "trailing diagnostic\n"),
    Buffer.from(catalog + catalog.replace(/^.*?\n\n/, "")), Buffer.from(catalog.replace('"providerID": "opencode"', '"providerID": "other"')),
    Buffer.from(catalog.replace('"api": {', '"api": null, "ignored": {')), Buffer.from("opencode/only-id\n"),
    Buffer.from([0xff, 0x80]),
  ]) assert.throws(() => parseOpenCodeModelCatalog(bytes));
});
