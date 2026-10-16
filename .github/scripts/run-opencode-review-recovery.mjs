// SPDX-License-Identifier: GPL-3.0-or-later

import { execFileSync, spawn } from "node:child_process";
import os from "node:os";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, stripVTControlCharacters } from "node:util";

const RECOVERY_SCHEMA = "open-hax.review-recovery/v1";
const MAX_ATTEMPTS = 2;

// Compatible discovery source from qualified ETA PR18 MERGEfcdf356d6e1dfc802e60c09f3f36c18819124f81.
// Preserve this caller's mandatory complete context and finite attempt budgets.
const MODEL_DISCOVERY_MODE = "opencode-free-mimo-flash-v1";
const MODEL_DISCOVERY_BUDGET_MS = 30_000;
const MODEL_CATALOG_URL = "https://models.opencode.ai/api.json";
const MODEL_CATALOG_MAX_BYTES = 16 * 1024 * 1024;

// Exact paths delegated to existing producers; every other readable Git-other
// path (including ignored files and downloaded neighbors) remains immutable.
function outputRoles(directory, submissionFile = path.join(directory, "submission.json")) {
  return new Map([
    ...[1, 2].flatMap(attempt => [`model-response-attempt-${attempt}.txt`, `opencode-stderr-attempt-${attempt}.log`]),
    "submission-attempt-1.json", "review-submit-json-attempt-1.DERIVED.ndjson", "review-submit-json-attempt-1.OMITTED.ndjson",
    "final-input-coverage-attempt-1.DERIVED.ndjson", "final-input-coverage-attempt-1.OMITTED.ndjson",
    "recovery.json", "review-events.jsonl",
  ].map(name => [name, path.resolve(directory, name)]).concat([["submission.json", path.resolve(submissionFile)]]));
}

function discoveryNames() {
  return ["model-discovery.json", "model-version.stdout", "model-version.stderr", "model-catalog.stdout", "model-catalog.stderr",
    "model-catalog-source.json", "model-catalog-source-response.json"];
}

