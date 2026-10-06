# Planning acceptance criterion: one evidence authority

The source is published EtaMu PR4 head `63c989f380862a89b51c9bf50d3a1701528208f3`. Native CodeRabbit review `5432004666`, body item `cr-comment:v1:d04d7f3837af356601136077`, requested the missing acceptance criterion. This candidate adds exactly its three suggested lines to the existing card, UUID `6fa1867d-24da-4b20-92ee-b6372e66c1f4`.

The criterion requires each of the three planned expert profiles to be tested through the accepted result producer and `eta-mu.domain.evidence/aggregate-verdict`, rejecting separate producers or folds for individual profiles. The card already requires an explicit approved contract owner and migration decision before implementation. Its existing design document, frontmatter, status fields, identity, event ledger and implementation are unchanged.

## Source evidence and limits

`packages/eta-mu/src/cljs/eta_mu/law/evidence.cljs` declares `producer-schema`, including `:actor/binding` and `:attestation/hash`; `lane-result-schema` nests that schema at `:evidence/producer` with the accepted `:review/target`. `packages/eta-mu/src/cljs/eta_mu/domain/evidence.cljs:227` defines the shared `aggregate-verdict`. The result constructor at `packages/eta-mu/test/cljs/eta_mu/domain/evidence_test.cljs:27` is a test fixture, not a production producer.

Historical donor PR325 head `8c27f2ddda691074e14982780a3f90922f804842` names three profile revisions: `:eta-mu.profile/contracts-schema-reviewer-v1`, `:eta-mu.profile/tests-failures-reviewer-v1`, and `:eta-mu.profile/ci-provenance-reviewer-v1`. Its lane IDs are `:contracts-schema`, `:tests-failures`, and `:ci-provenance`. The accepted test suite instead uses required lanes `:contracts`, `:tests`, and `:ci-provenance`. Current accepted source contains no concrete three-profile catalog or production routing consumer. The archived donor catalog establishes the recovered vocabulary only. This candidate does not implement routing or decide an alias migration; that remains the preceding planning decision.

## Verification

The installed eta-mu 1.1.1 CLI read this actual card through Rheos with exit 0, from this isolated worktree, with private cache and temporary directories. Exact invocation: `env -u KANBAN_CONFIG XDG_CACHE_HOME=/tmp/etamu4-planning-ac-runtime-20261006/cache TMPDIR=/tmp/etamu4-planning-ac-runtime-20261006/tmp /home/err/.volta/bin/eta-mu kanban read-task 6fa1867d-24da-4b20-92ee-b6372e66c1f4`. Its raw response and stderr are retained separately. This read did not transition the card or change the tracked event ledger.

`source-proof.json` records the exact native suggestion, unchanged card frontmatter, unchanged complete event ledger, unchanged design document, and preserved published receipt prefix. Direct source inspection verifies the shared producer schema and aggregate function; the three profiles are recovered donor names, with no claim that current routing exists. Diff hygiene passes. No implementation or redundant behavioral tests were added for this Markdown criterion.

The actual `eta-mu.receipt-river.api/validate-line` API inspected every nonempty physical root receipt line before and after the append using an owned source copy. The published 256-row prefix is intact: its inherited 254 rows still contain the same 56 invalid historical rows, while its two previously owned envelopes and the one new envelope are valid. `receipt-admission.json` records all failed physical line numbers and the new row's declared schema. Whole-history validity is explicitly false. No past receipt or event was rewritten.

Native review convergence and Rheos readiness remain separate prerequisites. No new review request, native settlement, push, merge, workflow, board-state or operational change was performed while preparing this candidate for independent review.
