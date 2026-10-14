---
uuid: "c84f0b33-7527-443a-a9ff-5ee2e2dfed48"
title: "Clarify final full-input page assessment before review evidence"
status: "incoming"
type: "task"
priority: "P1"
points: "1"
labels: "cephalon, b3, review, prompt"
dependency: ["b9c591fb-95a8-4e4e-b2a5-39eb988cb996"]
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
in parent planning PR15. This standalone one-point prerequisite is additional
to consumer ad41fc8a-12fe-453c-bdb9-29d832c94e9f's existing one-point two-pin
scope; it does not reestimate the earlier six-point epic or complete B3.

## Outcome

The existing strict caller prompt explicitly requires assessment of the final
page, even when shorter, and inspection of returned assessment coverage before
the first evidence stage. The canonical guard continues refusing omissions.

## Scope

Add only that instruction in .github/scripts/run-opencode-review-recovery.mjs
and regenerate its exact embedded copy in
.github/workflows/opencode-code-review.yml with existing 120-column wrapping.
Keep every tool, law, parser, context-custody rule, stage order, full-input
requirement, recovery predicate and two-attempt cap unchanged. Preserve native
failed attempts and all receipt/event/reflection prefixes. Deliver through an
independently qualified personal source MERGE before consumer adoption.

## Non-goals

No automatic assessment, input shortening, gate bypass, retry expansion,
reviewer identity or policy change, new verifier, fixed model slug, credential,
paid usage, service/runtime/maker/clock, heartbeat resumption, publication,
deployment or organization propagation. No broad prompt rewrite.

## Acceptance criteria

1. The prompt names review_assess_diff_chunk with the final page's actual ID,
   including shorter final pages. It requires coverage.assessed ==
   coverage.chunks and coverage.missing empty before review_record_evidence;
   delivered/read coverage and model narrative alone remain insufficient.
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
run existing Node workflow/recovery tests and exact embedded equality, then
inspect actual native review coverage/context/stages/submission/publication at
the changed source head. Retain source MERGE/readback and native lifecycle.

## Risks

Prompt clarification may not change model behavior. If actual review still
omits assessment, preserve the failure and keep delivery unqualified; never
repair the trace, waive the guard or repeatedly rerun an unchanged failed head.
One point is provisional for this bounded instruction and embedded copy.

Software/process documentation: GPL-3.0-or-later.
