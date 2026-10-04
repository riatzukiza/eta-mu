---
uuid: 26568a3c-7d21-476e-a100-fe8f4fa1af1b
title: Configure the existing hosted OpenCode reviewer to consume Proxx
status: incoming
priority: P1
points: 2
labels: review, opencode, proxx, workflow
epic: 5b6d71a4-d0d6-429a-ab25-e96677bc9dd0
parent: 5b6d71a4-d0d6-429a-ab25-e96677bc9dd0
dependency: ca1d69bb-5345-4f2f-862b-9d94bd26668f
created_at: 2026-10-04T07:20:00Z
---

## Context

The reusable OpenCode workflow already supplies the bounded reviewer, Muse
tools, exact input verification, recovery and retained publication artifacts.

## Outcome

That existing hosted reviewer consumes Proxx through supported configuration
data, preserving complete review evidence and truthful producer identity.

## Scope

Wire the identified OpenCode provider configuration and existing admitted gateway
authentication into the reusable workflow. Use its existing eligibility and
review context. Keep provider/routing/fallback decisions in Proxx EDN and use
trusted pinned machinery. Preserve full input, assessment, frozen submission and
failure artifacts. Correctly label actual execution/provider evidence; avoid an
approving publication that canonical policy would misclassify after a provider
change. Keep stale results bound to the reviewed SHA.

## Non-goals

No new hosted workflow engine, Codex gateway path, SSH worker, adapter, serializer,
duplicated policy, arbitrary PR-selected configuration, new credentials/permissions,
automatic cohort admission or deployment.

## Acceptance criteria

- [ ] Existing OpenCode runtime consumes the supported Proxx provider/configuration data.
- [ ] PR content cannot choose gateway credentials, trusted config or executable machinery.
- [ ] Existing exact-head/full-input/assessment/recovery boundaries remain enforced.
- [ ] Routing and permitted fallback stay in EDN rather than GitHub code.
- [ ] Unavailable/quota/failed/incomplete outcomes retain evidence and never become success.
- [ ] Executor/provider identity is truthful and stale evidence cannot become current-head approval.
- [ ] Any changed approval-channel admission remains separate from workflow configuration.

## Verification

Actionlint/ShellCheck and meaningful existing workflow/configuration fixtures.
Hosted qualification follows reviewed configuration and usable existing gateway
authentication; this planning card performs no activation.

## Risks

The current eta-mu App is interpreted as MiMo by canonical policy. A new route
does not automatically preserve that provider identity or admit a new cohort.

Design: [OpenCode with Proxx](../../docs/notes/opencode-proxx-review-workflow-20261004.md).
