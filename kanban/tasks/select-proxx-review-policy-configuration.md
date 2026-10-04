---
uuid: ca1d69bb-5345-4f2f-862b-9d94bd26668f
title: Select existing Proxx EDN review configuration and deployment loading
status: incoming
priority: P1
points: 1
labels: review, proxx, policy, configuration
epic: 5b6d71a4-d0d6-429a-ab25-e96677bc9dd0
parent: 5b6d71a4-d0d6-429a-ab25-e96677bc9dd0
dependency: 0fd0d806-7224-4a8f-911b-a2ebe3ea613b
created_at: 2026-10-04T07:20:00Z
---

## Context

Proxx's existing EDN system owns provider selection, routing, fallback and cost
policy. The workflow should consume supported data rather than implement policy.

## Outcome

A reviewed selection of existing policy/configuration, with the exact Proxx
runtime and Services loading/mount path identified.

## Scope

Use current capability findings to select existing EDN configuration and any
small supported data changes needed by the OpenCode reviewer. Keep permitted
providers and fallback governed by that data; do not add an OpenAI-only or
blanket no-fallback requirement. Services owns deployment overrides/mounts.
Record exact intended and loaded policy revisions and how route evidence can be
observed. A missing configuration capability becomes a precise separate gap.

## Non-goals

No Proxx runtime code, policy interpreter, workflow routing decisions, worker,
serializer, new provider restriction, credentials or deployment in this plan.

## Acceptance criteria

- [ ] Selected fields and policy files are supported by the qualified current runtime.
- [ ] Existing policy controls the API path selected by OpenCode, including permitted fallback.
- [ ] Services loading/override/mount evidence distinguishes intended from deployed data.
- [ ] Requested selection and observable actual route can be reported truthfully.
- [ ] Capability gaps are explicit; eta-mu does not substitute policy implementation.

## Verification

Reuse existing Proxx configuration/policy checks and current runtime inventory.
Controlled execution follows reviewed planning and configured gateway access;
this planning change performs no execution or deployment.

## Risks

On-disk data and gateway health do not prove live policy loading. Estimate is
contingent on the current data-only capability findings.

Design: [OpenCode with Proxx](../../docs/notes/opencode-proxx-review-workflow-20261004.md).
