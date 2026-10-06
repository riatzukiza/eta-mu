# POSIX storage admission: native review repair

Native MiMo review [5431876321](https://github.com/riatzukiza/eta-mu/pull/5#pullrequestreview-5431876321), inline [4198142815](https://github.com/riatzukiza/eta-mu/pull/5#discussion_r4198142815), at source `d2b40bb45ab0038bd149bec8f219922e95bf2a55` identifies one concrete component-admission defect. This is an existing PR5 review repair anchored on the `reusable-clio-document-history` card's existing storage contract. No board transition is claimed.

The former pure regex split on both slash and backslash. Node POSIX path resolution preserves literal backslashes in filenames, so a component named `back\.ημ` falsely appeared to contain a complete `.ημ` component. Actual `open!` admitted the wrong root and created directories. A `.ημ` symlink resolving to that malformed component also passed the old intended-path check. This is a low-severity invariant defect in a new package; no security exploit or current consumer misuse is established.

## Repair contract

The law remains portable `.cljc` and accepts an explicit dialect: `:posix` splits only on slash, `:windows` accepts slash/backslash/mixed, and unknown dialects fail closed. One-argument law calls now mean slash-normalized paths; raw Windows backslashes require the explicit second argument. This API clarification is documented rather than claimed to preserve the former raw-Windows one-argument behavior.

The Node extern decodes its actual separator into a keyword. Infra obtains that fact once and supplies it at all four raw/absolute/intended/real admission boundaries. No host object enters the law. Symlink-resolved admission remains before mkdir. Literal backslashes beneath a real `.ημ` component remain legal; Windows drive/UNC/mixed/slash/backslash fixtures are preserved with an explicit dialect. These are pure Windows contract fixtures, not a Windows-host filesystem test claim.

## Observed verification

- RED, before production changes, committed `95d29c812164c36482c3a58aa9867e2ae3fd4ef2`: actual NBB **17 tests / 110 assertions / 9 failures / 0 errors**, exit 1. Two malformed components and an actual symlink alias are admitted and mutate storage. Positive legal backslash storage succeeds. Raw cases use separate owned roots.
- GREEN NBB: **20 tests / 141 assertions / 0 failures / 0 errors**.
- Standalone forced-spawn Shadow compilation: **103 files / 102 compiled / 0 warnings**.
- Final `bb scripts/test.bb --only document-history`: actual NBB and compiled Node each **20 tests / 141 assertions / 0 failures / 0 errors**, exit 0; cached compilation **103 files / 2 compiled / 0 warnings**.
- Final `bb scripts/lint.bb --only document-history --kondo-only`: **0 errors / 0 warnings**, exit 0. Unchanged TypeScript-era gates are outside this selected package gate.
- Canonical Receipt River `api/build-event`/`record-errors` built the new envelope; `api/validate-line` admits all seven `.ημ/receipts.edn` rows. The untouched root `receipts.edn` has 254 rows and the same 56 inherited failures; whole-root validity is not claimed.
- The initial compiled gate failed only in the new test instrumentation: a single-arity wrapper replaced a multi-arity function and omitted its compiled arity property. The wrapper now preserves both arities and records any missing host dialect. The original failed log remains retained; it is not relabeled as green.

Independent clone/worktree, pnpm store, Maven cache copy, XDG cache and temp paths are privately owned. Shadow source/output/cache paths are under this worktree. No global installs, configuration, runtime services, workflow, provider, credentials or foreign source were changed. Original board ledger, card and root receipt bytes are preserved; `.ημ` receipts and reflection gain only owned suffixes.

Native current-head approvals and cohort convergence remain separate gates. Historical source-path withdrawal is preserved and remains without a final canonical writer disposition; this repair does not turn it into Handled or Rejected. Parent owns peer inspection, publication, settlement, reviewer invitations and the current PR description correction. No push or native successor qualification is claimed by this preparation.

## Lossless raw Maven output packaging

The original `green-shadow-compile.raw.txt` had a trailing space emitted by Maven.
Its exact blob and commit remain in `9f8bfeb1c85ca1a394a2048861c4b45775d11756`.
The current `green-shadow-compile.raw.base64.json` wrapper carries those exact
bytes in base64, their decoded size and SHA-256, and their original path/blob/commit.
Decode `data_base64` with the standard base64 codec to recover the original stream;
no whitespace was stripped or normalized. The source manifest is retained byte-for-byte
at `archive/9f8bfeb-manifest.json`, explicitly describing its original revision's
paths and hashes rather than the wrapper's current bytes. The current manifest hashes
the wrapper and archive independently. This changes only a newly owned evidence format.
