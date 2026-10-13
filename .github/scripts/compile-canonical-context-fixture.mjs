// SPDX-License-Identifier: GPL-3.0-or-later
// Fixture transport only: execute the existing compiler recipe, never review law.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requireFromEtaMu = createRequire(path.join(root, "packages/eta-mu/package.json"));
const workflow = requireFromEtaMu("yaml").parse(
  fs.readFileSync(path.join(root, ".github/workflows/opencode-code-review.yml"), "utf8"));
const revision = workflow.on.workflow_call.inputs.muse_revision.default;
const steps = workflow.jobs.prepare_review_context.steps;
const checkout = steps.find(step => step.name === "Checkout Muse compatibility compiler");
const recipe = steps.find(step => step.name === "Compile and verify a read-only Muse review profile");
if (!/^[0-9a-f]{40}$/.test(revision) || checkout?.with?.repository !== "octave-commons/muse" ||
    typeof recipe?.run !== "string" || !recipe.run.trim()) {
  throw new Error("canonical fixture needs the existing immutable Muse compiler recipe");
}
const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error("supply a new absolute fixture output directory");
fs.mkdirSync(output); // Refuse an existing directory rather than reuse stale output.
const source = path.join(output, "source");
fs.mkdirSync(source);
const run = (command, args, timeout = 120_000) => execFileSync(command, args,
  { cwd: source, stdio: "inherit", timeout });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const recipeFile = path.join(output, "compile.sh");
fs.writeFileSync(recipeFile, recipe.run);
const provenance = { tier: "compiled-fixture", repository: checkout.with.repository, revision,
  recipe_sha256: digest(Buffer.from(recipe.run)), completed: false };
const provenanceFile = path.join(output, "provenance.json");
fs.writeFileSync(provenanceFile, JSON.stringify(provenance, null, 2) + "\n");
run("git", ["init", "--quiet"]);
run("git", ["fetch", "--depth=1", "https://github.com/octave-commons/muse.git", revision]);
run("git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"]);
const actual = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
if (actual !== revision) throw new Error("canonical fixture checkout changed revision");
run("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", recipeFile], 15 * 60_000);
const compiled = path.join(source, ".opencode/dist/review-invocation.cjs");
if (!fs.lstatSync(compiled).isFile()) throw new Error("compiler did not produce a regular invocation module");
const bytes = fs.readFileSync(compiled);
if (!bytes.length) throw new Error("compiler produced an empty invocation module");
const moduleFile = path.join(output, "review-invocation.cjs");
fs.writeFileSync(moduleFile, bytes, { flag: "wx" });
Object.assign(provenance, { completed: true, module_bytes: bytes.length, module_sha256: digest(bytes) });
fs.writeFileSync(provenanceFile, JSON.stringify(provenance, null, 2) + "\n");
console.log(`Compiled canonical fixture ${revision}: ${bytes.length} bytes, ${provenance.module_sha256}`);
// This directory was created exclusively by this invocation; preserve module,
// recipe and provenance, then discard only its regenerable fetched/build tree.
fs.rmSync(source, { recursive: true });
