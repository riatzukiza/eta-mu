# Document storage law repair

Original EtaMu PR336 head `a2f428afd7623dcd188d535512525ee521a5ba61`
is preserved in this branch's ordinary ancestry. Personal main
`084cd150b8d5b9848d026e9ef8717747964dcd6d` was integrated without rewriting
any old event or receipt; both independent append sequences are retained.
The scoped source repair addresses native Codex finding3998970657,
thread `PRRT_kwDORu27H86h3DZs`.

Portable `document-history.law.storage` now owns normalized .ημ path-component
admission. Node extern functions expose only absolute, intended ancestor-resolved,
and existing real paths. Infra applies the pure law before creation and after
resolution, then creates Clio directories. Clio still owns schema admission,
locking, appends, causal identity, replay and projection. The original package
scope is retained; this does not migrate or implement Rheos board state.

Red commit `a2fbf57` adds portable law tests and fails because that law namespace
is absent, as retained in red-missing-law.log. The green portable law also loads
under Babashka without Node. Actual root-selected document-history gate executes
the full NBB suite and compiled Node suite: each 13 tests /97 assertions with
zero failures or errors. Shadow compilation reports zero warnings, and actual
package lint:kondo reports zero errors/warnings. Root-gate.log retains executed
commands and both runtime results.

Preparation-wrong-cwd.log truthfully retains an earlier failed experiment:
invoking the package tests from the repository root broke the existing worker's
package-relative paths and produced18 failures. Using the declared package
command corrected this private preparation mistake without changing the worker
harness or tests. A direct root-cwd kondo invocation likewise missed the
package's macro configuration; the required package lint command passed.
Neither experiment is represented as source verification success.

Node106 dependencies were installed with scripts disabled and a task-private
pnpm store/cache. Compilation uses a private copied Maven repository and Java
user directory, with force-spawn/ephemeral nREPL for the initial compilation.
NBB initially materialized its own package-local .nbb cache. No services,
database, provider worker, signing credentials, global configuration, controller,
branch protection or live workflow activation was changed.

This local preparation does not supply native current-head review approval or
Rheos readiness. Original approvals remain bound to their original heads.
