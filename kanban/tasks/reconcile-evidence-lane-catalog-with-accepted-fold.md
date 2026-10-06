---
uuid: "6fa1867d-24da-4b20-92ee-b6372e66c1f4"
title: "Reconcile expert lane catalog with the accepted evidence fold"
labels: github, review, contracts, reconciliation
priority: "P1"
---

## Outcome
Extend the accepted `eta-mu.law.evidence` and `eta-mu.domain.evidence`
contract with dedicated lane catalog admission, preserving one result and
aggregate authority for issue [324](https://github.com/open-hax/eta-mu/issues/324).

## Context and blocker
[PR325](https://github.com/open-hax/eta-mu/pull/325) at
`8c27f2ddda691074e14982780a3f90922f804842` predates
[merged PR327](https://github.com/open-hax/eta-mu/pull/327), merge
`e322baad4ac11eb0069eabb17c738db60bf85362` on 2026-09-19.
Personal main `084cd150b8d5b9848d026e9ef8717747964dcd6d` contains PR327 and
its follow-up coverage/provenance repairs. PR325 adds incompatible snapshot,
producer, result, and aggregate schemas and a second fold. Repairing its old
fixtures alone would not reconcile this ownership conflict.

## Scope
- Describe how the three expert lane profiles bind the accepted result producer
  and review target, using reusable Katamorph resources where owned upstream.
- Preserve accepted coverage, inspected-citation, duplicate, contradiction,
  exact-target, and deterministic diagnostic behavior.
- Admit each result only against the selected actor/profile/revision and allowed
  artifact classes; enforce the declared maximum finding count.
- Validate catalog shape before traversing lane collections. Malformed scalars
  return explicit refusal rather than throwing before validation.
- Replace obsolete PR325 fixtures with fixtures for the accepted API and actual
  nested producer paths. Preserve every historical commit and native finding.

## Non-goals
No second aggregation API, provider fan-out, GitHub publisher, workflow activation,
controller, secrets, paid review capacity, branch protection, automatic merge,
or live service/database changes. PR342 belongs to a separate active lane.

## Acceptance criteria
- One explicit approved contract owner and migration decision precede code.
- Red tests reproduce forged actor/profile, out-of-lane artifact, excessive
  findings, malformed catalog collections, and missing producer fields.
- Legal catalog/results at the exact finding limit pass; one over the limit is
  refused before deduplication. Reordered completions preserve the verdict.
- Accepted existing evidence tests remain green, including exact retained
  references, unavailable lanes, and cross-lane duplicate/contradiction handling.
- `pnpm -C packages/eta-mu test`, `lint:kondo`, and relevant compilation pass with
  zero warnings; unavailable/full-suite failures remain blockers.
- Every PR325 native thread and review-body item has a writer disposition backed
  by current-source verification. No obsolete-head approval is reused.

## Verification and provenance
[Ownership triage](../../docs/verification/evidence-lane-catalog-reconciliation.md)
records the current contract difference and all native finding IDs. Raw GitHub
thread bytes are retained in `.ημ/archive/etamu325-triage-20261006/native-threads.json`.
This Markdown card is initial planning input. No Rheos transition or operational
board-state mutation is claimed; readiness awaits Rheos and planning review.
