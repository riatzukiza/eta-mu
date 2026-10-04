---
uuid: 0fd0d806-7224-4a8f-911b-a2ebe3ea613b
title: Inventory OpenCode and Pi configuration with review producer evidence
status: incoming
priority: P1
points: 1
labels: review, opencode, pi, proxx, evidence
epic: 5b6d71a4-d0d6-429a-ab25-e96677bc9dd0
parent: 5b6d71a4-d0d6-429a-ab25-e96677bc9dd0
created_at: 2026-10-04T07:20:00Z
---

## Context

Eta-mu already invokes a bounded OpenCode reviewer with Muse. Proxx is intended
for OpenCode or Pi. Existing input/submission contracts already cover the review.

## Outcome

A concrete inventory of the supported OpenCode configuration seam, Pi alternative
and available provider evidence, sufficient to configure the existing workflow.

## Scope

Identify actual provider/configuration fields, supported gateway API surface and
gateway-client authentication. Inventory Pi's existing compatible alternative
without implementing it. Map existing input/assessment/submission/run artifacts
to OpenCode executor, requested model and observable Proxx routed identity.
Document how the current eta-mu App/MiMo identity applies or ceases to apply.

## Non-goals

No new contract/schema, serializer, worker protocol, Codex gateway integration,
alternate review stages, credential disclosure or reviewer allowlist changes.

## Acceptance criteria

- [ ] Supported configuration fields and pinned runtime versions cite current evidence.
- [ ] First slice names OpenCode; Pi remains an inventoried alternative.
- [ ] Existing complete-input and assessment contracts are reused unchanged.
- [ ] Requested identity, observed route and unknown upstream identity are distinguished.
- [ ] Publication/admission consequences of any provider change are explicit.

## Verification

Inspect existing configuration/runtime code and artifacts. Reuse existing
contract fixtures; do not add tests that merely repeat the inventory note.

## Risks

A model name or generic GitHub job/App identity does not establish actual
provider identity. Native Codex execution/support remains separate.

Design: [OpenCode with Proxx](../../docs/notes/opencode-proxx-review-workflow-20261004.md).
