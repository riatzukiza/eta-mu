---
uuid: "c84f0b33-7527-443a-a9ff-5ee2e2dfed48"
title: "Clarify final full-input page assessment before review evidence"
status: "testing"
type: "task"
priority: "P1"
points: "1"
labels: "cephalon, b3, review, prompt"
dependency: ["b9c591fb-95a8-4e4e-b2a5-39eb988cb996"]
write-id: "1791961158936-0.zhor1elppvj5v1ymra5"
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
de02c921-e23c-4d83-87e8-b32c6c3160ff as one of its five required deliveries; the
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
prompt through strictInvocationPrompt(basePrompt) and to the admitted corrective
prompt through strictInvocationPrompt(prompt) in runReviewRecovery. These are
currently runner lines 560 and 654; the function expressions are stable anchors. The new
instruction must reach both actual invocation prompts through that wrapper;
verify the corrective attempt retains it without changing either call path.
The third changed file is .github/scripts/opencode-code-review-workflow.test.mjs:
extend the existing recovery coverage to inspect both actual strict-mode
initial and admitted corrective invocation prompt arguments. The one-point
estimate includes this required narrow regression update.
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

1. When coverage.chunks > 0, the prompt names review_assess_diff_chunk with
   the final page's actual ID, including shorter final pages. It requires the
   returned assessment response to show coverage.assessed == coverage.chunks
   and coverage.missing empty before review_record_evidence; delivered/read
   coverage and model narrative alone remain insufficient. When
   coverage.chunks == 0, skip page reads and assessments; retain complete
   staged-context reading and every evidence-stage, submission and publication
   duty, without requiring a nonexistent final ID or assessment response.
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
   select the actual independently qualified post-clarification workflow
   MERGE (containing both the qualified caller and this final-page instruction)
   and matching qualified Muse MERGE, preserving its complete
   carried source and existing checks; no approval transfers from this source.

## Verification

Retain native attempt-one and attempt-two refusal evidence as RED. After
planning qualification and native Ready/Todo/IP, apply the three-file change (runner instruction, embedded copy and required
existing regression update),
run existing Node workflow/recovery tests (including actual initial/corrective
prompt retention) and exact embedded equality, then
inspect actual native review coverage/context/stages/submission/publication at
the changed source head. Retain source MERGE/readback and native lifecycle.

## Risks

Prompt clarification may not change model behavior. If actual review still
omits assessment, preserve the failure and keep delivery unqualified; never
repair the trace, waive the guard or repeatedly rerun an unchanged failed head.
One point is provisional for this bounded instruction, embedded copy and
required existing recovery regression update.

Software/process documentation: GPL-3.0-or-later.


---
Planning authoring correction for native CodeRabbit review5512063480/root4265878394: Outcome and Scope now explicitly distinguish existing guard refusals from the planned new strict-prompt instructions. The Incoming card names the actual final-page assessment call and returned assessed/chunks/missing check before stage one. Existing runner and embedded workflow remain byte-identical to parent bd3b048; no implementation or Ready is claimed. This supported initial-card body correction precedes Breakdown. One-point estimate, exact dependencies, all guards and independent source/consumer qualification remain unchanged.

Planning correction for native Codex review5512071815/root4265886252: the Non-goals section now excludes only product/social publication; trusted review publication remains explicitly required by acceptance criterion3. This removes the ambiguous broad publication word without changing scope, point estimate, review gates, proof requirements or the actual unchanged runner/workflow. Source is still Incoming and implementation remains unapplied.

Native Codex roots4265953854/4265953857 planning correction: this story now joins its B3 epic/parent and the epic explicitly totals seven provisional points over five required deliveries. Scope and AC require the new instruction in both actual initial and admitted corrective prompts and verification through existing recovery fixtures. Source inspection confirms runReviewRecovery already applies the common strictInvocationPrompt at initial line551 and again after correctivePrompt at line645. The proposed insertion in that common wrapper therefore reaches both; no missing retry wrapper is asserted and no duplicate constructor/recovery-rule edit is planned. Actual runner/workflow remain unchanged, source Incoming, one-point scope and existing gates/caps preserved.

