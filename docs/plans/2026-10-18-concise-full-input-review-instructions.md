# Concise full-input instructions in the existing ETA review caller

License: GPL-3.0-or-later.

## Accepted scope

The human included this one-point source prerequisite in the finite Cephalon B1–B3 milestone with the explicit answer “Include the one-point instruction repair (Recommended)”. Canonical task identity: `185000a4-6b8d-4140-b3fe-fc6eb999598c`. Existing source predecessor8872994a-9a50-40a9-85a4-f4c6f5a6a21d was read back Done through qualified Rheos before this plan. This is inclusion authority, not planning approval, native Ready or implementation qualification.

## Exact proposed source change

Change only the runner prompt in `.github/scripts/run-opencode-review-recovery.mjs` and its existing byte-identical embedded copy in `.github/workflows/opencode-code-review.yml`. Add these eleven lines:

```text
  Prefer the native ordered assessments array of {id,note} objects. Check
  each member has exactly the id and note keys, with no whitespace aliases,
  before calling; do not manually serialize the array into a JSON string.
  Write one or two concise judgment sentences per page, targeting at most
  512 UTF8 bytes without transcribing test lists or historical prose. This
  is a brevity target, not coverage permission or a new hard limit.
  This job already authorizes the complete declared input review within its
  existing bounds. While pages remain, continue the same invocation's next
  allowed read/assessment batch; do not stop for a human choice, a progress
  summary or permission to accept partial input. Keep the existing stop on
  failed/refused tools, full-coverage submission gate and host deadline.
```

Prepared patchSHA256 `f49d8f15f40254111c4591d601bb5a2b6c24b93076107b865d38513b1db56e72` is a custody reference to the earlier unapplied proposal. This plan exposes the complete proposed instruction text; production files remain unchanged during planning. The embedded base64 may reflow when regenerated; its decoded bytes must equal the changed runner exactly.

### Verification from a fresh checkout

The private prepared patch is optional historical custody, not a required build or verification input. Derive the change from the eleven lines above and the committed runner at `8b8ebeb323ad4e90bddf4c31082cbaf45d684a3d`:

1. In `strictInvocationPrompt`, insert the eleven lines immediately after `  also feed the exposed delivered-custody assessor after actual delivery.` and immediately before `  Keep each note within 2048 UTF8 bytes and the complete request within 16384`. Match this unique adjacent pair before editing; refuse an ambiguous or changed source rather than moving the insertion speculatively.
2. Re-encode the resulting complete runner into the workflow's existing `ETA_MU_RECOVERY_RUNNER_BASE64` heredoc. Preserve the surrounding workflow and all other bytes. Base64 line wrapping is representational; compare decoded bytes rather than treating reflow as a second semantic change.
3. Inspect the runner diff: exactly the eleven additions above, with no removed or changed executable line. Inspect the workflow diff: only that existing encoded payload may change. Before qualification, run the read-only exact comparison below from the repository root. It compares the actual inserted block directly with the canonical eleven-line text in this plan, including whitespace and the final newline. Both runtime copies containing the same incorrect text must not qualify.
4. Run `node --check .github/scripts/run-opencode-review-recovery.mjs` and the existing complete `node --test .github/scripts/opencode-code-review-workflow.test.mjs` suite. Retain its existing “review context packages the exact runner for reusable-workflow callers” check for decoded packaged-runner equality. The canonical-text comparison and packaging comparison establish separate obligations; neither substitutes for the other.