function physicalStat(file) {
  const actual = path.resolve(file);
  if (fs.realpathSync(path.dirname(actual)) !== path.dirname(actual)) throw new Error("review custody parent is not physical");
  try {
    const stat = fs.lstatSync(actual, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("review custody requires regular files; symlink/special output or input refused");
    if (stat.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("review custody file length is not representable");
    return stat;
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function freshOutputRoles(directory, submissionFile, includeDiscovery = false) {
  const paths = [...outputRoles(directory, submissionFile).values(), path.resolve(directory, "submission-verification.json"),
    ...(includeDiscovery ? discoveryNames().map(name => path.resolve(directory, name)) : [])];
  for (const file of paths) if (physicalStat(file)) throw new Error("refusing pre-existing owned output custody; retained history must not be overwritten");
}

function captureDeadline(deadline) {
  const remaining = deadline - performance.now();
  if (remaining <= 0) throw new Error("review custody acquisition deadline expired");
  return remaining;
}

/** Stream exact finite regular bytes; reject partial reads, concurrent growth or retyping. */
async function fileCustody(file, deadline, prefix = null) {
  const stat = physicalStat(file);
  if (!stat) return null;
  const size = Number(stat.size), length = prefix ?? size;
  if (length > size) throw new Error("review output prefix was truncated");
  const hash = createHash("sha256");
  let bytes = 0;
  if (length > 0) {
    const stream = fs.createReadStream(file, { flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      end: length - 1, signal: AbortSignal.timeout(Math.max(1, Math.floor(captureDeadline(deadline)))) });
    for await (const chunk of stream) {
      captureDeadline(deadline); bytes += chunk.length;
      if (bytes > length) throw new Error("review custody file grew during acquisition");
      hash.update(chunk);
    }
  }
  const after = physicalStat(file);
  if (bytes !== length || !after || ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"].some(key => after[key] !== stat[key])) {
    throw new Error("review custody file changed during acquisition");
  }
  captureDeadline(deadline);
  return { path: path.resolve(file), type: "regular", mode: Number(stat.mode & 0o7777n), bytes: length, sha256: hash.digest("hex") };
}

async function consumerInputCustody(cwd, evidenceDirectory, deadline, submissionFile) {
  const git = args => execFileSync("git", args, { cwd, encoding: null, maxBuffer: 64 * 1024 * 1024,
    timeout: Math.max(1, Math.floor(captureDeadline(deadline))), killSignal: "SIGKILL" });
  const root = fs.realpathSync(cwd);
  if (git(["rev-parse", "--show-toplevel"]).toString("utf8").trim() !== root) throw new Error("review custody cwd must be the Git root");
  const listed = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(git(["ls-files", "--others", "-z"]));
  if (listed && !listed.endsWith("\0")) throw new Error("incomplete Git custody path listing");
  const names = listed ? listed.slice(0, -1).split("\0") : [];
  if (new Set(names).size !== names.length) throw new Error("duplicate Git custody input path");
  const outputs = new Set(outputRoles(evidenceDirectory, submissionFile).values());
  if ([...outputs].some(file => !file.startsWith(root + path.sep))) throw new Error("review output custody escaped the consumer Git root");
  if (git(["ls-files", "--cached", "-z", "--", ...[...outputs].map(file => path.relative(root, file))]).length) {
    throw new Error("tracked input cannot become owned mutable output custody");
  }
  const rows = [];
  for (const name of names.sort()) {
    const file = path.resolve(root, name);
    if (!name || path.isAbsolute(name) || path.posix.normalize(name) !== name || !file.startsWith(root + path.sep)) {
      throw new Error("invalid Git custody input path");
    }
    if (outputs.has(file)) { physicalStat(file); continue; }
    const row = await fileCustody(file, deadline);
    if (!row) throw new Error("Git custody input disappeared during acquisition");
    rows.push({ ...row, path: name });
  }
  if (!git(["ls-files", "--others", "-z"]).equals(Buffer.from(listed, "utf8"))) throw new Error("Git custody input set changed during acquisition");
  return { files: rows, sha256: sha256(JSON.stringify(rows)) };
}

// Only the supervisor's actual serialized writes establish this expectation.
// The raw digest is exported separately, never inserted into its own file.
const recoveryWrites = new Map();
function heldRecovery(file) {
  const expected = recoveryWrites.get(path.resolve(file));
  const stat = physicalStat(file);
  if (!expected ? stat !== null : !stat || Number(stat.size) !== expected.bytes ||
      Number(stat.mode & 0o7777n) !== expected.mode || sha256(fs.readFileSync(file)) !== expected.sha256) {
    throw new Error("raw recovery output custody changed since supervisor write");
  }
  return expected;
}

/** Exact output lifecycle, independent of the immutable census. No review law is interpreted here. */
function outputCustody(directory, submissionFile, metadata) {
  const roles = outputRoles(directory, submissionFile), seals = new Map();
  const metadataFile = roles.get("recovery.json");
  const refresh = async (closingAttempt = null, deadline = performance.now() + MODEL_DISCOVERY_BUDGET_MS) => {
    heldRecovery(metadataFile);
    // Only these existing supervisor operations can create a sealed role.
    for (const record of metadata.attempts) {
      const retained = record.retained_submission_file;
      if (retained !== undefined) {
        if (record.attempt !== 1 || retained !== "submission-attempt-1.json") throw new Error("invalid retained output custody path");
        const actual = await fileCustody(roles.get(retained), deadline);
        if (!actual || actual.sha256 !== record.retained_submission_sha256) throw new Error("retained output custody changed");
        if (!seals.has(retained)) {
          const prior = seals.get("submission.json");
          if (!prior || !isDeepStrictEqual({ ...prior, path: actual.path }, actual) || physicalStat(submissionFile)) throw new Error("retained submission custody changed");
          seals.delete("submission.json"); seals.set(retained, actual);
        }
      }
      for (const [key, stem] of [["submit_json_transport", "review-submit-json"], ["final_input_coverage", "final-input-coverage"]]) {
        const proof = record[key];
        if (!proof) continue;
        for (const [field, suffix] of [["projection", "DERIVED"], ["omitted", "OMITTED"]]) {
          const name = `${stem}-attempt-1.${suffix}.ndjson`;
          if (record.attempt !== 1 || proof[`${field}_file`] !== name) throw new Error("invalid derived output custody path");
          const actual = await fileCustody(roles.get(name), deadline);
          if (!actual || actual.sha256 !== proof[`${field}_sha256`]) throw new Error("derived output custody changed");
          if (!seals.has(name)) seals.set(name, actual);
        }
      }
    }
    for (const [name, file] of roles) {
      if (name === "recovery.json") continue;
      const previous = seals.get(name), actual = await fileCustody(file, deadline);
      const childOwned = closingAttempt !== null && ["submission.json", "review-events.jsonl",
        `model-response-attempt-${closingAttempt}.txt`, `opencode-stderr-attempt-${closingAttempt}.log`].includes(name);
      if (childOwned) {
        if (name === "review-events.jsonl" && previous) {
          const prefix = await fileCustody(file, deadline, previous.bytes);
          if (!prefix || prefix.sha256 !== previous.sha256 || prefix.mode !== previous.mode) throw new Error("review event output prefix changed");
        }
        if (actual) seals.set(name, actual);
        else if (previous) throw new Error("owned review output disappeared");
      } else if (!isDeepStrictEqual(actual, previous ?? null)) throw new Error(`sealed output custody changed: ${name}`);
    }
    if (physicalStat(path.resolve(directory, "submission-verification.json"))) throw new Error("pre-existing final output custody");
    metadata.output_custody = Object.fromEntries(seals);
  };
  return refresh;
}

async function verifyOutputFiles(directory, submissionFile, metadata, deadline = performance.now() + MODEL_DISCOVERY_BUDGET_MS) {
  const roles = outputRoles(directory, submissionFile), seals = metadata.output_custody;
  if (!seals || typeof seals !== "object" || Array.isArray(seals)) throw new Error("missing final output custody");
  if (Object.keys(seals).some(name => !roles.has(name) || name === "recovery.json")) throw new Error("unknown final output custody role");
  for (const [name, file] of roles) if (name !== "recovery.json" && !isDeepStrictEqual(await fileCustody(file, deadline), seals[name] ?? null)) {
    throw new Error(`final sealed output custody changed: ${name}`);
  }
  for (const record of metadata.attempts) {
    for (const [field, name] of [["response", `model-response-attempt-${record.attempt}.txt`], ["stderr", `opencode-stderr-attempt-${record.attempt}.log`]]) {
      if (![1, 2].includes(record.attempt) || record[`${field}_file`] !== name || seals[name]?.sha256 !== record[`${field}_sha256`]) throw new Error("final attempt output custody mismatch");
    }
    if (record.retained_submission_file && (record.attempt !== 1 || record.retained_submission_file !== "submission-attempt-1.json" ||
        seals[record.retained_submission_file]?.sha256 !== record.retained_submission_sha256)) throw new Error("final retained output custody mismatch");
    for (const [key, stem] of [["submit_json_transport", "review-submit-json"], ["final_input_coverage", "final-input-coverage"]]) if (record[key]) {
      for (const [field, suffix] of [["projection", "DERIVED"], ["omitted", "OMITTED"]]) {
        const name = `${stem}-attempt-1.${suffix}.ndjson`, proof = record[key];
        if (record.attempt !== 1 || proof[`${field}_file`] !== name || seals[name]?.sha256 !== proof[`${field}_sha256`]) throw new Error("final projection output custody mismatch");
      }
    }
  }
  if (seals["submission.json"]?.sha256 !== metadata.accepted_invocation?.submission_sha256) throw new Error("final submission output custody mismatch");
}

/** Decode the ID-line/pretty-JSON format emitted by `opencode models --verbose`. */
export function parseOpenCodeModelCatalog(bytes) {
  const text = stripVTControlCharacters(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  const lines = text.split(/\r?\n/);
  while (lines[0]?.trim() === "") lines.shift();
  if (lines[0] === "Models cache refreshed") lines.shift();
  const rows = [], labels = new Set();
  let label = null, body = [];
  const finish = () => {
    if (label === null) return;
    let row;
    try { row = JSON.parse(body.join("\n")); }
    catch { throw new Error("invalid OpenCode verbose model JSON"); }
    if (!row || typeof row !== "object" || Array.isArray(row) ||
        row.providerID !== "opencode" || label !== `opencode/${row.id}` || row.api?.id !== row.id) {
      throw new Error("OpenCode catalog label/metadata identity mismatch");
    }
    rows.push(row);
  };
  for (const line of lines) {
    if (/^opencode\/\S+$/.test(line)) { // IDs stay raw.
      finish();
      if (labels.has(line)) throw new Error("duplicate OpenCode catalog model ID");
      labels.add(line); label = line; body = [];
    } else if (label !== null) body.push(line);
    else if (line.trim() !== "") throw new Error("unsupported OpenCode verbose catalog prefix");
  }
  finish();
  if (rows.length === 0) throw new Error("empty OpenCode verbose catalog");
  return rows;
}

/** Compare numeric version tuples without lexicographic ordering or changing native IDs. */
function compareModelVersions(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Select only an active, tool-capable, wholly zero-cost OpenCode MiMo Flash catalog row. */
export function selectFreeMiMoFlash(rows, requested = "") {
  if (typeof requested !== "string") throw new Error("explicit review model must be a string");
  const zeroPrice = (price) => price && price.input === 0 && price.output === 0 &&
    price.cache?.read === 0 && price.cache?.write === 0;
  const eligible = [];
  for (const row of rows) {
    const version = /^mimo-v(\d+(?:\.\d+)*)-flash-free$/.exec(row.id);
    if (row.providerID !== "opencode" || row.family !== "mimo" || !version ||
        row.status !== "active" || row.capabilities?.toolcall !== true ||
        row.capabilities.input?.text !== true || row.capabilities.output?.text !== true ||
        !zeroPrice(row.cost) || (row.cost.tiers !== undefined &&
          (!Array.isArray(row.cost.tiers) || !row.cost.tiers.every(zeroPrice))) ||
        (row.cost.experimentalOver200K !== undefined && !zeroPrice(row.cost.experimentalOver200K))) continue;
    const components = version[1].split(".").map(Number);
    const date = typeof row.release_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.release_date)
      ? new Date(`${row.release_date}T00:00:00Z`) : null;
    if (!components.every(Number.isSafeInteger) || !date || !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== row.release_date) {
      throw new Error("eligible MiMo Flash catalog row has no rankable release/version");
    }
    eligible.push({ row, version: components });
  }
  if (requested !== "") {
    const selected = eligible.filter(({ row }) => `opencode/${row.id}` === requested);
    if (selected.length !== 1) throw new Error("explicit review model is not a unique eligible free MiMo Flash row");
    return selected[0].row;
  }
  if (eligible.length === 0) throw new Error("no eligible free OpenCode MiMo Flash model");
  const dateMaximum = eligible.reduce((date, { row }) => row.release_date > date ? row.release_date : date, "");
  const versionMaximum = eligible.reduce((version, candidate) =>
    compareModelVersions(candidate.version, version) > 0 ? candidate.version : version, []);
  const byDate = eligible.filter(({ row }) => row.release_date === dateMaximum);
  const byVersion = eligible.filter(({ version }) => compareModelVersions(version, versionMaximum) === 0);
  if (byDate.length !== 1 || byVersion.length !== 1 || byDate[0] !== byVersion[0]) {
    throw new Error("ambiguous latest free MiMo Flash release/version");
  }
  return byDate[0].row;
}

/** Capture one catalog command under the shared discovery deadline, retaining all output bytes. */
async function captureModelCommand({ binary, args, environment, cwd, deadline, directory, stem }) {
  const stdoutFile = path.join(directory, `${stem}.stdout`), stderrFile = path.join(directory, `${stem}.stderr`);
  const stdout = fs.createWriteStream(stdoutFile, { flags: "wx", mode: 0o600 });
  const stderr = fs.createWriteStream(stderrFile, { flags: "wx", mode: 0o600 });
  const streams = Promise.allSettled([finished(stdout), finished(stderr)]);
  let child, timeout, force, timedOut = false, exit, failure, capturesClosed = false;
  let stdoutBytes = 0, stderrBytes = 0;
  const kill = signal => {
    if (!child?.pid) return;
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") failure ??= error; }
  };
  const terminate = () => {
    kill("SIGTERM");
    force ??= setTimeout(() => kill("SIGKILL"), Math.max(0, Math.min(250, deadline - performance.now())));
  };
  const collect = (output, stream) => bytes => {
    if (stream === "stdout") stdoutBytes += bytes.length; else stderrBytes += bytes.length;
    if ((stream === "stdout" ? stdoutBytes : stderrBytes) > 2 * 1024 * 1024) {
      failure ??= new Error("OpenCode catalog capture exceeded stream bound"); terminate();
    } else output.write(bytes);
  };
  for (const output of [stdout, stderr]) output.on("error", error => { failure ??= error; terminate(); });
  try {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Error("OpenCode model discovery deadline expired");
    child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], env: environment, cwd, detached: true });
    child.stdout.on("data", collect(stdout, "stdout")); child.stderr.on("data", collect(stderr, "stderr"));
    timeout = setTimeout(() => {
      timedOut = true; terminate();
    }, Math.max(0, remaining - 250));
    exit = await new Promise(resolve => {
      child.once("error", error => { failure ??= error; });
      // A normally exiting parent may leave a helper holding its pipes. Close
      // the entire owned group and await close, as with config acquisition.
      child.once("exit", terminate);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
  } catch (error) { failure = error; }
  finally {
    clearTimeout(timeout); kill("SIGKILL");
    stdout.end(); stderr.end();
    const closed = await streams;
    clearTimeout(force);
    capturesClosed = closed.every(({ status }) => status === "fulfilled");
    if (!failure && closed.some(({ status }) => status === "rejected")) failure = new Error("OpenCode catalog capture failed");
  }
  if (performance.now() >= deadline) { timedOut = true; failure ??= new Error("OpenCode model discovery deadline expired"); }
  const record = { command: [binary, ...args], cwd, exit_code: exit?.code ?? null,
    signal: exit?.signal ?? null, timed_out: timedOut, captures_closed: capturesClosed,
    stdout_file: path.basename(stdoutFile), stderr_file: path.basename(stderrFile),
    stdout_sha256: sha256(fs.readFileSync(stdoutFile)), stderr_sha256: sha256(fs.readFileSync(stderrFile)) };
  if (failure) record.capture_error = "OpenCode catalog command/capture failed";
  return record;
}

/** Fetch exact public catalog bytes independently of OpenCode's swallowed refresh errors. */
export async function acquireOpenCodeModelCatalog(directory, deadline) {
  const file = path.join(directory, "model-catalog-source.json");
  const responseFile = path.join(directory, "model-catalog-source-response.json");
  const controller = new AbortController();
  const remaining = deadline - performance.now();
  if (remaining <= 0) throw new Error("OpenCode model discovery deadline expired");
  const timer = setTimeout(() => controller.abort(), remaining);
  const record = { schema: "open-hax.review-model-catalog-response/v1", requested_url: MODEL_CATALOG_URL,
    response_url: null, status: null, body_complete: false, json_valid: false, observed_bytes: 0,
    max_bytes: MODEL_CATALOG_MAX_BYTES, timeout_ms: remaining };
  const chunks = [];
  let response, reader, body, catalog, failure;
  try {
    response = await globalThis.fetch(MODEL_CATALOG_URL, { redirect: "error", credentials: "omit",
      cache: "no-store", signal: controller.signal, headers: { "Accept": "application/json" } });
    record.response_url = response.url; record.status = response.status;
    record.headers = Object.fromEntries(["content-type", "date", "etag", "last-modified", "cache-control", "cf-cache-status"]
      .map(name => [name, response.headers.get(name)]).filter(([, value]) => value !== null));
    if (response.status !== 200 || response.url !== MODEL_CATALOG_URL || response.redirected || !response.body) {
      throw new Error("OpenCode public model catalog response refused");
    }
    reader = response.body.getReader();
    for (;;) {
      if (controller.signal.aborted || performance.now() >= deadline) throw new Error("OpenCode public model catalog deadline expired");
      const next = await reader.read();
      if (next.done) { record.body_complete = true; break; }
      const bytes = Buffer.from(next.value);
      const available = MODEL_CATALOG_MAX_BYTES - record.observed_bytes;
      record.observed_bytes += bytes.length;
      if (available > 0) chunks.push(bytes.subarray(0, available));
      if (record.observed_bytes > MODEL_CATALOG_MAX_BYTES) throw new Error("OpenCode public model catalog exceeds byte bound");
    }
    if (controller.signal.aborted || performance.now() >= deadline) throw new Error("OpenCode public model catalog deadline expired");
    body = Buffer.concat(chunks);
    catalog = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body));
    if (!catalog || typeof catalog !== "object" || Array.isArray(catalog) ||
        !catalog.opencode || catalog.opencode.id !== "opencode" ||
        !catalog.opencode.models || typeof catalog.opencode.models !== "object" || Array.isArray(catalog.opencode.models)) {
      throw new Error("OpenCode public model catalog shape refused");
    }
    if (controller.signal.aborted || performance.now() >= deadline) throw new Error("OpenCode public model catalog deadline expired");
    record.json_valid = true;
  } catch (error) { failure = error; }
  finally {
    clearTimeout(timer);
    if (!record.body_complete) {
      try { if (reader) await reader.cancel(); else if (response?.body) await response.body.cancel(); }
      catch (error) { failure ??= error; }
    }
    if (reader) { try { reader.releaseLock(); } catch (error) { failure ??= error; } }
    record.aborted = controller.signal.aborted;
    body ??= Buffer.concat(chunks);
    record.bytes = body.length; record.sha256 = sha256(body);
    if (failure) record.error = failure instanceof Error ? failure.message : "OpenCode public model catalog acquisition failed";
    fs.writeFileSync(file, body, { flag: "wx", mode: 0o600 });
    fs.writeFileSync(responseFile, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  }
  if (failure) throw failure;
  return { catalog, binding: { file: path.basename(file), path: file, bytes: body.length, sha256: record.sha256,
    response_file: path.basename(responseFile), response_sha256: sha256(fs.readFileSync(responseFile)) } };
}

/** Project explicit raw eligibility metadata through the pinned client's field mapping. */
function sourceModelRows(catalog) {
  const provider = catalog.opencode;
  const price = cost => cost && Object.hasOwn(cost, "input") && Object.hasOwn(cost, "output")
    ? { input: cost.input, output: cost.output, cache: { read: cost.cache_read ?? 0, write: cost.cache_write ?? 0 } } : null;
  return Object.entries(provider.models).map(([id, raw]) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.id !== id) {
      throw new Error("OpenCode raw catalog model identity mismatch");
    }
    const cost = price(raw.cost);
    if (cost && raw.cost.tiers !== undefined) cost.tiers = Array.isArray(raw.cost.tiers)
      ? raw.cost.tiers.map(tier => { const value = price(tier); return value ? { ...value, tier: tier.tier } : null; }) : raw.cost.tiers;
    if (cost && raw.cost.context_over_200k !== undefined) cost.experimentalOver200K = price(raw.cost.context_over_200k);
    return { id, providerID: provider.id, family: raw.family, status: raw.status ?? "active", release_date: raw.release_date,
      api: { id: raw.id, url: raw.provider?.api ?? provider.api ?? "", npm: raw.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible" },
      capabilities: { toolcall: raw.tool_call === true,
        input: { text: Array.isArray(raw.modalities?.input) && raw.modalities.input.includes("text") },
        output: { text: Array.isArray(raw.modalities?.output) && raw.modalities.output.includes("text") } }, cost };
  });
}

/** Reuse the existing selector on both datasets so a bundled stale subset cannot downgrade selection. */
function assertCatalogSelection(catalog, selected, requested) {
  const expected = selectFreeMiMoFlash(sourceModelRows(catalog), requested);
  const effective = { id: selected.id, providerID: selected.providerID, family: selected.family,
    status: selected.status, release_date: selected.release_date,
    api: { id: selected.api.id, url: selected.api.url, npm: selected.api.npm },
    capabilities: { toolcall: selected.capabilities.toolcall,
      input: { text: selected.capabilities.input.text }, output: { text: selected.capabilities.output.text } }, cost: selected.cost };
  if (!isDeepStrictEqual(expected, effective)) {
    throw new Error("OpenCode effective selection differs from fresh raw catalog selection");
  }
  return sha256(JSON.stringify(catalog.opencode.models[expected.id]));
}

/** Recheck the retained physical catalog carrier before and after every child. */
function readCatalogSource(source, directory, privateCarrier = true) {
  if (!source || source.file !== "model-catalog-source.json" ||
      source.response_file !== "model-catalog-source-response.json" || source.path !== path.join(directory, source.file)) {
    throw new Error("OpenCode fresh model catalog binding is unavailable");
  }
  for (const [file, expected, bytes] of [[source.path, source.sha256, source.bytes],
    [path.join(directory, source.response_file), source.response_sha256, null]]) {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || fs.realpathSync(file) !== path.resolve(file) ||
        (privateCarrier && ((info.mode & 0o777) !== 0o600 || (typeof process.getuid === "function" && info.uid !== process.getuid()))) ||
        (bytes !== null && info.size !== bytes) || sha256(fs.readFileSync(file)) !== expected) {
      throw new Error("OpenCode fresh model catalog carrier changed");
    }
  }
  const response = JSON.parse(fs.readFileSync(path.join(directory, source.response_file), "utf8"));
  if (response.requested_url !== MODEL_CATALOG_URL || response.response_url !== MODEL_CATALOG_URL ||
      response.status !== 200 || !response.body_complete || !response.json_valid || response.aborted || response.error ||
      response.bytes !== source.bytes || response.sha256 !== source.sha256) {
    throw new Error("OpenCode fresh model catalog response is unestablished");
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(source.path)));
}