Native Codex root4266060763 planning correction: the same approved one-point source story now explicitly lists three implementation files: prompt runner, matching embedded workflow and existing workflow/recovery test. Verification and estimate include the narrow required regression update, inspecting both actual strict-mode initial and admitted corrective invocation prompts. Two production edits plus their existing fixture update do not add a behavior, guard, recovery path or point. Implementation is still unapplied and Incoming.

Native Codex root4266143962 addressed by qualified owning Rheos board snapshot regeneration. The diagnostic now includes this exact new UUID and current epic/dependency/card data. Following the human board discipline that generated board.json is lossy diagnostic output ignored by Git, the obsolete tracked2026-05-29 projection is removed from the index and its regenerated file remains locally ignored. Cards and append-only native events remain tracked authority; existing CI already invokes Rheos for fresh snapshots in runner.temp. No local board parser/writer or manual snapshot generation. Complete changed-input review includes the old projection deletion and ignore rule; no artifact is relabeled as board-law validation.

Native Codex roots4266325318/4266325325 corrected: tracked empty kanban/.kanban/.gitkeep preserves the native snapshot output parent in a fresh checkout while generated board.json stays ignored. No writer or parser is introduced. AC4 now explicitly requires the consumer workflow pin to name the actual independently qualified post-clarification workflow MERGE, containing both qualified caller and new instruction, plus matching qualified Muse; an older caller-only pin does not satisfy it. One-point production/test scope and all guards remain unchanged.

Planning qualified on exact 9d0aacaa323d8ee042d019440fa07527c9746f39/base bd3b048e0bf92a4ef8062f3905694a3cbe930e4d: native MiMo APPROVED5513002675/run38507936057, all20 immutable pages assessed, context79lines EOF, five ordered stages, seven executed deterministic gates exit0, nine current checks PASS, all13 threads settled; canonical status/gate PASS with one completed available-MiMo planning cohort and authenticated current CodeRabbit/Codex quota exclusions. Actual owning Rheos lawful Incoming→Accepted→Breakdown→Ready→Todo→in_progress completed. New strict-mode regression invokes the actual recovery runner and compiled canonical Muse owner, receives exactly two prompts through admitted missing-submit recovery, and fails at absent final-page checkpoint in initial prompt. RED1test/0pass/1fail; synthetic adapter traces supply no provider/review credit. Production runner/workflow remain unchanged. Approved one-point/three implementation files; all guards/caps, independent parent/consumer qualification and B1/B2/B3 proofs retained.

GREEN after RED6f0c3829: seven-line final-page assessment/checkpoint instruction added only to existing strictInvocationPrompt; actual initial and sole admitted corrective prompt receive it. Runner decoded embedded bytes equal exactly at existing120-column wrapping; Node parse PASS; full workflow test suite242/242PASS/0fail/0skip and zero warning lines. New regression uses the actual strict runner and qualified canonical Muse fixture, verifies typed missing-submit recovery/accepted second invocation/held context/two-attempt cap before inspecting both prompts. Synthetic traces give no native model or review credit. All production bytes outside the prompt insertion and its exact embedded representation remain identical. Native testing phase; fresh full-input code review and all required hosted gates/publication/settlement/qualified source MERGE remain pending. ParentPR15 and consumer qualify independently; B1/B2/B3 still0of3. No credential/model/paid/runtime/agent/chat/spore change.

