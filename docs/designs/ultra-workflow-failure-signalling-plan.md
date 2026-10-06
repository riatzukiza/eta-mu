# Proposed ultra workflow failure signalling

Planning only for [eta-mu issue #258](https://github.com/open-hax/eta-mu/issues/258)
and existing task `ultra-workflow-failure-signalling`. This note proposes future
law, adapter and test obligations. It changes no runtime or board state.

## Current authority and gap

Accepted origin is `09a4454480baa67f6fdc40f6f73f5e48ef0457d1`. The current
`scripts/ultra.bb` calls pre-dispatch `card-fsm!` hops for effect at lines
291–293, ignoring `false` from rejection or timeout before dispatch.
`run-stages` already halts dependent stages on a `failed-*` output. However,
`run-workflow` at lines 408–444 persists/prints the result and returns normally;
`-main` does not convert that failure decision into a process exit. These are
static source observations, not a new execution or test result.

The existing `scripts/ultra_test.bb` independently inspects dispatch failure,
commit failure, path-scoped commit commands, post-implementation promotion
rejection and dependent-stage halting. Keep every existing inspection. The
original issue/card still requires all three outcomes verbatim:

- A workflow run containing any `failed-*` stage exits non-zero.
- A rejected pre-dispatch FSM hop fails the stage instead of only logging.
- `scripts/ultra_test.bb` covers both (exit code and rejected pre-hop).

The one-point incoming card remains authoritative as observed, without a
ready claim. Readiness, transition legality and WIP come from native Rheos.
A private copy of accepted extracted Rheos
`ef3c4abf1ea75199486f693e9470df3fec88dd49` successfully read this card through
`read-task ultra-workflow-failure-signalling --config openhax.kanban.edn`.
The artifact SHA-256 is
`33efe2e97202abe7df28b65fb20fbabb78fd910049ed60f301d112a895c7633b`.
It is accepted diagnostic artifact evidence, not cold Node22/npm-release
qualification or lifecycle admission. The earlier installed1.1.1 visibility
read is retained separately and supplies no accepted-build equivalence claim.
The root coordinator assigned this planning lane; complete external worker
ownership is unknown, not inferred absent from application inventory.

## Proposed pure decision

A small portable `.cljc` decision consumes shaped workflow stage outputs and
returns success/failure information for the adapter. Failure is the existing
predicate's open vocabulary: a keyword status whose name starts `failed-`.
Apply it to every relevant stage output, regardless of stage identity/order.
Do not narrow it to `failed-dispatch`, `failed-commit` or `failed-promotion`.
An unknown future `:failed-synthetic-fixture` must therefore also fail.

Proposed laws cover an empty successful result, successful/skipped stages,
a failure among otherwise successful outputs, multiple failures and order
independence. Preserve the current supported treatment of non-status outputs;
review malformed-input handling explicitly rather than silently expanding the
CLI contract. The law owns neither process exit nor files, host objects, Rheos
semantics, providers or journal writes. Put the pure namespace in the existing
repository law boundary, selected during red preparation; the BB adapter owns
reading the data and applying its decision.

## Proposed pre-dispatch adapter contract

Derive the required hop sequence from the existing declared start context.
Invoke hops serially. After the first rejected or timed-out hop, stop: no later
hop, dispatch, gate, commit or promotion. Return a failed stage output with
retained hop/refusal diagnostics so `run-stages` also halts dependent stages.
Successful hops retain the existing order and continue once; do not invent
shortcuts or accept a rejected transition to satisfy the workflow.

Rheos remains the only board/FSM authority. The BB adapter invokes the supported
extracted Rheos owner CLI/API and consumes its success/refusal contract. It does
not copy the FSM, interpret frontmatter, implement board status or replace WIP.
Current `card-fsm!` references `packages/rheos/dist/cli.cjs`; extraction means
that location needs a supported owner invocation before live qualification.
Any existing local status-read helper must delegate to the native read surface
where this implementation touches it, without introducing another parser.
No live transition is exercised by these proposed fixtures.

## Proposed exit adapter and preserved behavior

After the existing result has been persisted and reported, the BB outer CLI
adapter converts a failed decision into a nonzero command exit. Keep the
successful result, diagnostics, CLI verbs/flags, journal behavior and result
shape; do not rewrite the command interface or swallow existing exceptions.
The portable function returns data rather than calling `System/exit`.
Independent function-level tests stay usable without terminating their host.
Actual subprocess proof supplies the observable command-level contract.

## Future red/green fixture matrix

| Proof | Required observation |
| --- | --- |
| Pure successful/skipped/empty output | Successful decision; no I/O |
| Every existing and synthetic future `failed-*` output | Failure decision independent of key/order |
| First, middle and last required pre-hop rejected | Failed stage; no later hop or dispatch/gates/commit/promotion |
| Same positions timed out | Same refusal boundary, retained timeout diagnostics |
| All required pre-hops succeed | Original serial order; one admitted dispatch |
| Failed stage followed by dependent stage | Existing independent halt assertion retained |
| Actual BB CLI synthetic failure | Nonzero exit, retained result/diagnostic in fresh private storage |
| Actual BB CLI synthetic success | Zero exit and supported result/output shape |
| Existing dispatch/commit/promotion/path-scope checks | Each original assertion remains meaningful |

Implement the subprocess proof through reviewed disposable fixture workflows
and an existing runner seam or a small explicit test harness binding synthetic
stage outcomes. It must exercise the actual `-main`/exit adapter; testing only
its pure return value is insufficient. It must never run model/provider code,
look up provider credentials, invoke a real board transition or touch a shared
journal. Do not add a production failure flag or bypass that can waive gates.
First record red failures for ignored pre-hop refusal and normal failed-stage
exit on the current code; then qualify green without changing the independent
existing tests merely to match the implementation.

Run `bb scripts/ultra_test.bb` and focused portable-law tests in the lightest
supported runtimes, with independent JVM and CLJS law fixtures where practical
under the repository's harness. Complete relevant zero-warning lint and package
checks for actual touched code. No suite/host pass is claimed in this note.
Issue #250 separately owns the existing script analysability/lint allowlist debt;
a required lint failure stays visible and must be resolved or explicitly held,
not suppressed by this plan.

## Planning and base prerequisites

Personal fork `riatzukiza/eta-mu` has default main
`084cd150b8d5b9848d026e9ef8717747964dcd6d`, an ancestor of accepted origin with
zero fork-only commits and seven accepted commits behind. This local candidate
starts at accepted `09a4454` and, after explicit coordinator authorization,
fast-forwards to independently prepared synchronization candidate
`093a6dbf00fcfadea26f07ac7e3db29bc627a533`. That preserves all seven accepted
commits and the synchronization metadata as inherited prefix, keeping the
proposed feature diff bounded. Synchronization publication still requires its
own independent peer and native guards before this planning PR may be published.
This note does not authorize a fork main reset, merge, synchronization PR or
adoption of another worker's source. All five existing personal PRs and their
history, including invalid historical receipt rows in predecessors, remain
untouched.

Current-head planning review and native lawful ready/WIP admission precede red
implementation. Accepted-build read evidence and installed CLI visibility are
separate; neither alone grants operational admission. Preserve the full card
body/frontmatter, one-point estimate, event ledger and receipt/reflection
prefixes. Review may require a lawful estimate refinement if the adapter or
fixture seam materially exceeds that scope; it may not drop either failure
outcome. No new card, duplicate UUID or fake dependency is proposed.

## Non-goals

No provider/config policy, workflow language redesign, repeated agent retry,
Rheos replacement, global installation, services, secrets, settings, paid review,
deployment, automatic merge or upstream release. No implementation, operational
transition or task closure occurs in this planning candidate.