```sh
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
const plan = fs.readFileSync("docs/plans/2026-10-18-concise-full-input-review-instructions.md", "utf8");
const blocks = [...plan.matchAll(/^```text\n([\s\S]*?)^```$/gm)];
assert.equal(blocks.length, 1, "one canonical instruction block is required");
const expected = blocks[0][1];
assert.equal(expected.split("\n").length, 12, "eleven lines plus final newline");
const runner = fs.readFileSync(".github/scripts/run-opencode-review-recovery.mjs", "utf8");
const before = "  also feed the exposed delivered-custody assessor after actual delivery.\n";
const after = "  Keep each note within 2048 UTF8 bytes and the complete request within 16384";
assert.equal(runner.split(before).length, 2, "unique preceding anchor");
assert.equal(runner.split(after).length, 2, "unique following anchor");
const start = runner.indexOf(before) + before.length;
const end = runner.indexOf(after, start);
assert.ok(end >= start, "ordered anchors");
assert.equal(runner.slice(start, end), expected, "delivered text must equal the approved block");
console.log("Exact approved instruction block:", createHash("sha256").update(expected).digest("hex"));
NODE
```

This one-time qualification command checks the independently approved source text. It adds no repository test or inference claim. On the unchanged planning source it must fail because the approved block is absent; after lawful Ready and implementation it must pass. Record actual command/output and source identity before qualification.

Record actual commands and results against the final source identity. The old private patch hash need not be reproduced to verify this publicly specified change; it grants no coverage or approval. These checks establish source and packaging integrity, not model obedience or full-input throughput.

## Preserved contracts

- Every declared input and per-page assessment, complete coverage and submission validation remain required.
- Existing native tool/failure, source/context custody, publication identity, assessment, stage and merge guards remain intact.
- Four-page batch cap,2048/16384 hard byte caps, configured maximum2 invocations and120-minute budget remain unchanged.512UTF8bytes is a soft brevity target only.
- Native exact id/note keys remain enforced by existing tools. Misspelling or whitespace aliases still refuse; no tolerant normalization or new recovery class is introduced.
- Existing anonymous OpenCode discovery selects the available free MiMo route dynamically. No fixed-model replacement, OpenRouter/direct provider route, credential or paid usage is introduced.
- Musef422d77cf9c6cea46b6791e3f54c98679e949d1f, application runtime and physical kernel profile remain unchanged.

## One-point allocation and exits

One point covers the eleven-line prompt update, matching embedded runner regeneration, existing meaningful regression/equality/syntax verification and truthful source qualification. This changes no executable protocol or validation law. Existing failed historical/native attempts remain evidence. No new mirror-only test or fabricated deterministic proof of LLM obedience is required.

After current-head planning review and native Ready, demonstrate the missing instruction text in the unchanged source, apply the exact scoped update, inspect the decoded source delta and execute the existing full workflow/runner regression suite plus syntax/equality checks with zero warnings. Preserve all failures. Obtain genuine current-head code review and required checks before a head-guarded MERGE.

The delivered result is a qualified ETA source revision. The existing consumer remains a separate pin-only card; it may later consume that qualified revision through its own gates. No current OpenPlanner review is restarted, no application is deployed, and no model invocation outside existing authorized review workflows is added.

The consumer's native dependency set includes this source task in addition to its three prior dependencies. Its current InProgress1 status and implementation scope remain unchanged; it cannot finish adoption against a pre-repair pin. The Incoming parent epic `de02c921-e23c-4d83-87e8-b32c6c3160ff` now lists seven local deliveries and a provisional non-additive13-point roll-up (the prior12 plus this already approved1). This is accounting for the included source child, not an additional execution allocation or a new batch.

## Evidence and limits

Historical native run39088307104 on7c used two invocations: a healthy-tools stop at52/1512 pages and a native-array whitespace-key refusal. Current run39091933687 on404 independently reached its existing deadline after one invocation without a submission. Do not combine their attempt counts or relabel the latest timeout as an authentication/format error.

The instruction repair may improve compliance and brevity. It does not prove future1512-page completion within120minutes. Any actual incomplete review still supplies no approval, coverage or completed cohort; required failures remain blocking.

The accepted finite milestone, source/principal/privacy/proof constraints,20GiB allocation floor and maximum3 expensive concurrent jobs remain unchanged. Preserve historical receipt/event bytes and append corrections; containing repositories supply attribution.