Native CodeRabbit COMMENTED5513162610/cr-comment:v1:cbf9b57aee10d3116b779d6a and summary6158888963 on88404680 identified the required regression one-page coverage gap. Exact suggested correction applied within the approved existing test scope: fullInputFixture now uses large:true with Unicode, and asserts canonical pages.length>1 before checking the final page is nonempty and shorter than8192. REDc441e02d fails at the new multi-page assertion with the prior small fixture; corrected full242tests PASS/0fail/0skip in28.838sec, no warning lines. Existing test still exercises both actual strict prompts and canonical typed recovery/held context/max2. It verifies delivered prompt instructions with synthetic canonical traces; it does not independently test the model choosing an incorrect page ID or prove future model behavior. Production runner/workflow stay unchanged at their approved seven-line-only delta. New concrete fixture correction requires fresh exact-head code review and full hosted checks; no old code/planning approval transfers, no native input shortened. Source remains Testing; no point/scope/guard/credential/runtime change.

Native Codex5513246730/root4266934756/threadPRRT_kwDOU4VdxM6sKzPp correctly identified valid zero-page input has no final ID. Existing strict recovery regression now covers both multi-page Unicode/short-final-page and the existing empty-input fixture, including actual initial and sole admitted corrective prompts through canonical accepted recovery. RED0d0f05dd fails at the absent zero-chunk exception after the empty canonical invocation succeeds. GREEN243tests243pass0fail0skip/26.990sec; zero warnings, runner/test parse and decoded embedded equality PASS. Only two extra prompt lines make the existing final-page checkpoint conditional: zero chunks skip page reads/assessments and retain staged-context reading/all evidence stages; nonempty input keeps final actual-ID assessment and returned complete coverage requirements. No canonical guard/tool/parser/retry/cap/source-input/credential/model change. Production delta remains confined to this prompt block and exact embedded copy; no new point or scope decision. New source head needs fresh full code review/hosted gates/settlement; older approvals do not transfer. Source remains Testing; goal ACTIVE/0of3, heartbeat human PAUSED, no live runtime/deployment/agent/chat/spore changes.

Current source-anchor correction for native Codex root 4267304041: the settled planning Scope cites runner lines 551 and 645 from its pre-implementation baseline. After the nine-line checkpoint insertion, the actual current initial call is line 560, let prompt = strict ? strictInvocationPrompt(basePrompt) : basePrompt; the actual corrective call is line 654, if (strict) prompt = strictInvocationPrompt(prompt). These stable function expressions identify both invocation paths even if future line numbers move. Actual parameterized canonical regression verifies both prompts for multi-page short-final and zero-page inputs. This appended current verification supersedes the old source locations without rewriting the past-Breakdown settled body, as the owning Rheos comment command requires. Scope, point estimate, production logic and every guard remain unchanged; complete new-head qualification is still required.

Acceptance-criterion correction for native Codex review5513783381/root4267390610: final-page ID and returned assessment-response coverage duties apply when coverage.chunks > 0. For canonical zero-page input, skip page reads/assessments because no final ID or assessment response exists, while retaining complete staged-context reading and every evidence-stage/submission/publication duty. This aligns AC1 with the already verified dca production behavior and parameterized canonical empty regression; no new scope, attempt, guard, metadata policy or runtime behavior. The original accepted wording and prior native verification remain append-only history.

Native CodeRabbit review5514049038/body item cr-comment:v1:021f347da872b27e60ea9c00 verification: focused actual runReviewRecovery/compiled Muse tests now cover final, earlier and multiple missing assessments, with complete staged-context reads and real multi-page/short-final geometry. Qualified Musea9 law input-before-first-stage? requires every assessment before stage1. The final-only transport projection is refused by canonical stage-chronology, so it supplies no retry authority or accepted review; earlier/multiple omissions also receive only one invocation. Existing healthy missing-submit recovery remains separately covered. Initial baseline controls RED3/3, actual negative GREEN3/3 and full246/246 pass with0fail/skip/warning lines. No runner/workflow/Muse guard or two-attempt cap changed. An independent native assessment of the requested positive retry is still required before any rejection settlement; this comment supplies no reviewer agreement, approval or round. Same one-point scope, Testing and all historical provenance retained.

---