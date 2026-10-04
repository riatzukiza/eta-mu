---
uuid: 5b6d71a4-d0d6-429a-ab25-e96677bc9dd0
title: Reuse hosted OpenCode reviews with existing Proxx policy
status: incoming
priority: P1
points: 6
labels: review, opencode, proxx, workflow, epic
created_at: 2026-10-04T07:20:00Z
---

## Context

The operator intends Proxx for OpenCode or Pi, not Codex CLI. Eta-mu already
has a hosted bounded OpenCode/Muse reviewer with complete input and evidence.
Use supported configuration to consume Proxx's existing EDN policy decisions.

## Outcome

The existing hosted OpenCode reviewer consumes Proxx and retains truthful,
complete evidence with the actual executor/provider identities distinguished.

## Scope

- Inventory configuration and producer evidence: child
  `0fd0d806-7224-4a8f-911b-a2ebe3ea613b` (1 point).
- Select existing Proxx policy/loading configuration: child
  `ca1d69bb-5345-4f2f-862b-9d94bd26668f` (1 point).
- Configure the existing hosted OpenCode reviewer: child
  `26568a3c-7d21-476e-a100-fe8f4fa1af1b` (2 points).
- Qualify hosted review and route evidence: child
  `16e3ef36-cc01-4eaf-8372-4869934506ca` (2 points).

Pi is an alternative to inventory, not a second implementation in this slice.
Proxx owns EDN provider/routing/fallback policy; Services owns overrides/mounts;
eta-mu owns workflow configuration; existing Muse review contracts/tools remain.

## Non-goals

No Codex action/CLI gateway path, worker, daemon, adapter, policy interpreter,
serializer, review engine, OpenAI-only restriction, blanket no-fallback rule,
automatic cohort admission, policy waiver, new secrets/permissions or deployment.

## Acceptance criteria

- [ ] Current supported OpenCode configuration and Pi's alternative seam are inventoried.
- [ ] Existing Proxx policy and deployed loading configuration are identified exactly.
- [ ] Hosted OpenCode consumes that supported configuration without duplicate routing logic.
- [ ] Existing full-input verification, Muse assessment and retained evidence remain complete.
- [ ] Requested and observable routed provider/model identities are accurately reported.
- [ ] Permitted fallback follows EDN; failed/incomplete/stale outcomes remain visible.
- [ ] No result is misrepresented as native Codex or automatically admitted to another cohort.

## Verification

Existing configuration/review fixtures and a bounded pinned hosted canary, using
exact source/runtime/policy revisions and actual run/artifact evidence.

## Risks

Capability findings may expose a configuration gap requiring separate scope.
Changing actual provider identity may invalidate the existing MiMo admission;
preserve evidence without promising approval-channel changes.

Design: [OpenCode with Proxx](../../docs/notes/opencode-proxx-review-workflow-20261004.md).