function assertCatalogSource(binding) {
  const catalog = readCatalogSource(binding.proof.catalog_source, path.dirname(binding.file));
  if (assertCatalogSelection(catalog, binding.proof.selected_row, binding.proof.requested_model) !== binding.proof.selected_source_row_sha256) {
    throw new Error("OpenCode fresh selected catalog row changed");
  }
}

/** Verify retained discovery artifacts without requiring the assessor's removed HOME or executable. */
function discoveryArtifactProof(directory, expectedSHA256, expectedVersion) {
  const read = (name, expected) => {
    const file = path.join(directory, name), info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || fs.realpathSync(file) !== path.resolve(file)) {
      throw new Error("OpenCode model discovery artifact is not a physical regular file");
    }
    const bytes = fs.readFileSync(file);
    if (sha256(bytes) !== expected) throw new Error("OpenCode model discovery artifact changed");
    return bytes;
  };
  const proof = JSON.parse(read("model-discovery.json", expectedSHA256));
  if (proof.schema !== "open-hax.review-model-discovery/v1" || proof.status !== "selected" ||
      typeof expectedVersion !== "string" || proof.declared_version !== expectedVersion ||
      proof.observed_version !== expectedVersion || typeof proof.requested_model !== "string" ||
      proof.mode !== (proof.requested_model === "" ? "latest" : "explicit") || proof.error || proof.cleanup_error ||
      proof.discovery_context?.removed !== true || !path.isAbsolute(proof.binary?.real_path ?? "") ||
      !/^[0-9a-f]{64}$/.test(proof.binary?.sha256 ?? "") ||
      !Array.isArray(proof.commands) || proof.commands.length !== 2) {
    throw new Error("OpenCode model discovery proof is unestablished");
  }
  for (const [index, stem, args] of [[0, "model-version", ["--version"]],
    [1, "model-catalog", ["models", "opencode", "--verbose"]]]) {
    const command = proof.commands[index];
    if (!command || !isDeepStrictEqual(command.command, [proof.binary.real_path, ...args]) ||
        command.cwd !== proof.discovery_context.cwd || command.exit_code !== 0 || command.signal !== null ||
        command.timed_out !== false || command.captures_closed !== true || command.capture_error ||
        command.stdout_file !== `${stem}.stdout` || command.stderr_file !== `${stem}.stderr`) {
      throw new Error("OpenCode model discovery command is unestablished");
    }
    for (const stream of ["stdout", "stderr"]) read(command[`${stream}_file`], command[`${stream}_sha256`]);
  }
  if (stripVTControlCharacters(read("model-version.stdout", proof.commands[0].stdout_sha256).toString("utf8")).trim() !== expectedVersion ||
      proof.catalog_sha256 !== proof.commands[1].stdout_sha256) {
    throw new Error("OpenCode retained model version/catalog mismatch");
  }
  // Artifact download relocates files and normalizes Unix modes. The exact
  // recorded bytes remain bound; assess separately enforces private custody.
  const source = { ...proof.catalog_source, path: path.join(directory, "model-catalog-source.json") };
  const catalog = readCatalogSource(source, directory, false);
  const selected = selectFreeMiMoFlash(parseOpenCodeModelCatalog(read("model-catalog.stdout", proof.catalog_sha256)), proof.requested_model);
  if (!isDeepStrictEqual(selected, proof.selected_row) ||
      sha256(JSON.stringify(selected)) !== proof.selected_row_sha256 ||
      assertCatalogSelection(catalog, selected, proof.requested_model) !== proof.selected_source_row_sha256 ||
      proof.selected_model !== `opencode/${selected.id}`) {
    throw new Error("OpenCode retained model selection mismatch");
  }
  return proof;
}

/** Reuse the checked selector at native publication, granting no review or publication authority. */
export function verifyModelDiscoveryArtifacts(directory, recovery, expectedVersion) {
  const binding = recovery?.model_discovery, accepted = recovery?.accepted_invocation;
  if (binding?.file !== "model-discovery.json" || !/^[0-9a-f]{64}$/.test(binding.sha256 ?? "") ||
      accepted?.model_discovery_sha256 !== binding.sha256 || accepted?.model !== binding.selected_model) {
    throw new Error("accepted invocation does not bind OpenCode model discovery");
  }
  const proof = discoveryArtifactProof(directory, binding.sha256, expectedVersion);
  if (proof.selected_model !== binding.selected_model) throw new Error("accepted OpenCode model selection changed");
  return { file: binding.file, sha256: binding.sha256, selected_model: proof.selected_model };
}

/** Resolve the same executable selected by Node's PATH lookup and retain its physical bytes. */
function modelBinaryIdentity(binary, environment) {
  const candidates = binary.includes(path.sep) ? [path.resolve(binary)] :
    (environment.PATH || "").split(path.delimiter).map((directory) => path.resolve(directory || ".", binary));
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      const real = fs.realpathSync(candidate);
      if (fs.statSync(real).isFile()) return { requested: binary, real_path: real, sha256: sha256(fs.readFileSync(real)) };
    } catch { /* Try the next actual PATH entry. */ }
  }
  throw new Error("OpenCode executable is unavailable for model discovery");
}

/** Construct a model environment without inherited credentials or OpenCode overrides. */
function isolatedModelEnvironment(environment, home) {
  return {
    PATH: environment.PATH || "/usr/bin:/bin", HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"), XDG_DATA_HOME: path.join(home, ".local/share"),
    XDG_CACHE_HOME: path.join(home, ".cache"), XDG_STATE_HOME: path.join(home, ".local/state"),
    TMPDIR: path.join(home, "tmp"),
    OPENCODE_CONFIG_DIR: path.join(home, ".config/opencode"),
    OPENCODE_DISABLE_PROJECT_CONFIG: "true", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC",
  };
}

/** Bind the three trusted review configuration carriers staged by the owning workflow. */
function ordinaryInferenceConfiguration() {
  const home = process.env.REVIEW_CHILD_HOME;
  if (!home || !path.isAbsolute(home)) throw new Error("owned ordinary review child home is required");
  const info = fs.lstatSync(home);
  if (!info.isDirectory() || info.isSymbolicLink() || fs.realpathSync(home) !== path.resolve(home)
      || (info.mode & 0o777) !== 0o700
      || (typeof process.getuid === "function" && info.uid !== process.getuid())) {
    throw new Error("ordinary review child home must be an owned private real directory");
  }
  const files = ["opencode.json", "agents/github-reviewer.md", "plugins/eta-mu-actors.js"].map((relative) => {
    const file = path.join(home, ".config/opencode", relative), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(file) !== file || stat.size === 0) {
      throw new Error("trusted ordinary review configuration must be nonempty regular physical files");
    }
    return { path: file, sha256: sha256(fs.readFileSync(file)) };
  });
  for (const relative of [".opencode", ".config/opencode/config", ".config/opencode/config.json", ".config/opencode/opencode.jsonc"]) {
    if (fs.existsSync(path.join(home, relative))) throw new Error("unexpected ordinary review configuration overlay");
  }
  return { home, files };
}

/** Recheck the trusted carriers without reading an auth store or permitting project overlays. */
function assertInferenceConfiguration(configuration) {
  const current = ordinaryInferenceConfiguration();
  if (!isDeepStrictEqual(current, configuration)) throw new Error("trusted ordinary review configuration changed");
}

/** Recheck the exact discovery proof/output/executable before and after every model attempt. */
function assertModelDiscovery(binding) {
  if (binding.proof.inference_configuration) assertInferenceConfiguration(binding.proof.inference_configuration);
  assertCatalogSource(binding);
  discoveryArtifactProof(path.dirname(binding.file), binding.sha256, binding.proof.declared_version);
  if (sha256(fs.readFileSync(binding.file)) !== binding.sha256 ||
      sha256(fs.readFileSync(binding.proof.binary.real_path)) !== binding.proof.binary.sha256) {
    throw new Error("OpenCode model discovery proof/executable changed");
  }
  for (const command of binding.proof.commands) for (const stream of ["stdout", "stderr"]) {
    if (sha256(fs.readFileSync(path.join(path.dirname(binding.file), command[`${stream}_file`]))) !== command[`${stream}_sha256`]) {
      throw new Error("OpenCode model discovery output changed");
    }
  }
}

