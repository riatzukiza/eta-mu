# Evidence lane catalog reconciliation

## Observed ownership change

Original [PR325](https://github.com/open-hax/eta-mu/pull/325) remains open at
`8c27f2ddda691074e14982780a3f90922f804842`. Canonical status on 2026-10-06
reports 14 unresolved threads (8 P1, 3 P2, 3 unknown), 3 failing checks, no
exact-head approval, and one completed round. These findings remain unsettled.

[Issue324's writer update](https://github.com/open-hax/eta-mu/issues/324#issuecomment-5500574494)
names replacement implementation PR327. [PR327](https://github.com/open-hax/eta-mu/pull/327)
merged on 2026-09-19 as `e322baad4ac11eb0069eabb17c738db60bf85362`.
Verified personal main `084cd150b8d5b9848d026e9ef8717747964dcd6d` contains it.
The accepted namespaces are `eta-mu.law.evidence` and `eta-mu.domain.evidence`.
Their recent follow-up `ebf6c28` enforces lane coverage and inspected citations.
Neither fold currently has a production infra consumer in the inspected tree.

| Boundary | PR325 candidate | Accepted main |
| --- | --- | --- |
| Target | top-level `:review/head`, repository ID, snapshot hash | nested `:review/target`, base/head, object ID, input/closure hashes |
| Producer | actor, binding, profile/workflow revision, attestation | actor binding and attestation |
| Request | snapshot, catalog, result sequence | one closed aggregate request |
| Verdict | success/failure/blocked and detailed lane states | approved/advisory/evidence blocked/conflicted/unavailable |
| Catalog | dedicated three-lane profiles and budgets | caller-required lane declarations |

This is a contract ownership conflict, not a mechanical merge conflict. An
ordinary disposable merge into current personal main was clean and still
produced exactly the seven obsolete candidate additions; it did not resolve
semantic ownership. That unpublished branch is retained unchanged as evidence.
No PR325 code was edited, published, closed, merged, or normalized.

## Native findings requiring reconciliation

The old Codex actor/profile and exact-reference findings are already addressed
inside PR325's candidate but remain unresolved; they need equivalent regression
proof in the accepted contract before any final disposition. Current Codex also
identifies genuinely missing artifact-class and maximum-finding admission.
CodeRabbit identifies malformed catalog traversal and obsolete catalog/producer
fixtures. MiMo requests changes for the catalog argument and producer fixtures.
Its actor-test explanation incorrectly computes distinct nil values, but the
reported nested-path defect is real and independently confirmed in source.

Raw thread JSON retains complete bodies and native identities, including all
review waves. No bot identity or approval is substituted by this triage.

| Native thread | Original finding |
| --- | --- |
| `PRRT_kwDORu27H86eRky9` | [3908390861](https://github.com/open-hax/eta-mu/pull/325#discussion_r3908390861) |
| `PRRT_kwDORu27H86eRky_` | [3908390865](https://github.com/open-hax/eta-mu/pull/325#discussion_r3908390865) |
| `PRRT_kwDORu27H86eR1ri` | [3908493836](https://github.com/open-hax/eta-mu/pull/325#discussion_r3908493836) |
| `PRRT_kwDORu27H86eR1rq` | [3908493847](https://github.com/open-hax/eta-mu/pull/325#discussion_r3908493847) |
| `PRRT_kwDORu27H86eR1r2` | [3908493860](https://github.com/open-hax/eta-mu/pull/325#discussion_r3908493860) |
| `PRRT_kwDORu27H86eR1r8` | [3908493870](https://github.com/open-hax/eta-mu/pull/325#discussion_r3908493870) |
| `PRRT_kwDORu27H86eR7j8` | [3908529654](https://github.com/open-hax/eta-mu/pull/325#discussion_r3908529654) |
| `PRRT_kwDORu27H86eR7kF` | [3908529667](https://github.com/open-hax/eta-mu/pull/325#discussion_r3908529667) |
| `PRRT_kwDORu27H86eR7kU` | [3908529683](https://github.com/open-hax/eta-mu/pull/325#discussion_r3908529683) |
| `PRRT_kwDORu27H86eR7kd` | [3908529696](https://github.com/open-hax/eta-mu/pull/325#discussion_r3908529696) |
| `PRRT_kwDORu27H86eR7kg` | [3908529700](https://github.com/open-hax/eta-mu/pull/325#discussion_r3908529700) |
| `PRRT_kwDORu27H86eSJH0` | [3908613440](https://github.com/open-hax/eta-mu/pull/325#discussion_r3908613440) |
| `PRRT_kwDORu27H86eSJH4` | [3908613447](https://github.com/open-hax/eta-mu/pull/325#discussion_r3908613447) |
| `PRRT_kwDORu27H86eSJH7` | [3908613453](https://github.com/open-hax/eta-mu/pull/325#discussion_r3908613453) |

The five CodeRabbit body items duplicate its inline findings. Their stable IDs
are `cr-comment:v1:fe28b6c5d8f4e75fe168fa2a`,
`cr-comment:v1:62eb9d364d8ba700ddc7a735`,
`cr-comment:v1:5f916ab3398fbeb6f3712db2`,
`cr-comment:v1:3ece09429992e0664b015f65`, and
`cr-comment:v1:1e2442c590ad3c437da37afa`. The MiMo body-only change request
also remains active. No Fixed or Deferred settlement is claimed by this plan.

## Proposed next slice

Initial card UUID `6fa1867d-24da-4b20-92ee-b6372e66c1f4` scopes catalog admission
through the accepted schemas and fold. First review the ownership/migration
choice, then use Rheos for readiness, write red admission tests, and implement
only that reviewed slice. Provider availability, native approval, deterministic
gates, and staging/deployment authority remain separate requirements.

This planning-only branch runs no package code, services, database, provider,
controller, or workflow. JSON parsing, Git ancestry/source inspection, the
canonical PR status caller, append-only receipt validation and diff hygiene are
preparation evidence. No compilation or Rheos validation is represented as passed.
