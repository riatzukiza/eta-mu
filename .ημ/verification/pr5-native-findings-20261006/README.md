# Native PR5 findings

CodeRabbit review5431267699 examined ef7d003ca79c616fb59987f6c1ee592fe3579b07.

- Body item cr-comment:v1:f39367db45acf76f09272a93: corrected two spaces in the human-authored verification README; raw test outputs and archives remain unchanged.
- Body item cr-comment:v1:7a0a2147c52b2d9386807b39: added package.json to the pull_request filter, matching the existing push filter. actionlint passes; all nine paths match. Jobs, permissions and execution steps remain unchanged. No deployment or privileged controller is introduced.
- Thread PRRT_kwDOU4VdxM6pjW8X, comment4197627167, cr-comment:v1:23be9fa5598287a008ffc3af: requests rewriting the historical task-created event source-path. The event is byte-identical to original PR336 source commit a2f428afd7623dcd188d535512525ee521a5ba61. Its path was emitted by Rheos task_create.cljs:131 via events.cljs:135 as creation provenance. Replacing it would rewrite an immutable fact. The current task document exists at kanban/tasks/reusable-clio-document-history-and-edn-projections--history.md. Keep the finding open pending authenticated independent rejection assessment; do not call it Fixed or Handled. Any future producer portability policy belongs to Rheos and does not authorize rewriting this event.

Checks: actionlint exit0; identical nine pull_request/push path filters; missing-space checks pass; complete Rheos ledger byte-identical to pre-repair head. No runtime source/test changes, so prior exact-head document-history CI (13 tests/97 assertions under NBB and compiled Node, zero warnings) remains historical evidence and is not advertised as qualification of the next commit. New-head hosted checks/review remain necessary.

Baseline root receipt history still has 56 inherited invalid rows; this repair does not alter them. Owned new receipts are tested with the actual child API, including required repo. Automatic merge remains off and no merge is authorized.

Independent local assessment: root independently agreed that the observed task-created source-path at 2026-09-13T05:21:08.544Z cannot be replaced with a different historical capture. Future portability belongs to the authoritative Rheos writer/projection. This local assessment is preparation only, not authenticated native rejection agreement, review approval, or completed-round credit. The native finding remains open.
