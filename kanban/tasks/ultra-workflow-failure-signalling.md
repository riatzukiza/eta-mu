---
uuid: "ultra-workflow-failure-signalling"
title: "ultra.bb: signal workflow failure through exit code and pre-dispatch FSM hops"
status: "incoming"
priority: "P2"
labels: ["tasks", "ultra", "babashka", "workflow", "1sp"]
created_at: "2026-07-25T00:00:00Z"
source: "PR #142 review verification (pr-142-review-should-fix-batch)"
points: 1
category: "tasks"
---

# ultra.bb: signal workflow failure through exit code and pre-dispatch FSM hops

Two failure-signalling gaps in `scripts/ultra.bb`, found while verifying the
PR #142 review findings. Both are adjacent to findings that were fixed there
(`:failed-dispatch` / `:failed-commit` / `:failed-promotion` statuses and the
`run-stages` early halt), but neither was itself part of the reviewed set.

## Scope

1. **`run-workflow` always exits 0.** It prints per-stage statuses and writes the
   result EDN, but never sets a non-zero exit code — so a halted or failed run is
   indistinguishable from a clean one to any caller (CI, a wrapper script, a
   parent agent). Exit non-zero when any stage output has a `failed-*` status.

2. **Pre-dispatch `card-fsm!` hops discard their return values.** The
   `ready` → `todo` → `in_progress` hops before dispatch are called for effect
   only; `card-fsm!` returns `false` on a rejected transition or timeout, and a
   rejection is logged but does not stop the stage. The post-implementation hops
   (`review` → `document` → `done`) already gate on their return values via
   `:failed-promotion`. Make the pre-dispatch hops consistent: a rejected
   `in_progress` transition means the card is not in a state the workflow may
   implement against, so the stage should fail rather than proceed.

## Definition of done

- [ ] A workflow run containing any `failed-*` stage exits non-zero.
- [ ] A rejected pre-dispatch FSM hop fails the stage instead of only logging.
- [ ] `scripts/ultra_test.bb` covers both (exit code and rejected pre-hop).

## Verification

```bash
bb scripts/ultra_test.bb
```


## Proposed planning refinement — 2026-10-06

This is a planning-only proposal for [issue #258](https://github.com/open-hax/eta-mu/issues/258),
not implementation or lifecycle admission. The complete original scope and all
three Definition of done items above remain the outcome. UUID, incoming status,
one-point estimate, frontmatter and prior body are retained unchanged.

### Context and outcome

At accepted origin `09a4454480baa67f6fdc40f6f73f5e48ef0457d1`, pre-dispatch
`card-fsm!` results are discarded, while `run-workflow` returns a result without
making any `failed-*` stage visible through the command exit. Existing tests
already inspect dispatch, commit, post-implementation promotion and dependent-stage
failure separately; preserve those inspections rather than replacing them.

### Proposed scope and acceptance proof

- Describe the portable failure decision in `.cljc`: every keyword status whose
  name begins `failed-` makes the workflow result unsuccessful, including future
  failure statuses. Do not enumerate only today's failures. The Babashka outer
  CLI adapter turns that decision into a nonzero exit after retaining the result
  and its diagnostics; successful and intentionally skipped outcomes keep their
  supported exit behavior. Neither the pure decision nor its tests perform I/O.
- Apply pre-dispatch hops serially through the supported native Rheos adapter.
  Stop at the first rejection or timeout, retain which hop failed, and fail the
  stage. No later hop, agent dispatch, gates, commit or promotion may run after
  that refusal. The adapter delegates legality, WIP and board reads/transitions
  to Rheos; it defines no second FSM or frontmatter/status parser.
- Extend `scripts/ultra_test.bb` with isolated rejection and timeout controls for
  every pre-dispatch position, a successful-hop positive control and future
  `failed-*` result cases. Stub the effect boundary, never a live board/provider.
  Keep the independent existing failure and path-scoped commit assertions.
- Add actual Babashka CLI positive and negative subprocess proof to that test
  contract using disposable fixture workflows/storage and synthetic stage
  outcomes, with no model/provider dispatch, credential lookup, live transitions,
  shared caches or production journals. The failed fixture must produce a
  nonzero exit and retained failure result; the success fixture exits zero.
  Qualify this runner/fixture seam in implementation review rather than adding a
  production bypass or test-only failure flag.

### Verification and prerequisites

The full decision/adapter/test contract and current-source limits are in
[`docs/designs/ultra-workflow-failure-signalling-plan.md`](../../docs/designs/ultra-workflow-failure-signalling-plan.md).
Implementation starts only after current-head planning review and native lawful
Rheos admission. An installed CLI read reporting incoming is visibility evidence,
not proof that this accepted source was rebuilt or that the card is ready.

Future red/green proof must first demonstrate the two current failures without
providers, then pass the focused portable and Babashka fixtures, existing
`bb scripts/ultra_test.bb`, and relevant zero-warning lint/package gates. No
runtime test, implementation, ready transition, or completed outcome is claimed
by this planning append.

### Non-goals and risks

No workflow vocabulary, provider/retry policy, successful CLI output/result
shape, journal identity, historical ledger, independent test or estimate rewrite.
No lint-debt closure for issue #250, generic runner redesign, provider-env repair,
Rheos replacement, credentials, deployment, merge or publication activation.
The extracted Rheos command location and CLI subprocess fixture seam need
explicit review; if their qualification grows this one-point estimate, use
Rheos to refine sizing before implementation without reducing the outcome.
