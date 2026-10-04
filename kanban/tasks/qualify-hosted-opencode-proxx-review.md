---
uuid: 16e3ef36-cc01-4eaf-8372-4869934506ca
title: Qualify hosted OpenCode review through Proxx with complete evidence
status: incoming
priority: P1
points: 2
labels: review, opencode, proxx, canary, evidence
epic: 5b6d71a4-d0d6-429a-ab25-e96677bc9dd0
parent: 5b6d71a4-d0d6-429a-ab25-e96677bc9dd0
dependency: 26568a3c-7d21-476e-a100-fe8f4fa1af1b
created_at: 2026-10-04T07:20:00Z
---

## Context

Successful invocation alone does not establish full review coverage or actual
provider identity. Existing workflow artifacts make a bounded canary inspectable.

## Outcome

A pinned hosted canary demonstrates OpenCode consuming Proxx's configured policy
and retains complete, correctly identified review evidence.

## Scope

After normal planning/activation prerequisites, use a clean control and a known
changed-line defect. Include full input beyond the bounded preview and controlled
unavailable/incomplete/stale cases. Observe requested model, loaded policy and
actual route/fallback where exposed. Retain real run/artifact identities and
input/assessment/submission bytes; label unknown upstream identity honestly.

## Non-goals

No synthetic native Codex approval, automatic provider/cohort admission, policy
waiver, new fallback prohibition, blind retry, secrets/deployment changes or merge.

## Acceptance criteria

- [ ] Source-supported defect and clean control complete through the existing reviewer.
- [ ] Full input beyond the preview is delivered and assessed with existing Muse tools.
- [ ] Gateway/policy/requested model and observable route/fallback evidence are retained.
- [ ] Failed/incomplete/stale cases retain truthful outcomes and no false approval.
- [ ] Published or retained evidence names OpenCode/Proxx and actual provider identity.
- [ ] Any future admission change remains separately reviewed in canonical policy.

## Verification

Inspect real hosted executions at full canary heads; compare input, assessment,
result and route evidence with source/configuration. Job names do not supply
provider identity, and missing observations remain unknown.

## Risks

Provider quotas remain operational facts. A provider change may require retained
report evidence until a separate identity/admission decision is reviewed.

Design: [OpenCode with Proxx](../../docs/notes/opencode-proxx-review-workflow-20261004.md).
