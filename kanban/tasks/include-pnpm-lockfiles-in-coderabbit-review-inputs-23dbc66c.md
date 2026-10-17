---
uuid: "23dbc66c-ef1e-4afc-8a38-ca974804c2a8"
title: "Include pnpm lockfiles in CodeRabbit review inputs"
status: "incoming"
priority: "P1"
points: "1"
labels: "tasks, review, configuration, 1sp"
type: "task"
---

# Include pnpm lockfiles in CodeRabbit review inputs

## Context

[PR25](https://github.com/riatzukiza/eta-mu/pull/25) changes fourteen paths from accepted planning base `4eaa34d18b5e07d9f26f0ebe4d20cf7e65ef9a41` to `80abc356a8fdbc0c6ca5e291d1274ae74a86c68f`. Native CodeRabbit [comment6227210383](https://github.com/riatzukiza/eta-mu/pull/25#issuecomment-6227210383) reports default configuration, thirteen selected paths and root `pnpm-lock.yaml` excluded by `!**/pnpm-lock.yaml`. This is incomplete input, not completed review. The separate usage/spending-cap response and parsed 2026-10-17T00:28:46Z included-review cooldown remain unchanged.

Four targeted official Rheos searches found no matching owner on the recorded ETA carrier. The source-map one-point card explicitly excludes review-provider changes. Keep this standalone one-point scope separate from it and from install-bin/bootstrap or quality-epic work. No formal dependency is proposed.

## Outcome

A native exact-head CodeRabbit review receives the real changed pnpm lockfile and the other previously eligible inputs, with existing review configuration and account limits preserved.

## Scope

Only repository-local `.coderabbit.yaml` is a product path. The three-line filter exhibit is:

```yaml
reviews:
  path_filters:
    - "**/pnpm-lock.yaml"
```

The [documented exact-default override](https://docs.coderabbit.ai/configuration/path-instructions#how-path-filters-combine) removes this default without restricting other paths to an allowlist. For a new file, the preservation candidate adds root `inheritance: true` before that block; [inheritance otherwise defaults false](https://docs.coderabbit.ai/configuration/configuration-inheritance). Verify actual inherited origins and values before claiming preservation. Required planning/native events and append-only provenance remain separate.

## Non-goals

No account/UI/global-override, plan, billing, spend-cap, quota, reviewer roster, approval/round/check gate or workflow change. No dependency/lockfile content edit, bootstrap repair, broad quality cleanup, synthetic approval or fabricated full-input review. Do not expand the source-map owner.

## Acceptance criteria

- The reviewed product delta is only the exact default override and the narrowly required inheritance-preservation flag. No other review setting or previously eligible path is changed.
- Retain the original native thirteen-of-fourteen evidence. Freeze actual implementation head/base, configuration bytes and complete changed-path set. Do not assume the later diff still has fourteen paths after adding configuration/provenance.
- Obtain CodeRabbit's native fully resolved configuration with source annotations on the admitted head. Verify the consumed feature/base configuration and inheritance chain, preserve all unrelated values, and establish that no inherited explicit exclusion or higher global override still removes the lockfile. Unknown origins, unavailable readback or conflicting settings block completion; account changes are outside scope.
- After an authorized deduplicated request at an available included-review opportunity, retain a completed native exact-head review/input readback that includes the actual root lockfile diff and every other eligible changed path. Selected-for-processing metadata alone is not completed review or approval. No manufactured lockfile edit or local glob simulation supplies this proof.
- Preserve all required checks, existing review findings, availability/quota history and canonical review/merge gates. This input repair grants no approval, cohort, release or deployment credit.

## Verification

Review the one-file proposal and official documentation, then obtain lawful planning readiness before implementation. Validate syntax with the provider's existing configuration validator; use no custom matcher or new test framework. On the implementation candidate, retain native annotated effective configuration and the real review's complete selected/ignored-file accounting, exact source coordinates, completion, failures and limits. Native absence, cooldown or spend refusal remains blocked evidence, with no automatic replay or paid usage. No public request or YAML application is performed by this planning card.

## Risks

A new YAML can replace omitted parent settings. Inheritance may stop early or append an explicit negative lock pattern; exclusions still win and global overrides take precedence. Feature-head versus base/config selection must be observed rather than inferred from repository ancestry. New-head processing may add configuration/provenance paths, so compare path identities rather than hard-code a count. One point assumes this narrow repository-only change and existing native verification; broader policy or access changes require separate scope review.
