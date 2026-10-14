---
uuid: "c84f0b33-7527-443a-a9ff-5ee2e2dfed48"
title: "Clarify final full-input page assessment before review evidence"
status: "incoming"
type: "task"
priority: "P1"
points: "1"
labels: "cephalon, b3, review, prompt"
dependency: ["b9c591fb-95a8-4e4e-b2a5-39eb988cb996"]
write-id: "1791943398847-0.tbqcl4xeioo2pn9h4q7"
epic: "de02c921-e23c-4d83-87e8-b32c6c3160ff"
parent: "de02c921-e23c-4d83-87e8-b32c6c3160ff"
---

## Context

The human explicitly included this narrow prerequisite on 2026-10-14 in the
finite B1/B2/B3 milestone. ETA PR15's native MiMo run 38488169465 had two failed
attempts: both read all 11 diff pages but assessed only pages 1–10. The first
deterministic evidence stage correctly refused the missing assessment. Attempt
two's narrative claimed completion, but authenticated tool results retained
missing page 11. Neither attempt published a review or earned approval.

Caller b9c591fb-95a8-4e4e-b2a5-39eb988cb996 is independently Done after qualified
ETA PR14 MERGE 3ad5e24bb2eab51ea315a02f590ec234ad6bba46. Its closeout is carried
in parent planning PR15. This additional one-point story joins epic/parent
de02c921-e23c-4d83-87e8-b32c6c3160ff as its fifth required delivery; the
provisional total becomes seven points (2+1+2+1+1). Consumer
ad41fc8a-12fe-453c-bdb9-29d832c94e9f retains its existing one-point two-pin
scope. The human's approved addition does not complete B3.

## Outcome

The existing recovery and workflow guards refuse omissions, but the strict
caller prompt does not yet specify assessment of the final page or inspection
of returned coverage before the first evidence stage. Add that clarification
without changing the canonical guard.

## Scope

Add the strict caller prompt instruction to call
review_assess_diff_chunk with the final page's actual ID, including shorter
final pages, and to require coverage.assessed == coverage.chunks and
coverage.missing empty before review_record_evidence. Add only that
instruction in .github/scripts/run-opencode-review-recovery.mjs
and regenerate its exact embedded copy in
.github/workflows/opencode-code-review.yml with existing 120-column wrapping.
The existing common strictInvocationPrompt wrapper is applied to the initial
prompt at runner line 551 and again to correctivePrompt at line 645. The new
instruction must reach both actual invocation prompts through that wrapper;
verify the corrective attempt retains it without changing either call path.
Extend the existing workflow/recovery fixture only as needed to inspect the
actual initial and admitted corrective invocation prompt arguments.
Keep every tool, law, parser, context-custody rule, stage order, full-input
requirement, recovery predicate and two-attempt cap unchanged. Preserve native
failed attempts and all receipt/event/reflection prefixes. Deliver through an
independently qualified personal source MERGE before consumer adoption.

## Non-goals

No automatic assessment, input shortening, gate bypass, retry expansion,
reviewer identity or policy change, new verifier, fixed model slug, credential,
paid usage, service/runtime/maker/clock, heartbeat resumption, product/social
publication, deployment or organization propagation. Trusted review publication
remains required by acceptance criterion 3. No broad prompt rewrite.

## Acceptance criteria

1. The prompt names review_assess_diff_chunk with the final page's actual ID,
   including shorter final pages. It requires coverage.assessed ==
   coverage.chunks and coverage.missing empty before review_record_evidence;
   delivered/read coverage and model narrative alone remain insufficient.
   Both actual initial and admitted corrective invocation prompts retain this
   instruction; the pre-existing common strict wrapper remains the sole
   producer of the instruction, with no new recovery admission or attempt.
2. Tracked runner bytes equal the decoded embedded runner exactly; the runner
   parses and existing recovery/workflow regression tests pass. Relevant
   required hosted deterministic gates and zero-warning checks pass.
3. A fresh actual native review demonstrates every page assessed, complete
   staged-context reading, ordered stages, submission and trusted publication.
   Native full-input review, settlement and exact-head qualification precede
   MERGE. Local prompt preparation and the planning review alone prove none of
   this implementation behavior.
4. Consumer remains separately admitted and qualified. Its eventual two pins
   select actual qualified caller and Muse merges, preserving its complete
   carried source and existing checks; no approval transfers from this source.

## Verification

Retain native attempt-one and attempt-two refusal evidence as RED. After
planning qualification and native Ready/Todo/IP, apply only the two-file edit,
run existing Node workflow/recovery tests (including actual initial/corrective
prompt retention) and exact embedded equality, then
inspect actual native review coverage/context/stages/submission/publication at
the changed source head. Retain source MERGE/readback and native lifecycle.

## Risks

Prompt clarification may not change model behavior. If actual review still
omits assessment, preserve the failure and keep delivery unqualified; never
repair the trace, waive the guard or repeatedly rerun an unchanged failed head.
One point is provisional for this bounded instruction and embedded copy.

Software/process documentation: GPL-3.0-or-later.


---
Planning authoring correction for native CodeRabbit review5512063480/root4265878394: Outcome and Scope now explicitly distinguish existing guard refusals from the planned new strict-prompt instructions. The Incoming card names the actual final-page assessment call and returned assessed/chunks/missing check before stage one. Existing runner and embedded workflow remain byte-identical to parent bd3b048; no implementation or Ready is claimed. This supported initial-card body correction precedes Breakdown. One-point estimate, exact dependencies, all guards and independent source/consumer qualification remain unchanged.

Planning correction for native Codex review5512071815/root4265886252: the Non-goals section now excludes only product/social publication; trusted review publication remains explicitly required by acceptance criterion3. This removes the ambiguous broad publication word without changing scope, point estimate, review gates, proof requirements or the actual unchanged runner/workflow. Source is still Incoming and implementation remains unapplied.

Native Codex roots4265953854/4265953857 planning correction: this story now joins its B3 epic/parent and the epic explicitly totals seven provisional points over five required deliveries. Scope and AC require the new instruction in both actual initial and admitted corrective prompts and verification through existing recovery fixtures. Source inspection confirms runReviewRecovery already applies the common strictInvocationPrompt at initial line551 and again after correctivePrompt at line645. The proposed insertion in that common wrapper therefore reaches both; no missing retry wrapper is asserted and no duplicate constructor/recovery-rule edit is planned. Actual runner/workflow remain unchanged, source Incoming, one-point scope and existing gates/caps preserved.

---