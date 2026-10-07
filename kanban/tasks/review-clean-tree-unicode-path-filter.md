---
category: "tasks"
labels: "workflow, review, unicode, provisional"
type: "task"
write-id: "1791407653354-0.8mex2yg550cilj47b6q"
points: "2"
title: "Make shared review clean-tree filters handle Unicode paths"
priority: "P1"
status: "review"
uuid: "5f487c2f-ca40-49c1-b6eb-c28d00707732"
created_at: "2026-10-07T20:07:38Z"
---

# Make shared review clean-tree filters handle Unicode paths

## Context

(汝, p=1) The parent verified CodeRabbit's finding in
[riatzukiza/eros-eris-field#1](https://github.com/riatzukiza/eros-eris-field/pull/1#discussion_r4211178862):
root `4211178862`, thread `PRRT_kwDOU_2F986qEOGO`, review `5447409114`, exact
caller revision `81477e7705dc4cfa7e05e375e4685e348b1f9a02`. Native evidence is
parent-provided; this intake did not re-fetch it.

(世, p=0.99) Local source inspection confirms the same filters at receiver pin
`45ec644c2d15ed511e9bc1e797d1b4073b63dbfc` and planning base/personalmain
`084cd150b8d5b9848d026e9ef8717747964dcd6d` in eta-mu's
`.github/workflows/opencode-code-review.yml`. The review setup and completion
guards (lines 1154–1156 and 1254–1255 on these revisions) remove only literal
`^?? \.opencode/review-evidence/` and `^?? \.review-context/` rows. Git porcelain
quotes paths containing Unicode with default `core.quotePath=true`, placing a
quote before the directory prefix. Generated Unicode paths under
`.review-context/` remain falsely classified as unexpected dirt.

(汝, p=1) A bounded caller root `.gitignore` mitigates this consumer; the shared
repair belongs to eta-mu. The historical
[review-agent card](opencode-mimo-evidence-review-agent.md) is broad and
`in_progress`; [bounded recovery](preserve-review-prerequisites-and-recover-one-omitted-submission-recovery.md)
is `done`. This standalone card owns only the pathname-filter defect.

Planning tier: **provisional**. Estimate: **2 points**, small and provisional
pending planning review. This is initial hand-authored incoming Markdown;
implementation and native status transitions have not started.

## Outcome

The shared workflow tolerates untracked generated Unicode paths within each
guard's existing allowed directories while rejecting every tracked mutation
and unrelated untracked path, without requiring caller ignore rules.

## Scope

- Repair pathname handling in the review setup and review completion filters.
- Include deterministic completion at line 468: local inspection found the same
  quoted-path defect in its one-prefix filter. Keep its sole allowance
  `.opencode/review-evidence/`; `.review-context/` remains unexpected there.
  This is source-derived scope; its behavioral RED has not run in this intake.
- Extend the existing `.github/scripts/opencode-code-review-workflow.test.mjs`
  harness to exercise affected workflow guard logic with real temporary Git
  repositories and actual generated paths, preserving existing contracts.

## Non-goals

- Workflow or test implementation in this planning change; reworking the
  historical cards, recovery protocol, models, runtime pins or input transport.
- Caller `.gitignore` changes, caller activation or receiver-pin propagation.
- Broad ignore patterns, tracked-file exemptions, global Git configuration
  changes, board operations, or a separate review/filter engine.

## Acceptance criteria

- [ ] RED executes the existing affected workflow guard logic against actual
  temporary Git repositories with `core.quotePath=true`. Generated Unicode
  paths beneath `.review-context/` reproduce the review setup/completion false
  dirty result; paths beneath `.opencode/review-evidence/` reproduce the same
  defect at all three filtered boundaries. Preserve real porcelain output.
- [ ] GREEN accepts only untracked files under each guard's existing allowed
  directory prefixes, including Unicode filenames and nested Unicode
  directories, and retains normal ASCII generated-directory behavior.
- [ ] Each guard rejects tracked modifications (including tracked files beneath
  allowed directories), staged changes, deletions/renames, unrelated ASCII or
  Unicode untracked paths, and prefix lookalikes such as `.review-context-extra/`
  and `.opencode/review-evidence-extra/`. Mixed generated/dirty trees fail.
- [ ] Deterministic completion still rejects `.review-context/`; the unfiltered
  initial checkout guards still require a completely clean tree.
- [ ] Expected/executed/completion revision checks, complete immutable input and
  authenticity checks, observer permissions, publication admission, evidence
  retention and required terminal gates retain their current obligations.
- [ ] Existing workflow contracts and the scoped regressions pass; workflow
  lint/ShellCheck report zero warnings. Planning and implementation receive
  native review through canonical `pr-flow` before lawful readiness/merge.

## Verification

Future implementation: extend the existing executable workflow suite rather
than asserting against invented porcelain strings. Commit a clean baseline in
an isolated temporary Git repository with no generated-directory ignore rules,
then create real ASCII and Unicode generated files with quoting enabled. Run
the unchanged guard logic for RED, apply the bounded repair for GREEN, and run
the dirty/prefix/lookalike matrix at all three boundaries. Also check unquoted
Unicode presentation without changing the user's global Git configuration.
Record exact source revisions, actual exits and relevant status/output evidence.

This intake verifies local source locations and records the plan only. No RED,
GREEN, workflow lint, hosted run, native approval or Rheos validation is claimed.
Parent owns commits, PR publication, native reviews and lawful transitions.

## Risks

- Broadening a prefix or suppressing a tracked row would weaken review integrity;
  pair generated-path success cases with strict dirty-tree failure cases.
- Tests using mocked status text can miss Git's real quoting behavior; force it
  in an actual repository and execute the production guard logic.
- The deterministic guard has a narrower allowance; fixing its representation
  must not import the review job's second directory exemption.
- The two-point estimate remains provisional until executable RED and planning
  review confirm the bounded scope; consumer mitigation is not shared-fix proof.

---
Local RED committed in 5255f9563b7a70ed46d40eccab4cabdbbc606796: 200 tests,190 pass,10 expected Unicode acceptance failures. GREEN changes only five quoted-path patterns on three shared workflow lines; workflow SHA256 a863c87944119fa619a39f432237f862327bb28cfe8285211386f1ef85531927. Actual full 200-test harness passes on Node22.20.0; baseline still190/10, independent guard reversions196/4,196/4,198/2. Actionlint1.7.11/ShellCheck0.9.0 both baseline and GREEN zero warnings. Strict tracked/unrelated/lookalike/mixed dirt and deterministic review-context refusal retained. Exact evidence .ημ/review-evidence/review-clean-tree-unicode/GREEN-20261007.json. Local tests use default synthetic transport fixtures, not actual Muse execution. Code-stage hosted deterministic/reviewer qualification and caller receiver-pin consumption remain pending; planning approvals on f7 do not transfer. Entering Testing and then Review through the documented standard native hops after scoped tests; no direct build-gated shortcut claimed.

---