/** Discover a fresh anonymous OpenCode catalog once; selection is provenance, never review admission. */
export async function discoverFreeMiMoFlash({ evidenceDirectory, requested = "", expectedVersion,
  binary = process.env.OPENCODE_BIN || "opencode", environment = { ...process.env }, inferenceConfiguration = null }) {
  if (typeof expectedVersion !== "string" || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(expectedVersion)) {
    throw new Error("declared OpenCode version is required for model discovery");
  }
  const proofFile = path.join(evidenceDirectory, "model-discovery.json");
  freshOutputRoles(evidenceDirectory, path.join(evidenceDirectory, "submission.json"), true);
  const names = ["model-discovery.json", "model-version.stdout", "model-version.stderr", "model-catalog.stdout", "model-catalog.stderr",
    "model-catalog-source.json", "model-catalog-source-response.json", "recovery.json", "submission.json", ...[1, 2].flatMap((attempt) => [`model-response-attempt-${attempt}.txt`, `opencode-stderr-attempt-${attempt}.log`])];
  if (names.some((name) => fs.existsSync(path.join(evidenceDirectory, name)))) {
    throw new Error("refusing pre-existing model discovery/invocation evidence");
  }
  const isolationRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "opencode-model-discovery-")));
  const home = path.join(isolationRoot, "home"), cwd = path.join(isolationRoot, "work");
  for (const directory of [home, cwd, path.join(home, "tmp")]) fs.mkdirSync(directory, { mode: 0o700 });
  const childEnvironment = { ...isolatedModelEnvironment(environment, home), OPENCODE_PURE: "true" };
  const proof = { schema: "open-hax.review-model-discovery/v1", mode: requested === "" ? "latest" : "explicit",
    requested_model: requested, declared_version: expectedVersion, status: "refused", commands: [], selected_model: null,
    discovery_context: { cwd, home, project_configuration: "disabled", inherited_environment: false },
    inference_configuration: inferenceConfiguration };
  const deadline = performance.now() + MODEL_DISCOVERY_BUDGET_MS;
  let failure;
  try {
    proof.binary = modelBinaryIdentity(binary, childEnvironment);
    const version = await captureModelCommand({ binary: proof.binary.real_path, args: ["--version"], environment: childEnvironment, cwd, deadline, directory: evidenceDirectory, stem: "model-version" });
    proof.commands.push(version);
    if (version.exit_code !== 0 || version.signal !== null || version.timed_out || !version.captures_closed || version.capture_error) throw new Error("OpenCode version discovery failed");
    proof.observed_version = stripVTControlCharacters(fs.readFileSync(path.join(evidenceDirectory, version.stdout_file), "utf8")).trim();
    if (proof.observed_version !== expectedVersion) throw new Error("OpenCode installed/declared version mismatch");
    const acquired = await acquireOpenCodeModelCatalog(evidenceDirectory, deadline);
    proof.catalog_source = acquired.binding;
    const catalogEnvironment = { ...childEnvironment, OPENCODE_MODELS_PATH: acquired.binding.path,
      OPENCODE_DISABLE_MODELS_FETCH: "true" };
    readCatalogSource(proof.catalog_source, evidenceDirectory);
    const catalog = await captureModelCommand({ binary: proof.binary.real_path, args: ["models", "opencode", "--verbose"], environment: catalogEnvironment, cwd, deadline, directory: evidenceDirectory, stem: "model-catalog" });
    proof.commands.push(catalog);
    if (catalog.exit_code !== 0 || catalog.signal !== null || catalog.timed_out || !catalog.captures_closed || catalog.capture_error) throw new Error("OpenCode model catalog discovery failed");
    const rows = parseOpenCodeModelCatalog(fs.readFileSync(path.join(evidenceDirectory, catalog.stdout_file)));
    const selected = selectFreeMiMoFlash(rows, requested);
    proof.selected_source_row_sha256 = assertCatalogSelection(readCatalogSource(proof.catalog_source, evidenceDirectory), selected, requested);
    proof.catalog_sha256 = catalog.stdout_sha256;
    proof.selected_row = selected; proof.selected_row_sha256 = sha256(JSON.stringify(selected));
    proof.selected_model = `opencode/${selected.id}`; proof.status = "selected";
  } catch (error) { failure = error; }
  finally {
    try { fs.rmSync(isolationRoot, { recursive: true, force: true }); proof.discovery_context.removed = true; }
    catch (error) { proof.cleanup_error = "OpenCode discovery home cleanup failed"; failure ??= error; }
  }
  if (failure) {
    proof.status = "refused";
    proof.error = failure instanceof Error ? failure.message : "OpenCode model discovery failed";
    fs.writeFileSync(proofFile, `${JSON.stringify(proof, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    throw failure;
  }
  fs.writeFileSync(proofFile, `${JSON.stringify(proof, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  const binding = { file: proofFile, sha256: sha256(fs.readFileSync(proofFile)), proof };
  assertModelDiscovery(binding);
  return binding;
}


/**
 * Hash captured bytes without interpreting their contents.
 * @param {string|Buffer|TypedArray|DataView} bytes - Hash input.
 * @returns {string} Hexadecimal SHA-256 digest.
 */
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Return whether the submission file is missing, parseable JSON, or malformed. */
function submissionState(submissionFile) {
  if (!fs.existsSync(submissionFile)) return "missing";
  try {
    JSON.parse(fs.readFileSync(submissionFile, "utf8"));
    return "present";
  } catch {
    return "malformed";
  }
}

/** Return verified unavailable-tool evidence, or null when any recovery guard fails. */
function unavailableReviewTool(responseFile, stderrFile, reviewTools, exposedTools, strict = false) {
  // Only host-produced structured tool events can identify the failed call.
  // Model prose and tool output are nested strings, never control messages.
  try {
    const response = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(responseFile));
    const events = response.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
    const sessionID = events[0]?.sessionID;
    if (typeof sessionID !== "string" || !sessionID) return null;
    if (events.some((event) => event.sessionID !== sessionID || !Number.isSafeInteger(event.timestamp))) return null;
    const errors = events.filter((event) => event.type === "error");
    const permissionError = "The user rejected permission to use this specific tool call.";
    if (errors.length === 0 || events.at(-1).type !== "error" ||
        errors.some((event) => event.error?.name !== "UnknownError" || event.error?.data?.message !== permissionError)) return null;

    // The third internal call is rejected before it completes. The pinned CLI
    // emits the preceding two completed calls and then a session error, not a
    // third permission-error tool result. Retain only actually emitted IDs.
    const toolCalls = events.filter((event) => event.type === "tool_use");
    const calls = toolCalls.slice(-2);
    if (calls.length !== 2) return null;
    if (strict) {
      // This exception covers only the recognized unavailable-tool tail. Earlier
      // failed or unestablished calls cannot become eligible through that tail.
      // Canonical review validity remains the supplied Muse callback's authority.
      if (toolCalls.some(({ part }) => part?.state?.status !== "completed" ||
          (part.state.error != null && part.state.error !== false))) return null;
      for (const { part } of toolCalls.slice(0, -2)) {
        if (part.tool === "invalid") return null;
        if (typeof part.tool === "string" && part.tool.startsWith("review_")) {
          if (typeof part.state.output !== "string" ||
              JSON.parse(part.state.output)?.["ok?"] !== true) return null;
        }
      }
    }
    const requested = calls[0].part?.state?.input?.tool;
    if (typeof requested !== "string" || !/^[a-z][a-z0-9_]+$/.test(requested)) return null;
    const corrected = `review_${requested}`;
    if (!reviewTools.includes(corrected)) return null;
    const expectedError = `Model tried to call unavailable tool '${requested}'. Available tools: `;
    if (calls.some(({ part }) => part?.type !== "tool" || part.sessionID !== sessionID ||
        part.tool !== "invalid" || part.state?.status !== "completed" ||
        part.state.input?.tool !== requested || typeof part.state.input?.error !== "string" ||
        !part.state.input.error.startsWith(expectedError) ||
        !part.state.input.error.slice(expectedError.length).replace(/\.$/, "").split(", ").includes(corrected) ||
        typeof part.callID !== "string" || !part.callID)) return null;
    if (new Set(calls.map(({ part }) => part.callID)).size !== 2) return null;
    const prefix = toolCalls.slice(0, -2);
    if (strict) {
      /**
       * Check that a transport identity field is a nonempty string after trimming.
       * @param {*} value - Field to check without coercion.
       * @returns {boolean} Whether the value is a string with non-whitespace content.
       */
      const nonblank = (value) => typeof value === "string" && value.trim().length > 0;
      if (events.some((event, index) => event.timestamp < 0 ||
          (index > 0 && event.timestamp < events[index - 1].timestamp))) return null;
      if (toolCalls.some(({ part }) => !nonblank(part?.id) || !nonblank(part.callID)) ||
          new Set(toolCalls.map(({ part }) => part.id)).size !== toolCalls.length ||
          new Set(toolCalls.map(({ part }) => part.callID)).size !== toolCalls.length) return null;
      if (prefix.some(({ part }) => part.type !== "tool" || part.sessionID !== sessionID ||
          !nonblank(part.tool) || !part.state.input || typeof part.state.input !== "object" ||
          Array.isArray(part.state.input) || typeof part.state.output !== "string")) return null;
      if (Array.isArray(exposedTools)) {
        // Retry eligibility is narrower than canonical HOST validity: bind
        // every prefix name to the caller's prepared registry and both HOST
        // availability reports. Muse alone owns generic HOST semantics.
        const available = calls.map(({ part }) =>
          part.state.input.error.slice(expectedError.length).replace(/\.$/, "").split(", "));
        if (prefix.some(({ part }) => !exposedTools.includes(part.tool) ||
            !available.every((names) => names.includes(part.tool)))) return null;
      }
    }
    const stderr = stripVTControlCharacters(fs.readFileSync(stderrFile, "utf8"));
    if (!stderr.split(/\r?\n/).some((line) => /^!\s+permission requested: doom_loop \(invalid\); auto-rejecting$/.test(line.trim()))) return null;
    return { tool: requested, corrected_tool: corrected, session_id: sessionID,
      call_ids: calls.map(({ part }) => part.callID) };
  } catch {
    return null;
  }
}

/**
 * Retain one known final submit-JSON transport projection for retry eligibility.
 * The original whole-trace refusal stays authoritative and is never accepted.
 * All review semantics, including prefix validity, remain the Muse callback's.
 */
async function submitJsonTransport({ metadata, metadataFile, responseFile, stderrFile,
  submissionFile, reviewTools, verifyReviewInvocation, expectedContext, contextSha256 }) {
  const record = metadata.attempts.at(-1);
  const original = record.canonical_verdict;
  if (original.ok !== false || original.reason !== "unestablished-review-trace" ||
      original.code !== "unavailable-host-tool" || original.violations.length !== 0 ||
      !reviewTools.includes("review_submit") || !Array.isArray(expectedContext.reviewTools) ||
      !expectedContext.reviewTools.includes("review_submit")) return null;
  const response = fs.readFileSync(responseFile);
  let lines, events, omitted;
  try {
    // Keep every other raw line and ending, including the actual final stop.
    lines = new TextDecoder("utf-8", { fatal: true }).decode(response).match(/[^\n]*\n|[^\n]+$/g) ?? [];
    if (!Buffer.from(lines.join("")).equals(response)) return null;
    events = lines.map((line, index) => line.trim() ? { event: JSON.parse(line), index } : null).filter(Boolean);
    const calls = events.filter(({ event }) => event.type === "tool_use");
    const invalid = calls.filter(({ event }) => event.part?.tool === "invalid");
    if (invalid.length !== 1 || invalid[0] !== calls.at(-1) ||
        calls.some(({ event }) => event.part?.tool === "review_submit")) return null;
    const { event, index } = invalid[0];
    const part = event.part, state = part.state, input = state?.input;
    const prefix = "Invalid input for tool review_submit: JSON parsing failed: Text: ";
    const suffix = "\nError message: JSON Parse error: Unterminated string";
    if (part.type !== "tool" || state?.status !== "completed" ||
        (state.error != null && state.error !== false) || input?.tool !== "review_submit" ||
        Object.keys(input).sort().join(",") !== "error,tool" || typeof input.error !== "string" ||
        !input.error.startsWith(prefix) || !input.error.endsWith(suffix) ||
        state.output !== `The arguments provided to the tool are invalid: ${input.error}` ||
        state.metadata?.truncated !== false) return null;
    const text = input.error.slice(prefix.length, -suffix.length);
    if (!text) return null;
    try { JSON.parse(text); return null; } catch { /* Actual malformed transport DATA only. */ }
    omitted = index;
  } catch { return null; }
  const projection = Buffer.from(lines.filter((_, index) => index !== omitted).join(""));
  const omittedBytes = Buffer.from(lines[omitted]);
  const directory = path.dirname(responseFile);
  const projectionFile = path.join(directory, "review-submit-json-attempt-1.DERIVED.ndjson");
  const omittedFile = path.join(directory, "review-submit-json-attempt-1.OMITTED.ndjson");
  const proof = { tier: "DERIVED_RETRY_ELIGIBILITY_ONLY", accepted_review: false,
    original_response_sha256: record.response_sha256,
    projection_file: path.basename(projectionFile), projection_sha256: sha256(projection),
    omitted_file: path.basename(omittedFile), omitted_sha256: sha256(omittedBytes),
    omitted_line: omitted + 1, tool: "review_submit",
    call_id: events.find(({ index }) => index === omitted).event.part.callID };
  record.submit_json_transport = proof;
  /** Recheck the original and derived custody; no callback may change evidence. */
  const unchanged = () => {
    if (sha256(response) !== record.response_sha256 ||
        sha256(fs.readFileSync(responseFile)) !== record.response_sha256 ||
        sha256(fs.readFileSync(stderrFile)) !== record.stderr_sha256 || fs.existsSync(submissionFile) ||
        sha256(JSON.stringify(expectedContext)) !== contextSha256 ||
        sha256(projection) !== proof.projection_sha256 ||
        sha256(fs.readFileSync(projectionFile)) !== proof.projection_sha256 ||
        sha256(fs.readFileSync(omittedFile)) !== proof.omitted_sha256) {
      throw new Error("submit JSON transport evidence changed during verification");
    }
  };
  try {
    fs.writeFileSync(projectionFile, projection, { flag: "wx" });
    fs.writeFileSync(omittedFile, omittedBytes, { flag: "wx" });
    unchanged();
    const verdict = verifierEnvelope(await verifyReviewInvocation(projection, null, expectedContext));
    proof.canonical_verdict = verdict;
    unchanged();
    proof.verification_state = "returned";
    writeRecovery(metadataFile, metadata);
    if (verdict.ok !== false || verdict.reason !== "missing-review-submit" ||
        verdict.code !== "healthy-unfinished-review" || verdict.violations.length !== 0) return null;
    return proof;
  } catch (error) {
    proof.verification_state = "rejected";
    proof.verification_error = error instanceof Error ? error.message : String(error);
    writeRecovery(metadataFile, metadata);
    throw error;
  }
}

/**
 * Recognize only the final adversarial-validation refusal for one unassessed
 * final input page. The same canonical callback validates the retained prefix;
 * this host-only projection grants retry eligibility, never review acceptance.
 */
async function finalInputCoverage({ metadata, metadataFile, responseFile, stderrFile,
  submissionFile, reviewTools, verifyReviewInvocation, expectedContext, contextSha256 }) {
  const record = metadata.attempts.at(-1), original = record.canonical_verdict;
  const count = expectedContext.pageCount;
  if (original.ok !== false || original.reason !== "unestablished-review-trace" ||
      original.code !== "stage-order" || original.violations.length !== 0 ||
      !reviewTools.includes("review_record_evidence") || !Array.isArray(expectedContext.reviewTools) ||
      !expectedContext.reviewTools.includes("review_record_evidence") ||
      !Number.isSafeInteger(count) || count < 1) return null;
  const response = fs.readFileSync(responseFile), directory = path.dirname(responseFile);
  const fullFile = path.join(directory, "basehead.diff"), manifestFile = path.join(directory, "input-manifest.json");
  let lines, omitted, call, fullDigest, manifestDigest;
  try {
    const full = fs.readFileSync(fullFile), manifest = fs.readFileSync(manifestFile);
    if (sha256(full) !== expectedContext.fullInputSha256 ||
        !isDeepStrictEqual(JSON.parse(manifest.toString("utf8")), expectedContext.inputSource)) return null;
    fullDigest = sha256(full); manifestDigest = sha256(manifest);
    lines = new TextDecoder("utf-8", { fatal: true }).decode(response).match(/[^\n]*\n|[^\n]+$/g) ?? [];
    if (!Buffer.from(lines.join("")).equals(response)) return null;
    const events = lines.map((line, index) => line.trim() ? { event: JSON.parse(line), index } : null).filter(Boolean);
    const session = events[0]?.event.sessionID, nonblank = (x) => typeof x === "string" && x.trim().length > 0;
    if (!nonblank(session) || events.some(({ event }, i) => event.sessionID !== session ||
        !Number.isSafeInteger(event.timestamp) || event.timestamp < 0 ||
        (i > 0 && event.timestamp < events[i - 1].event.timestamp)) ||
        events.at(-1)?.event.type !== "step_finish" || events.at(-1).event.part?.reason !== "stop") return null;
    const calls = events.filter(({ event }) => event.type === "tool_use");
    if (calls.some(({ event }) => event.part?.type !== "tool" || event.part.sessionID !== session ||
        !nonblank(event.part.id) || !nonblank(event.part.callID) ||
        event.part.state?.status !== "completed" || (event.part.state.error != null && event.part.state.error !== false)) ||
        new Set(calls.map(({ event }) => event.part.id)).size !== calls.length ||
        new Set(calls.map(({ event }) => event.part.callID)).size !== calls.length) return null;
    const failed = calls.filter(({ event }) => event.part.tool?.startsWith("review_") &&
      JSON.parse(event.part.state.output)?.["ok?"] !== true);
    if (failed.length !== 1 || failed[0] !== calls.at(-1) ||
        calls.some(({ event }) => event.part.tool === "review_submit" || event.part.tool === "invalid")) return null;
    const target = failed[0], part = target.event.part, state = part.state, output = JSON.parse(state.output);
    if (part.tool !== "review_record_evidence" || state.input?.stage !== "adversarial-validate" ||
        !nonblank(state.input.note) || Object.keys(output).sort().join(",") !== "error,ok?" ||
        output["ok?"] !== false || output.error !== `Unassessed full-input chunks remain: ${count}. Read and assess every changed hunk before publishing.` ||
        state.metadata?.truncated !== false) return null;
    // Extra narrow transport eligibility binds the recorded omission to the
    // prepared final page; canonical Muse still owns all review validity.
    const ids = (name) => calls.filter(({ event }) => event.part.tool === name).map(({ event }) => event.part.state.input?.id);
    const reads = ids("review_read_diff_chunk"), assessments = ids("review_assess_diff_chunk");
    const exact = (xs, size) => xs.length === size && new Set(xs).size === size &&
      xs.every((id) => Number.isSafeInteger(id) && id >= 1 && id <= size);
    const stages = calls.filter(({ event }) => event.part.tool === "review_record_evidence")
      .map(({ event }) => event.part.state.input?.stage);
    if (!exact(reads, count) || !exact(assessments, count - 1) ||
        stages.join(",") !== "deterministic,map-change,generate-candidates,adversarial-validate" ||
        stages.length !== 4) return null;
    omitted = target.index; call = part.callID;
  } catch { return null; }
  const projection = Buffer.from(lines.filter((_, index) => index !== omitted).join(""));
  const omittedBytes = Buffer.from(lines[omitted]);
  const projectionFile = path.join(directory, "final-input-coverage-attempt-1.DERIVED.ndjson");
  const omittedFile = path.join(directory, "final-input-coverage-attempt-1.OMITTED.ndjson");
  const proof = { tier: "DERIVED_RETRY_ELIGIBILITY_ONLY", accepted_review: false,
    original_response_sha256: record.response_sha256,
    projection_file: path.basename(projectionFile), projection_sha256: sha256(projection),
    omitted_file: path.basename(omittedFile), omitted_sha256: sha256(omittedBytes),
    omitted_line: omitted + 1, tool: "review_record_evidence", call_id: call,
    missing_final_page: expectedContext.pageCount, full_input_sha256: fullDigest,
    input_manifest_sha256: manifestDigest };
  record.final_input_coverage = proof;
  const unchanged = () => {
    if (sha256(response) !== record.response_sha256 ||
        sha256(fs.readFileSync(responseFile)) !== record.response_sha256 ||
        sha256(fs.readFileSync(stderrFile)) !== record.stderr_sha256 || fs.existsSync(submissionFile) ||
        sha256(JSON.stringify(expectedContext)) !== contextSha256 ||
        sha256(fs.readFileSync(fullFile)) !== fullDigest || sha256(fs.readFileSync(manifestFile)) !== manifestDigest ||
        sha256(projection) !== proof.projection_sha256 ||
        sha256(fs.readFileSync(projectionFile)) !== proof.projection_sha256 ||
        sha256(fs.readFileSync(omittedFile)) !== proof.omitted_sha256) {
      throw new Error("final input coverage evidence changed during verification");
    }
  };
  try {
    fs.writeFileSync(projectionFile, projection, { flag: "wx" });
    fs.writeFileSync(omittedFile, omittedBytes, { flag: "wx" });
    unchanged();
    const verdict = verifierEnvelope(await verifyReviewInvocation(projection, null, expectedContext));
    proof.canonical_verdict = verdict;
    unchanged(); proof.verification_state = "returned";
    writeRecovery(metadataFile, metadata);
    if (verdict.ok !== false || verdict.reason !== "missing-review-submit" ||
        verdict.code !== "healthy-unfinished-review" || verdict.violations.length !== 0) return null;
    return proof;
  } catch (error) {
    proof.verification_state = "rejected";
    proof.verification_error = error instanceof Error ? error.message : String(error);
    writeRecovery(metadataFile, metadata); throw error;
  }
}

/** Append the sole corrective-attempt instructions to the original review prompt. */
function correctivePrompt(basePrompt, toolFailure, staleCoverage = false, submitJsonFailure = false, coverageFailure = false) {
  const cause = toolFailure
    ? `the first model invocation failed without a review after repeatedly calling the unavailable tool ${toolFailure.tool}. Use the actual exposed name ${toolFailure.corrected_tool}; do not call the unavailable spelling again.`
    : submitJsonFailure
      ? "the first stopped process produced the known final review_submit JSON transport diagnostic without an actual submit or artifact. Its whole trace remains refused; the retained derived projection establishes retry eligibility only. In this fresh process, pass well-formed JSON arguments to the exposed review_submit tool."
    : coverageFailure
      ? "the first stopped process failed final adversarial validation because the final full-input page was read but not assessed. Its whole trace remains failed; a separately retained canonical healthy-omission projection supplies only retry eligibility. Read and assess every full-input page anew before completing all five stages and submitting in this sole fresh process."
    : staleCoverage
      ? "the canonical host-trace verifier established stale review coverage in the first completed invocation. Its assessment history cannot be repaired. Perform one fresh bounded model invocation over the whole unchanged input; finish all reads before assessing each page."
    : "the first completed model invocation omitted the required review_submit artifact.";
  return `${basePrompt.trimEnd()}

Corrective attempt 2 of 2: ${cause} Start the evidence-first review state machine
again with review_begin; do not assume any in-memory state survived the first
process. Complete every required stage and do not end until review_submit has
returned ok, unless a tool reports restart-required?. If restart-required? is
true, stop this invocation without calling review_submit; do not use review_begin
or reassessment to erase its failed history. This is the only recovery attempt.
`;
}

/** Override same-process repair instructions when canonical verification is required. */
function strictInvocationPrompt(prompt) {
  return `${prompt.trimEnd()}


Full-input assessment checkpoint before the first stage:
- If review_begin reports zero full-input chunks, skip page reads and assessments;
  retain staged-context reading and every evidence-stage requirement. Otherwise:
- After reading the final full-input page, explicitly assess that final page with
  review_assess_diff_chunk using its actual id, including a shorter final page,
  or include it once in review_assess_diff_batch using ACTUAL returned membership.
- Prefer exposed review_read_diff_batch / review_assess_diff_batch when the host
  reports the qualified profile. Request count 1–4 and follow actual batch.ids
  and next-id; the producer may select a smaller whole-page prefix. Assess every
  returned original page once with a distinct, nonblank substantive note and
  its actual id/start/end/sha256. Include the shorter FINAL partial group.
  Keep each note within 2048 UTF8 bytes and the complete request within 16384
  UTF8 bytes. Do not reread a page already assessed, synthesize single-page
  calls, combine invocation history or replace per-page notes with one summary.
  Any failed/truncated/refused batch stops this invocation without submission.
- Check the latest assessment response: coverage.assessed must equal
  coverage.chunks and coverage.missing must be empty before review_record_evidence.
  Delivered/read coverage alone does not prove assessment; do not infer completion.

Supporting-file HOST read contract for this restricted reviewer:
- Use the host read tool's exact filePath to read summary.json and
  deterministic.log under .opencode/review-evidence. Start at offset 1 with
  limit 200. Follow the tool's returned next offset until End of file; a byte
  cap can return fewer lines than requested. Retain all gate statuses, failure
  context and environment limits. Line-content clipping is not complete input;
  do not claim coverage of material you could not retrieve.
- The pinned host grep path parameter is a directory selector. A file-valued
  path can search its parent and generated artifacts. Optional grep must use
  path .opencode/review-evidence with include deterministic.log; use equivalent
  explicit file inclusion for other searches. Grep supplements, never replaces,
  the required complete deterministic evidence reading.
- Never use bash for file inspection, listing, size/count checks or executing
  commands. Its true-only registration is compatibility, not shell authority.
  General tool help suggesting Bash or Task does not override this reviewer.
- If a HOST tool has an actual lifecycle error (status:error or state.error),
  such as a denied bash operation or a failed read/search, STOP this invocation
  without further tool calls or submission. Only the caller may admit its
  existing narrowly typed fresh recovery. A completed invalid-tool transport
  diagnostic is distinct: it remains governed by the existing unavailable-tool
  protocol, not a new recovery rule. Do not repeat calls to manufacture a
  recoverable tail. Failed review_* results and restart-required replies retain
  their existing STOP protocol. Unknown HOST failures grant no retry authority
  and no accepted review.
- These instructions preserve every immutable full-diff page, assessment,
  stage, finding, source, submission, permission and verification guard.
Caller-only final submit-JSON transport exception:
A completed invalid-tool diagnostic for the already exposed review_submit name
is transport before an actual review tool call. STOP without any further calls
or submission. The failure alone is not retry authority. Only the caller may
admit one fresh process when its narrowly typed JSON-transport policy and the
unchanged canonical callback establish eligibility. The whole failed trace
remains refused; any separately retained derived projection is retry evidence
only, never an accepted review. All failed actual review calls, unknown HOST
failures, strict input/chronology guards and the existing two-attempt bound stay
unchanged. The fresh process must complete the whole review anew.

Caller-only final input-coverage exception:
STOP after the exact final adversarial-validation refusal for the unassessed
final input page. Do not repair or resume that invocation. The failure alone
is not retry authority. Only the caller may admit the sole fresh whole process
when its narrow recorded-failure policy and the unchanged canonical callback
establish retry eligibility over a separately retained projection. The original
failed invocation remains refused. All existing input, HOST, LAST, five-stage,
source, submission and two-attempt guards remain mandatory for the fresh review.

Strict invocation instructions override any earlier retry or repair instructions:
Every review tool call must succeed. If ANY review tool call fails, including
review_begin, any stage call, or review_submit, stop the current invocation
immediately without further review tool calls or submission. Never repair,
reset with review_begin, or reassess within a failed invocation.
Only the caller may start the sole fresh process, through the existing typed
stale-coverage, healthy-omission, or known-unavailable-tool recovery path.
Unknown failures must STOP without automatic retry. These instructions do not
waive any canonical result, verification guard, or the two-attempt bound.
`;
}

/** Write the current recovery metadata as formatted JSON with a trailing newline. */
function writeRecovery(metadataFile, metadata) {
  heldRecovery(metadataFile);
  const bytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`);
  fs.writeFileSync(metadataFile, bytes, { flag: recoveryWrites.has(path.resolve(metadataFile)) ? "w" : "wx", mode: 0o600 });
  const stat = physicalStat(metadataFile);
  recoveryWrites.set(path.resolve(metadataFile), { bytes: bytes.length, mode: Number(stat.mode & 0o7777n), sha256: sha256(bytes) });
}

/** Validate the callback's transport envelope, without implementing review law. */
function verifierEnvelope(raw) {
  let verdict;
  try {
    verdict = JSON.parse(JSON.stringify(raw));
  } catch (cause) {
    throw new Error("canonical verifier returned a non-serializable envelope", { cause });
  }
  if (!verdict || Array.isArray(verdict) || typeof verdict.ok !== "boolean" ||
      typeof verdict.code !== "string" || !verdict.code ||
      !Array.isArray(verdict.violations) || verdict.reasonKind !== verdict.reason) {
    throw new Error("canonical verifier returned an unestablished envelope");
  }
  if (verdict.ok) {
    const binding = verdict.acceptedInvocation;
    if (verdict.reason !== null || !binding || typeof binding !== "object" || Array.isArray(binding) ||
        typeof verdict.sessionID !== "string" || !verdict.sessionID ||
        binding.sessionID !== verdict.sessionID) {
      throw new Error("canonical verifier returned an inconsistent accepted binding");
    }
  } else if (typeof verdict.reason !== "string" || !verdict.reason || verdict.acceptedInvocation !== null) {
    throw new Error("canonical verifier returned an ambiguous refusal");
  }
  return verdict;
}

/** Verify retained bytes only after child completion, and record callback faults. */
async function verifyAttempt({ metadata, metadataFile, responseFile, stderrFile,
  submissionFile, verifyReviewInvocation, expectedContext }) {
  const record = metadata.attempts.at(-1);
  try {
    const response = fs.readFileSync(responseFile);
    const submission = fs.existsSync(submissionFile) ? fs.readFileSync(submissionFile) : null;
    record.response_sha256 = sha256(response);
    record.stderr_sha256 = sha256(fs.readFileSync(stderrFile));
    record.submission_sha256 = submission === null ? null : sha256(submission);
    const verdict = verifierEnvelope(await verifyReviewInvocation(response, submission, expectedContext));
    record.canonical_verdict = verdict;
    const currentSubmission = fs.existsSync(submissionFile) ? sha256(fs.readFileSync(submissionFile)) : null;
    if (sha256(fs.readFileSync(responseFile)) !== record.response_sha256 ||
        currentSubmission !== record.submission_sha256) {
      throw new Error("review evidence changed during canonical verification");
    }
    record.verification_state = "returned";
    writeRecovery(metadataFile, metadata);
    return verdict;
  } catch (error) {
    record.verification_state = "rejected";
    record.verification_error = error instanceof Error ? error.message : String(error);
    writeRecovery(metadataFile, metadata);
    throw error;
  }
}

/** Rename a rejected parseable artifact before the sole fresh child starts. */
function retainStaleSubmission({ metadata, metadataFile, submissionFile, evidenceDirectory }) {
  const record = metadata.attempts.at(-1);
  const retainedFile = path.join(evidenceDirectory, `submission-attempt-${record.attempt}.json`);
  try {
    if (fs.existsSync(retainedFile)) throw new Error(`refusing existing retained submission: ${retainedFile}`);
    fs.renameSync(submissionFile, retainedFile);
    record.retained_submission_file = path.basename(retainedFile);
    record.retained_submission_sha256 = sha256(fs.readFileSync(retainedFile));
    if (record.retained_submission_sha256 !== record.submission_sha256) {
      throw new Error("retained submission changed after canonical verification");
    }
    writeRecovery(metadataFile, metadata);
  } catch (error) {
    record.retention_error = error instanceof Error ? error.message : String(error);
    writeRecovery(metadataFile, metadata);
    throw error;
  }
}

/** Retain attempt output files and metadata, then return the submission state. */
function recordAttempt({
  metadata,
  metadataFile,
  attempt,
  result,
  invocationError,
  invocationRejected = false,
  responseFile,
  stderrFile,
  submissionFile,
}) {
  if (!physicalStat(responseFile)) fs.writeFileSync(responseFile, "", { flag: "wx", mode: 0o600 });
  if (!physicalStat(stderrFile)) fs.writeFileSync(stderrFile, "", { flag: "wx", mode: 0o600 });
  physicalStat(submissionFile);

  const state = submissionState(submissionFile);
  const record = {
    attempt,
    exit_code: result?.exitCode ?? null,
    invocation_state: invocationRejected ? "rejected" : "completed",
    response_file: path.basename(responseFile),
    stderr_file: path.basename(stderrFile),
    submission_state: state,
  };
  if (invocationRejected) {
    record.invocation_error =
      invocationError instanceof Error ? invocationError.message : String(invocationError);
  }
  metadata.attempts.push(record);
  writeRecovery(metadataFile, metadata);
  return state;
}

/**
 * Run one review attempt and exactly one corrective attempt when, and only
 * when the first invocation omitted review_submit, or failed in a verified
 * unavailable-review-tool loop without a submission. All other failures stop.
 * A supplied canonical Muse callback is mandatory for accepting a present
 * artifact. Its unambiguous stale or established omission verdict can consume
 * the existing sole recovery, alongside the original unavailable-tool path.
 * The known final submit-JSON transport path additionally requires a retained
 * derived projection's exact healthy-omission refusal from that same callback.
 * Omitting the callback preserves the historical library contract for legacy
 * fixtures only; the CLI always requires the staged canonical implementation.
 * Live-head and changed-line publication validation remain separate.
 */
export async function runReviewRecovery({
  evidenceDirectory,
  basePrompt,
  submissionFile = path.join(evidenceDirectory, "submission.json"),
  invokeAttempt,
  reviewTools = [],
  verifyReviewInvocation,
  expectedContext,
  verifierSha256 = null,
  captureBatchHost,
  modelDiscovery = null,
}) {
  if (!evidenceDirectory) throw new Error("evidenceDirectory is required");
  if (typeof basePrompt !== "string" || basePrompt.trim().length === 0) {
    throw new Error("basePrompt must be a non-empty string");
  }
  if (typeof invokeAttempt !== "function") throw new Error("invokeAttempt is required");
  const strict = verifyReviewInvocation !== undefined;
  if (strict && typeof verifyReviewInvocation !== "function") throw new Error("verifyReviewInvocation must be a function");
  if (strict && (!expectedContext || typeof expectedContext !== "object" || Array.isArray(expectedContext))) {
    throw new Error("expectedContext is required for canonical invocation verification");
  }
  // Canonical eligibility belongs to the supplied Muse capture. This caller
  // only compares independent transport observations and retains chronology.
  const batches = strict && Array.isArray(expectedContext.reviewTools) && expectedContext.reviewTools.some((name) =>
    name === "review_read_diff_batch" || name === "review_assess_diff_batch");
  if ((batches || captureBatchHost !== undefined) && typeof captureBatchHost !== "function") {
    throw new Error("canonical batch host capture is required before model execution");
  }
  if (captureBatchHost && !strict) throw new Error("batch host custody requires canonical invocation verification");
  if (strict) expectedContext = structuredClone(expectedContext);

  fs.mkdirSync(evidenceDirectory, { recursive: true });
  const metadataFile = path.join(evidenceDirectory, "recovery.json");
  if (strict) freshOutputRoles(evidenceDirectory, submissionFile);
  if (strict && [metadataFile, ...[1, 2].flatMap((attempt) => [
    path.join(evidenceDirectory, `model-response-attempt-${attempt}.txt`),
    path.join(evidenceDirectory, `opencode-stderr-attempt-${attempt}.log`),
  ])].some((file) => fs.existsSync(file))) {
    throw new Error("refusing pre-existing invocation evidence; retained history must not be overwritten");
  }
  const metadata = {
    schema: RECOVERY_SCHEMA,
    max_attempts: MAX_ATTEMPTS,
    recovery_reason: null,
    attempts: [],
  };
  if (strict) metadata.accepted_invocation = null;
  if (modelDiscovery) metadata.model_discovery = structuredClone(modelDiscovery);
  if (captureBatchHost) metadata.batch_custody = { original: null, captures: [] };
  const checkOutputs = strict ? outputCustody(evidenceDirectory, submissionFile, metadata) : null;

  if (fs.existsSync(submissionFile)) {
    throw new Error(`refusing pre-existing review submission: ${submissionFile}`);
  }

  let prompt = strict ? strictInvocationPrompt(basePrompt) : basePrompt;
  let contextSha256 = strict ? sha256(JSON.stringify(expectedContext)) : null;
  const capture = async (boundary, attempt) => {
    const deadline = performance.now() + MODEL_DISCOVERY_BUDGET_MS;
    try {
      if (checkOutputs) await checkOutputs(boundary === "after" ? attempt : null, deadline);
      if (!captureBatchHost) return;
      const observation = structuredClone(await captureBatchHost({ boundary, attempt, deadline }));
      await checkOutputs(null, deadline);
      captureDeadline(deadline);
      if (!observation?.batchHost || typeof observation.batchHost !== "object" || Array.isArray(observation.batchHost)) {
        throw new Error("canonical batch host capture returned no observation");
      }
      const custody = metadata.batch_custody;
      custody.captures.push({ boundary, attempt, observation, outputs: structuredClone(metadata.output_custody) });
      if (custody.original === null) {
        custody.original = structuredClone(observation);
        expectedContext.batchHost = structuredClone(observation.batchHost);
        contextSha256 = sha256(JSON.stringify(expectedContext));
      } else if (!isDeepStrictEqual(custody.original, observation)) {
        throw new Error(`review source/host custody changed ${boundary} child ${attempt}`);
      }
      writeRecovery(metadataFile, metadata);
    } catch (error) {
      metadata.custody_error = { boundary, attempt, message: error instanceof Error ? error.message : String(error) };
      metadata.accepted_invocation = null;
      writeRecovery(metadataFile, metadata);
      throw error;
    }
  };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const responseFile = path.join(evidenceDirectory, `model-response-attempt-${attempt}.txt`);
    const stderrFile = path.join(evidenceDirectory, `opencode-stderr-attempt-${attempt}.log`);
    let result;
    await capture("before", attempt);
    try {
      // Capture after *every* actual adapter entry, even a throw, failed exit or
      // missing submission. A failed after-capture stops before retry selection.
      let childError;
      try {
        result = await invokeAttempt({ attempt, prompt, responseFile, stderrFile });
      } catch (error) {
        childError = error;
        throw error;
      } finally {
        try {
          await capture("after", attempt);
        }
        catch (error) {
          if (childError) metadata.child_error = { attempt, message: childError instanceof Error ? childError.message : String(childError) };
          throw error;
        }
      }
    } catch (invocationError) {
      recordAttempt({
        metadata,
        metadataFile,
        attempt,
        invocationError,
        invocationRejected: true,
        responseFile,
        stderrFile,
        submissionFile,
      });
      if (strict) {
        const record = metadata.attempts.at(-1);
        record.verification_state = "not-run-invocation-rejected";
        record.response_sha256 = sha256(fs.readFileSync(responseFile));
        record.stderr_sha256 = sha256(fs.readFileSync(stderrFile));
        record.submission_sha256 = fs.existsSync(submissionFile) ? sha256(fs.readFileSync(submissionFile)) : null;
        writeRecovery(metadataFile, metadata);
      }
      throw invocationError;
    }

    const state = recordAttempt({
      metadata,
      metadataFile,
      attempt,
      result,
      responseFile,
      stderrFile,
      submissionFile,
    });

    const toolFailure = attempt === 1 && result?.exitCode === 1 && state === "missing"
      ? unavailableReviewTool(responseFile, stderrFile, reviewTools, strict ? expectedContext.reviewTools : undefined, strict)
      : null;
    const verdict = strict ? await verifyAttempt({ metadata, metadataFile, responseFile, stderrFile,
      submissionFile, verifyReviewInvocation, expectedContext }) : null;
    const submitJsonFailure = strict && attempt === 1 && result?.exitCode === 0 && state === "missing"
      ? await submitJsonTransport({ metadata, metadataFile, responseFile, stderrFile, submissionFile,
        reviewTools, verifyReviewInvocation, expectedContext, contextSha256 }) : null;
    const coverageFailure = strict && attempt === 1 && result?.exitCode === 0 && state === "missing"
      ? await finalInputCoverage({ metadata, metadataFile, responseFile, stderrFile, submissionFile,
        reviewTools, verifyReviewInvocation, expectedContext, contextSha256 }) : null;
    if (result?.exitCode !== 0 && !toolFailure) {
      throw new Error(`OpenCode review attempt ${attempt} exited ${result?.exitCode ?? "without a code"}`);
    }
    if (state === "present" && (!strict || verdict.ok)) {
      if (strict) {
        const record = metadata.attempts.at(-1);
        metadata.accepted_invocation = {
          attempt,
          response_file: record.response_file,
          response_sha256: record.response_sha256,
          submission_file: path.relative(evidenceDirectory, submissionFile),
          submission_sha256: record.submission_sha256,
          session_id: verdict.sessionID,
          canonical_verdict: verdict,
          verifier_sha256: verifierSha256,
          expected_context_sha256: sha256(JSON.stringify(expectedContext)),
          ...(captureBatchHost ? { batch_custody_sha256: sha256(JSON.stringify(metadata.batch_custody)) } : {}),
          ...(modelDiscovery ? { model_discovery_sha256: modelDiscovery.sha256, model: modelDiscovery.selected_model } : {}),
        };
        writeRecovery(metadataFile, metadata);
      }
      if (checkOutputs) {
        try { await checkOutputs(); }
        catch (error) {
          metadata.custody_error = { boundary: "accepted", attempt, message: error instanceof Error ? error.message : String(error) };
          metadata.rejected_accepted_invocation = metadata.accepted_invocation;
          metadata.accepted_invocation = null;
          // Only held supervisor bytes may be replaced. writeRecovery refuses
          // an independently changed raw record instead of repairing its history.
          writeRecovery(metadataFile, metadata);
          throw error;
        }
        writeRecovery(metadataFile, metadata);
      }
      return metadata;
    }
    if (state === "malformed") {
      throw new Error(`malformed review submission after attempt ${attempt}`);
    }
    const staleCoverage = strict && verdict.ok === false && verdict.reason === "stale-review-coverage" && result?.exitCode === 0;
    const omittedSubmission = strict && verdict.ok === false && verdict.reason === "missing-review-submit" && state === "missing" && result?.exitCode === 0;
    if (strict && !toolFailure && !staleCoverage && !omittedSubmission && !submitJsonFailure && !coverageFailure) {
      throw new Error(`review invocation verification failed after attempt ${attempt}: ${verdict.reason ?? "submission-not-established"}`);
    }
    if (attempt === MAX_ATTEMPTS) {
      if (strict && !omittedSubmission) {
        throw new Error(`review invocation verification failed after attempt ${attempt}: ${verdict.reason}`);
      }
      throw new Error(`reviewer omitted review_submit after ${MAX_ATTEMPTS} attempts`);
    }

    metadata.recovery_reason = toolFailure ? "unavailable_review_tool" : submitJsonFailure ? "review_submit_json_transport" : coverageFailure ? "final_input_coverage" : staleCoverage ? "stale-review-coverage" : "missing_review_submit";
    if (toolFailure) metadata.attempts.at(-1).tool_failure = toolFailure;
    writeRecovery(metadataFile, metadata);
    if (staleCoverage && state === "present") {
      retainStaleSubmission({ metadata, metadataFile, submissionFile, evidenceDirectory });
    }
    prompt = correctivePrompt(basePrompt, toolFailure, staleCoverage, submitJsonFailure, coverageFailure);
    if (strict) prompt = strictInvocationPrompt(prompt);
  }

  throw new Error("unreachable review recovery state");
}

/** Retain physical source bytes and link identities, without publishing contents. */
function sourceDirectoryIdentity(directory) {
  const root = fs.realpathSync(directory);
  const files = [];
  const walk = (current) => {
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current, name), stat = fs.lstatSync(file);
      const relative = path.relative(root, file);
      if (stat.isSymbolicLink()) {
        const target = fs.realpathSync(file);
        if (!target.startsWith(`${root}${path.sep}`)) throw new Error("review source link escapes its captured directory");
        files.push({ path: relative, link: fs.readlinkSync(file), target: path.relative(root, target) });
      } else if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) files.push({ path: relative, mode: stat.mode & 0o777, sha256: sha256(fs.readFileSync(file)) });
      else throw new Error("review source contains a special file");
    }
  };
  walk(root);
  return { path: root, sha256: sha256(JSON.stringify(files)), files: files.length };
}

/** Bind the actual global skill carrier, not only its original target's bytes. */
function globalSkillSourceIdentity(environment, contextDirectory) {
  const file = path.join(environment.HOME, ".agents"), stat = fs.lstatSync(file, { bigint: true });
  const expected = fs.realpathSync(path.join(contextDirectory, "agents"));
  if (!stat.isSymbolicLink() || fs.realpathSync(file) !== expected) {
    throw new Error("global skill source link is unestablished or changed");
  }
  return { path: file, mode: Number(stat.mode & 0o777n), kind: "symlink",
    device: String(stat.dev), inode: String(stat.ino), uid: String(stat.uid), gid: String(stat.gid),
    size: String(stat.size), ctime_ns: String(stat.ctimeNs),
    link: fs.readlinkSync(file), target: fs.realpathSync(file) };
}

/**
 * Independent physical capture for the actual child launch and final boundary.
 * Muse alone interprets the host profile. Full config/environment/source bytes
 * are custody inputs, not public artifacts or model-authored observations.
 */
async function captureResolvedConfig(binary, environment, cwd, deadline) {
  captureDeadline(deadline);
  const child = spawn(binary, ["debug", "config"], { cwd, env: environment, detached: true,
    stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [], stderr = [];
  let stdoutBytes = 0, stderrBytes = 0, failure, force, timeout;
  const kill = signal => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") failure ??= error; }
  };
  const terminate = () => {
    kill("SIGTERM");
    force ??= setTimeout(() => kill("SIGKILL"), Math.max(0, Math.min(250, deadline - performance.now())));
  };
  const collect = (chunks, stream) => bytes => {
    if (stream === "stdout") stdoutBytes += bytes.length; else stderrBytes += bytes.length;
    if ((stream === "stdout" ? stdoutBytes : stderrBytes) > 2 * 1024 * 1024) {
      failure ??= new Error("independent config capture exceeded stream bound"); terminate();
    } else chunks.push(bytes);
  };
  child.stdout.on("data", collect(stdout, "stdout")); child.stderr.on("data", collect(stderr, "stderr"));
  timeout = setTimeout(() => { failure ??= new Error("independent config capture deadline expired"); terminate(); },
    Math.max(0, deadline - performance.now() - 250));
  let exit;
  try {
    exit = await new Promise(resolve => {
      child.once("error", error => { failure ??= error; });
      // A config child can exit while a descendant retains its pipes. Always
      // close that owned group, even on an apparently successful parent exit.
      child.once("exit", terminate);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
  } finally { clearTimeout(timeout); clearTimeout(force); kill("SIGKILL"); }
  if (failure || exit.code !== 0 || exit.signal || stdoutBytes === 0) {
    throw new Error(`independent resolved OpenCode config capture failed: ${JSON.stringify({
      exit_code: exit.code, signal: exit.signal, error: failure?.message ?? null,
      stdout_bytes: stdoutBytes, stderr_bytes: stderrBytes })}`);
  }
  captureDeadline(deadline);
  return Buffer.concat(stdout);
}

export async function captureReviewBatchCustody({ binary, environment, cwd, verifierFile,
  registryFile, evidenceDirectory, promptFile, contextDirectory, runtimeDirectory,
  deadline = performance.now() + MODEL_DISCOVERY_BUDGET_MS }) {
  captureDeadline(deadline);
  const skills = globalSkillSourceIdentity(environment, contextDirectory);
  const physical = modelBinaryIdentity(binary, environment);
  const verifier = createRequire(import.meta.url)(verifierFile);
  if (typeof verifier.prepareReviewBatchHost !== "function") throw new Error("canonical batch host capture export is required");
  // Eligibility preflight only: refuse an unknown physical binary before even
  // executing its config command. Discard this result; only the independently
  // captured real resolved configuration below supplies the host observation.
  verifier.prepareReviewBatchHost(physical.real_path, Buffer.from("{}"), environment, cwd);
  const resolved = await captureResolvedConfig(physical.real_path, environment, cwd, deadline);
  const batchHost = verifier.prepareReviewBatchHost(physical.real_path, resolved, environment, cwd);
  const files = [verifierFile, registryFile, promptFile,
    ...["basehead.diff", "input-manifest.json", "pr-context.md"].map(name => path.join(evidenceDirectory, name))];
  const sources = files.map(file => {
    const actual = path.resolve(file), stat = fs.lstatSync(actual);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("review custody requires physical regular source files");
    return { path: actual, sha256: sha256(fs.readFileSync(actual)) };
  });
  const git = args => execFileSync("git", args, { cwd, encoding: null, maxBuffer: 64 * 1024 * 1024,
    timeout: Math.max(1, Math.floor(captureDeadline(deadline))), killSignal: "SIGKILL" });
  const untracked = await consumerInputCustody(cwd, evidenceDirectory, deadline);
  const context = sourceDirectoryIdentity(contextDirectory), runtime = sourceDirectoryIdentity(runtimeDirectory);
  const gitHead = git(["rev-parse", "HEAD"]).toString("utf8").trim();
  const gitWorking = sha256(git(["diff", "--no-ext-diff", "--binary", "HEAD"]));
  captureDeadline(deadline);
  return { batchHost, custody: {
    binary: physical, config_sha256: sha256(resolved),
    environment_sha256: sha256(JSON.stringify(Object.entries(environment).sort(([a], [b]) => a.localeCompare(b)))),
    cwd: fs.realpathSync(cwd), sources,
    context, runtime, skills,
    git_head: gitHead, git_working_sha256: gitWorking,
    git_untracked_sha256: untracked.sha256, git_untracked_files: untracked.files,
  } };
}

/** Reconstruct the same anonymous launch for independent terminal capture. */
export function reviewChildLaunch(discovery, configuration, environment, evidenceDirectory) {
  return { binary: discovery.proof.binary.real_path, cwd: process.cwd(),
    environment: { ...isolatedModelEnvironment(environment, configuration.home),
      OPENCODE_CONFIG: path.join(configuration.home, ".config/opencode/opencode.json"),
      REVIEW_EVIDENCE_DIR: evidenceDirectory,
      OPENCODE_MODELS_PATH: discovery.proof.catalog_source.path, OPENCODE_DISABLE_MODELS_FETCH: "true" } };
}

/** Independently close every actual pair against the trusted accepted digest. */
export async function verifyReviewBatchCustody({ evidenceDirectory, recovery, expectedVersion,
  verifierFile, registryFile, promptFile, contextDirectory, runtimeDirectory }) {
  const deadline = performance.now() + MODEL_DISCOVERY_BUDGET_MS;
  verifyModelDiscoveryArtifacts(evidenceDirectory, recovery, expectedVersion);
  const proof = discoveryArtifactProof(evidenceDirectory, recovery.model_discovery.sha256, expectedVersion);
  const configuration = ordinaryInferenceConfiguration();
  if (!isDeepStrictEqual(configuration, proof.inference_configuration)) {
    throw new Error("ordinary review configuration changed before publication");
  }
  const custody = recovery.batch_custody, accepted = recovery.accepted_invocation;
  if (![1, 2].includes(accepted.attempt) || !Array.isArray(recovery.attempts) ||
      recovery.attempts.length !== accepted.attempt || recovery.custody_error || recovery.child_error ||
      recovery.setup_error || recovery.supervisor_error ||
      !custody?.original || !Array.isArray(custody.captures) ||
      custody.captures.length !== accepted.attempt * 2 ||
      sha256(JSON.stringify(custody)) !== accepted.batch_custody_sha256) {
    throw new Error("original batch custody or actual child pairs changed");
  }
  for (let index = 0; index < custody.captures.length; index += 1) {
    const capture = custody.captures[index];
    if (capture.boundary !== (index % 2 === 0 ? "before" : "after") ||
        capture.attempt !== Math.floor(index / 2) + 1 ||
        !isDeepStrictEqual(capture.observation, custody.original)) {
      throw new Error("unestablished actual child custody pair");
    }
    if (!capture.outputs || typeof capture.outputs !== "object" || Array.isArray(capture.outputs)) throw new Error("missing actual child output custody");
    const events = capture.outputs["review-events.jsonl"];
    if (events && (!Number.isSafeInteger(events.bytes) || events.bytes < 0 ||
        !isDeepStrictEqual(await fileCustody(path.join(evidenceDirectory, "review-events.jsonl"),
          deadline, events.bytes), events))) {
      throw new Error("review event output prefix changed at terminal verification");
    }
  }
  const launch = reviewChildLaunch({ proof }, configuration, process.env, evidenceDirectory);
  await verifyOutputFiles(evidenceDirectory, path.join(evidenceDirectory, "submission.json"), recovery, deadline);
  if (physicalStat(path.join(evidenceDirectory, "submission-verification.json"))) throw new Error("pre-existing final output custody");
  const terminal = await captureReviewBatchCustody({ ...launch, verifierFile, registryFile,
    evidenceDirectory, promptFile, contextDirectory, runtimeDirectory, deadline });
  if (!isDeepStrictEqual(terminal, custody.original)) {
    // Names only: never expose raw config or environment while diagnosing drift.
    const changed = [
      ...(!isDeepStrictEqual(terminal.batchHost, custody.original.batchHost) ? ["batchHost"] : []),
      ...Object.keys(terminal.custody).filter(key => !isDeepStrictEqual(terminal.custody[key], custody.original.custody?.[key])),
    ];
    throw new Error(`review custody changed at terminal publication capture: ${changed.join(", ")}`);
  }
  await verifyOutputFiles(evidenceDirectory, path.join(evidenceDirectory, "submission.json"), recovery, deadline);
  captureDeadline(deadline);
  return { batchHost: structuredClone(custody.original.batchHost), terminal_sha256: sha256(JSON.stringify(terminal)) };
}

/** Run the configured OpenCode review and mirror stdout and stderr to retained files. */
async function invokeOpenCode({ prompt, responseFile, stderrFile,
  opencodeBin = process.env.OPENCODE_BIN || "opencode", reviewModel = process.env.REVIEW_MODEL,
  environment = null, cwd = process.cwd() }) {
  if (!reviewModel) throw new Error("REVIEW_MODEL is required");

  const responseFd = fs.openSync(responseFile, "wx", 0o600);
  let stderrFd;
  try { stderrFd = fs.openSync(stderrFile, "wx", 0o600); }
  catch (error) { fs.closeSync(responseFd); throw error; }
  const response = fs.createWriteStream(responseFile, { fd: responseFd });
  const stderr = fs.createWriteStream(stderrFile, { fd: stderrFd });
  const streamsFinished = Promise.allSettled([finished(response), finished(stderr)]);
  let invocationRejected = false;

  try {
    const childEnvironment = { ...(environment ?? process.env) };
    for (const name of ["GITHUB_OUTPUT", "GITHUB_ENV", "GITHUB_PATH", "GITHUB_STATE", "GITHUB_STEP_SUMMARY"]) {
      delete childEnvironment[name];
    }
    const child = spawn(
      opencodeBin,
      ["run", "--format", "json", "--agent", "github-reviewer", "--model", reviewModel, prompt],
      { stdio: ["ignore", "pipe", "pipe"], env: childEnvironment, cwd },
    );

    child.stdout.on("data", (chunk) => {
      response.write(chunk);
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr.write(chunk);
      process.stderr.write(chunk);
    });

    const exit = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });

    if (exit.signal) throw new Error(`OpenCode review terminated by ${exit.signal}`);
    return { exitCode: exit.code };
  } catch (error) {
    invocationRejected = true;
    throw error;
  } finally {
    response.end();
    stderr.end();
    const streamResults = await streamsFinished;
    if (!invocationRejected) {
      const streamFailure = streamResults.find(({ status }) => status === "rejected");
      if (streamFailure) throw streamFailure.reason;
    }
  }
}

/** Read the configured prompt and tool registry, then run bounded review recovery. */
async function main() {
  const prNumber = process.env.PR_NUMBER;
  const promptFile = process.env.REVIEW_PROMPT_FILE;
  const evidenceDirectory = process.env.REVIEW_EVIDENCE_DIR;
  const verifierFile = process.env.REVIEW_INVOCATION_VERIFIER_FILE;
  if (!/^\d+$/.test(prNumber || "")) throw new Error("PR_NUMBER must be numeric");
  if (!promptFile) throw new Error("REVIEW_PROMPT_FILE is required");
  if (!evidenceDirectory) throw new Error("REVIEW_EVIDENCE_DIR is required");
  if (!verifierFile) throw new Error("REVIEW_INVOCATION_VERIFIER_FILE is required");
  if (!path.isAbsolute(verifierFile)) throw new Error("REVIEW_INVOCATION_VERIFIER_FILE must be absolute");
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required for trusted invocation binding");

  const promptTemplate = fs.readFileSync(promptFile, "utf8");
  const basePrompt = promptTemplate.replaceAll("{{PR_NUMBER}}", prNumber);
  const registryFile = process.env.REVIEW_TOOL_REGISTRY_FILE;
  const exposedTools = registryFile ? fs.readFileSync(registryFile, "utf8").trim().split(/\r?\n/).filter(Boolean) : [];
  const reviewTools = exposedTools.filter((tool) => /^review_[a-z0-9_]+$/.test(tool));
  // The caller stages this CJS from qualified Muse machinery. No model output
  // selects the module, context, semantic verdict, or trusted step output.
  const submissionFile = path.resolve(evidenceDirectory, "submission.json");
  freshOutputRoles(evidenceDirectory, submissionFile, true);
  let verifierBytes;
  let verifier;
  let expectedContext;
  try {
    verifierBytes = fs.readFileSync(verifierFile);
    verifier = createRequire(import.meta.url)(verifierFile);
    if (typeof verifier.verifyReviewInvocation !== "function" ||
        typeof verifier.prepareReviewInvocationContext !== "function") {
      throw new Error("staged verifier must export verifyReviewInvocation and prepareReviewInvocationContext");
    }
    if (sha256(fs.readFileSync(verifierFile)) !== sha256(verifierBytes)) {
      throw new Error("staged invocation verifier changed while loading");
    }
    // Canonical Muse prepares the actual lossless geometry once, before any
    // child. Keep it in trusted supervisor memory across the two-attempt bound.
    const stagedContextFile = path.resolve(evidenceDirectory, "pr-context.md");
    const stagedContextBytes = fs.readFileSync(stagedContextFile);
    expectedContext = verifier.prepareReviewInvocationContext(
      fs.readFileSync(path.join(evidenceDirectory, "basehead.diff")),
      fs.readFileSync(path.join(evidenceDirectory, "input-manifest.json")),
      exposedTools, submissionFile, stagedContextBytes, stagedContextFile,
    );
    if (!expectedContext || typeof expectedContext !== "object" || Array.isArray(expectedContext)) {
      throw new Error("canonical verifier context preparation returned no context");
    }
    const reflected = expectedContext.contextSource;
    if (expectedContext.contextPath !== stagedContextFile || !reflected ||
        reflected.path !== stagedContextFile || reflected.bytes !== stagedContextBytes.length ||
        reflected.sha256 !== sha256(stagedContextBytes)) {
      throw new Error("canonical verifier did not bind the actual staged context");
    }
  } catch (error) {
    const metadataFile = path.join(evidenceDirectory, "recovery.json");
    if (!fs.existsSync(metadataFile)) {
      writeRecovery(metadataFile, {
        schema: RECOVERY_SCHEMA, max_attempts: MAX_ATTEMPTS, recovery_reason: null,
        attempts: [], accepted_invocation: null,
        setup_error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
  const contextPrompt = `${basePrompt}\n\nTrusted staged context: ${JSON.stringify(expectedContext.contextPath)}. Read the complete file with the native read tool before the first review_record_evidence; a zero-byte file is still present.`;
  const batches = reviewTools.includes("review_read_diff_batch") || reviewTools.includes("review_assess_diff_batch");
  let discovery = null, configuration = null, launch = null, captureBatchHost;
  try {
    if (batches && process.env.REVIEW_MODEL_DISCOVERY !== MODEL_DISCOVERY_MODE) {
      throw new Error("batch review requires checked anonymous model discovery");
    }
    if (process.env.REVIEW_MODEL_DISCOVERY !== undefined) {
      if (process.env.REVIEW_MODEL_DISCOVERY !== MODEL_DISCOVERY_MODE) throw new Error("unsupported model discovery mode");
      configuration = ordinaryInferenceConfiguration();
      // Retain source custody before the first asynchronous catalog/host work.
      // A changed file cannot become the original merely by changing early.
      const contextDirectory = path.resolve(path.dirname(verifierFile), "..");
      const originalSource = batches ? {
        inputs: await consumerInputCustody(process.cwd(), evidenceDirectory, performance.now() + MODEL_DISCOVERY_BUDGET_MS),
        context: sourceDirectoryIdentity(contextDirectory),
        runtime: sourceDirectoryIdentity(process.env.REVIEW_CHILD_RUNTIME),
        skills: globalSkillSourceIdentity({ HOME: configuration.home }, contextDirectory),
        files: [verifierFile, registryFile, promptFile,
          ...["basehead.diff", "input-manifest.json", "pr-context.md"].map(name => path.join(evidenceDirectory, name))]
          .map(file => ({ path: path.resolve(file), sha256: sha256(fs.readFileSync(file)) })),
      } : null;
      discovery = await discoverFreeMiMoFlash({ evidenceDirectory, requested: process.env.REVIEW_MODEL || "",
        expectedVersion: process.env.REVIEW_EXPECTED_OPENCODE_VERSION, inferenceConfiguration: configuration });
      launch = reviewChildLaunch(discovery, configuration, process.env, evidenceDirectory);
      if (batches) {
        captureBatchHost = async ({ deadline = performance.now() + MODEL_DISCOVERY_BUDGET_MS } = {}) => {
          assertModelDiscovery(discovery);
          assertInferenceConfiguration(configuration);
          const observed = await captureReviewBatchCustody({ ...launch, verifierFile, registryFile, evidenceDirectory,
            promptFile, contextDirectory, runtimeDirectory: process.env.REVIEW_CHILD_RUNTIME, deadline });
          const discoveryPaths = new Set(discoveryNames().map(name => path.relative(launch.cwd, path.resolve(evidenceDirectory, name))));
          const heldInputs = observed.custody.git_untracked_files.filter(row => !discoveryPaths.has(row.path));
          if (!isDeepStrictEqual(observed.custody.sources, originalSource.files) ||
              !isDeepStrictEqual(heldInputs, originalSource.inputs.files) ||
              !isDeepStrictEqual(observed.custody.context, originalSource.context) ||
              !isDeepStrictEqual(observed.custody.skills, originalSource.skills) ||
              !isDeepStrictEqual(observed.custody.runtime, originalSource.runtime)) {
            throw new Error("review source custody changed since original preparation");
          }
          return observed;
        };
      }
    }
  } catch (error) {
    const file = path.join(evidenceDirectory, "recovery.json");
    if (!fs.existsSync(file)) writeRecovery(file, { schema: RECOVERY_SCHEMA, max_attempts: MAX_ATTEMPTS,
      recovery_reason: null, attempts: [], accepted_invocation: null,
      setup_error: error instanceof Error ? error.message : "model discovery failed" });
    throw error;
  }
  const invoke = launch ? async arguments_ => {
    assertModelDiscovery(discovery);
    try {
      return await invokeOpenCode({ ...arguments_, opencodeBin: launch.binary,
        reviewModel: discovery.proof.selected_model, environment: launch.environment, cwd: launch.cwd });
    } finally { assertModelDiscovery(discovery); }
  } : invokeOpenCode;
  const metadata = await runReviewRecovery({ evidenceDirectory, basePrompt: contextPrompt, reviewTools,
    submissionFile, invokeAttempt: invoke, captureBatchHost,
    modelDiscovery: discovery ? { file: "model-discovery.json", sha256: discovery.sha256,
      selected_model: discovery.proof.selected_model } : null,
    verifyReviewInvocation: verifier.verifyReviewInvocation, expectedContext,
    verifierSha256: sha256(verifierBytes) });
  const accepted = metadata.accepted_invocation;
  try {
    const deadline = performance.now() + MODEL_DISCOVERY_BUDGET_MS;
    if (discovery) assertModelDiscovery(discovery);
    if (captureBatchHost && !isDeepStrictEqual(await captureBatchHost({ deadline }), metadata.batch_custody.original)) {
      throw new Error("review source/host custody changed before trusted output");
    }
    if (!accepted || sha256(fs.readFileSync(path.join(evidenceDirectory, accepted.response_file))) !== accepted.response_sha256 ||
        sha256(fs.readFileSync(submissionFile)) !== accepted.submission_sha256) {
      throw new Error("accepted invocation bytes changed before trusted output");
    }
    await verifyOutputFiles(evidenceDirectory, submissionFile, metadata, deadline);
    const rawRecovery = heldRecovery(path.join(evidenceDirectory, "recovery.json"));
    if (!rawRecovery) throw new Error("missing held recovery output custody");
    captureDeadline(deadline);
    const digest = sha256(JSON.stringify(accepted));
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `review_invocation_sha256=${digest}\nreview_recovery_sha256=${rawRecovery.sha256}\n`);
  } catch (error) {
    metadata.accepted_invocation = null;
    metadata.rejected_accepted_invocation = accepted;
    metadata.supervisor_error = error instanceof Error ? error.message : String(error);
    writeRecovery(path.join(evidenceDirectory, "recovery.json"), metadata);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}
