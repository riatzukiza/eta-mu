---
uuid: "d452f01b-70d7-46aa-90ec-5ffd709e79bd"
title: "Validate legacy receipts in their containing repository"
status: "incoming"
type: "task"
priority: "P1"
points: "2"
labels: "cephalon, receipts, compatibility, validation"
category: "tasks"
parent: "8872994a-9a50-40a9-85a4-f4c6f5a6a21d"
---

## Context

The human explicitly included the narrow two-point adapter repair in the finite
Cephalon B1–B3 batch on 2026-10-17. The accepted scope decision is preserved in
`.ημ/review-evidence/cephalon-receipt-adapter/approved-scope-20261017.json`.
The containing repository supplies attribution; historical receipts must not be
rewritten to add `:repo`. CodeRabbit review5557104084, root4302111496 in personal
ETA PR31, correctly identifies that the reachable legacy extension still requires
that field. The existing canonical `eta-mu.receipt-river.api/validate-line` already
supports a nonblank containing-repository string as its third argument.

This plan is stacked on exact PR31 head
`0993581ac8ee602eb928375c15b29ea3e5425618`, which contains that API and both actual
validation routes. Its original three-point caller card remains Testing. This
additional two-point repair is separately estimated; no original card estimate,
relationship or status is changed. The already present owner API is reused, with
no new package or external source prerequisite. Initial Incoming metadata is a
supported Markdown input, not native admission or Ready.

## Outcome

The existing receipt validation command and tool accept a valid unversioned row
without `:repo` using the actual resolved containing repository. The canonical
owner still decides validity, original row bytes remain unchanged, explicit
historical attribution is retained, and context-free validation still refuses a
missing repository. This closes the real consumer defect before ETA31 can qualify.

## Scope

- Add the existing Receipt River package source path to the extension compiler.
- Keep receipt file location separate from repository context in both existing
  command and tool routes. Use the existing Git-root or active-repository result
  for context; a final `cwd` fallback may locate the file but supplies no context.
  Keep the legacy two-argument validator and file-reader
  surfaces compatible; preserve the JS result casing, arrays, event and line data.
  Invalid or absent attribution on the context-bearing route uses the owner's
  context-free refusal, never a blanket missing-field exemption.
- Add meaningful causal tests and compiled command/tool integration controls in
  the existing extension test namespace. Preserve existing assertions and routes.
- Preserve append-only receipts/reflections, actual source identities and raw
  failures. After qualified planning, native Rheos Ready precedes implementation.

## Non-goals

No owner-law change, second semantic validator, new correction protocol, legacy
writer migration, historical row/event rewrite, broad input coercion, new provider,
credential, paid route, timeout/budget increase, global Node change or review-policy
waiver. No runtime, maker, clock, gateway, cloud, deployment, social publication or
automation change. B1–B3 live proof remains separately required.

## Acceptance criteria

1. Independent planning assesses the complete scope, fair two-point estimate,
   compatibility, same-board parent and source boundary. After current-head
   planning qualification, walk native Rheos Incoming → Accepted → Breakdown →
   Ready → Todo → InProgress before production or regression-test implementation.
   The existing canonical API is part of the pinned same-repository base; no
   invented cross-board dependency or bypass of an unfinished prerequisite.
2. Both actual validation entry points keep receipt file location separate from
   repository context. A valid unversioned repo-less row succeeds only with
   nonblank containing context from an actual repository root. When Git-root
   resolution fails and no active repository is selected, use cwd only to locate
   receipts.edn and pass absent context; no context, blank context or a
   nonstring context can exempt missing repo.
   Explicit legacy `:repo` remains unchanged. Input file bytes are identical
   before/after each operation. Existing two-argument function behavior and JS
   keys (`ok`, `lineNumber`, `event`, `errors`, `line`) remain compatible.
3. Causal RED demonstrates the existing live command/tool refusal before adapter
   GREEN, not merely a mocked delegation or missing-symbol compile failure.
   Execute the real compiled extension routes against temporary Git roots and a
   receipt file outside Git, using frozen receipt bytes. With no active repository
   and no Git root, both actual routes must retain absent context and reject a
   repo-less row while preserving the receipt file location and bytes. Preserve
   malformed EDN/non-map, missing ordinary field,
   unsupported kind, invalid timestamp and invalid versioned-envelope refusals;
   valid explicit legacy and owner-valid versioned controls remain passing.
   Missing-file and mixed valid/invalid row results retain count/failure/last
   shape. Test resources are isolated and cleaned without host-state publication.
4. Run the full existing extensions suite, relevant canonical Receipt River
   tests, compiler/build/path checks and zero-warning lint. Retain exact commands,
   source and raw results; a targeted subset cannot substitute for a required
   full suite. Actual functional and mandatory hosted gates, complete changed-input
   reviews and canonical convergence precede exact-head authorized MERGE.
5. Integrate the qualified repair through ordinary history into ETA31, retain the
   original finding and all prior receipt bytes, then verify the real finding is
   fixed and requalify the new full ETA31 head. No approval or round transfers
   from this plan or the old source. Native Done follows actual code delivery.

## Verification

Use the existing extension compiler/test entry point and direct real command/tool
functions with isolated temporary roots, not a new adapter test harness or local
semantic validator. Compare original byte buffers. The exact owner API supplies
positive/negative semantics; test existing legacy two-argument compatibility
separately. Archive causal RED and final full outputs. Reuse suitable existing
checkout/dependencies; check 20 GiB free before a full snapshot or installation,
keep at most three expensive jobs, and preserve required independent stores.

## Risks and estimate

Two proposed points: one for existing compiler/delegation/root/result wiring and
one for causal compiled command/tool regression and qualification evidence.
The original caller's three points are not recounted. A permissive fallback,
changed legacy two-argument behavior, weakened envelope checks, lost JS casing,
or tests that only assert a mock call would conceal the defect. Native readiness
and independent planning remain prerequisites, not consequences of this document.

Software/process documentation: GPL-3.0-or-later.

## Planning clarification — 2026-10-17

CodeRabbit review5558542545/root4303285737 identified that the current command
and tool use `cwd` as the final location fallback. The active scope and criteria
now explicitly separate that file location from actual repository context and
require both outside-Git controls. The canonical API accepts a nonblank supplied
path; it does not authenticate repository identity. This is the same two-point
adapter and regression scope, with no owner-law or legacy-writer change. No
production implementation, native Ready or settlement of ETA31 follows here.
