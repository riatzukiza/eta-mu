---
uuid: "feb08585-b123-4a22-9fb4-f7790f393ef1"
title: "Discover credential-free MiMo through native OpenCode for B3 review (provisional)"
status: incoming
points: 5
priority: P1
labels: tasks, planning, provisional, opencode, mimo, review, cephalon, b3
---

## Context

(汝, p=1.0) **Provisional incoming planning card only.** The human authorizes a
narrow repair of model rotation and credential-free workflow selection for the
**B3 cephalon character-memory reviewer prerequisite**. This card's `incoming`
status is initial hand-authored content; it records no transition, readiness,
implementation qualification, or B3 completion. Implementation must wait for
native planning qualification and lawful Rheos readiness.

(汝, p=1.0) The operating contract is genuine OpenCode CLI inference: the fast
free MiMo offering is available out of the box through that CLI, requires **no
user credentials**, and uses IP-based rate limiting. Discover the current
offering; a particular version slug is not permanent policy. IP-based limiting
is human-supplied context, not a load-test result.

(己, p=1.0) The coordinator freshly fetched and selected the exact personal-main
baseline `b03cb58407cc333b7cabd77431842d44f0deb415`. Its workflow defaults to
`opencode/mimo-v2.6-flash-free`, CLI `1.18.18`, and Muse
`0b9a91492c8355e6933dc2164d35668cb76d9e60`. The workflow stages its runner and
reviewer from revision-bound machinery; the observed actual invocation is
`opencode run --format json --agent github-reviewer --model REVIEW_MODEL prompt`.
The pinned Muse reviewer also names the fixed model slug, and no explicit
workflow `small_model` binding was observed. These are baseline observations,
not future model or runtime selections.

(世, p=0.99) The existing
[discovery evidence](../../.ημ/review-evidence/free-mimo-native-route/discovery-20261012.json)
records command-output transcriptions with these limits:

- CLI `1.19.0`, built-in `build`, no user credentials or external plugins:
  exit 0, answer `OK`, zero tool events.
- CLI `1.19.0`, reviewer permission frontmatter retained, tiny diagnostic system
  prompt substituted, `--pure`/no external plugin, no user credentials:
  exit 0, answer `OK`, zero tool events. The full reviewer system prompt was not
  retained. This succeeds as a native transport probe.
- The earlier restricted `plan` plus all-deny experiment returned 403. Agent
  and permission configuration both changed; no sole cause was established.
- Muse run `38270669716` attempt 1 at
  `361d4c3b61b04559451e0836bccc62a1e3332294` returned HTTP 401,
  `Upstream request failed: Invalid credential`. A forwarded upstream 401
  establishes neither a missing user key nor a workflow defect or a specific
  upstream provider.

(己, p=1.0) The coordinator's actual native read observes Muse run `38270669716`
attempt 2 is genuinely `in_progress` on the same `361d4c3b...` head. No terminal
result is assigned to that attempt. Both successful tiny canaries have zero
review credit; full restricted review and trusted publication remain unproved.

(己, p=1.0) Neighboring context was read from
[the original MiMo reviewer card](opencode-mimo-evidence-review-agent.md) and
[the prior review/catalog repair card](restore-evidence-review-model-and-catalog-build.md).
Their historical fixed versions do not define the current selector contract.

Primary official references for later qualification:

- [OpenCode models and selection precedence](https://opencode.ai/docs/models/).
- [OpenCode CLI model discovery and run flags](https://opencode.ai/docs/cli/#models):
  catalog refresh and verbose cost metadata; confirm the qualified runtime's
  actual command/output contract before relying on it.
- [OpenCode server API: provider/catalog and configuration shapes](https://opencode.ai/docs/server/#provider).
  This is a metadata-contract reference.
- [OpenCode model and small-model configuration](https://opencode.ai/docs/config/#models)
  and [custom agent model configuration](https://opencode.ai/docs/agents/#model).

## Outcome

Select the current available fast free MiMo from the genuine OpenCode catalog,
admit it deterministically before inference, and bind that exact selection to
every model path used by the credential-free `github-reviewer` workflow.
Retain enough immutable per-attempt evidence to explain both selections and
refusals after a model rename or replacement.

The provisional estimate is **5 points** for catalog/admission contracts,
effective configuration binding, and local plus hosted verification of that
narrow change. Implementation follows native planning qualification and lawful readiness.

## Scope

- Discover and specify the native CLI catalog, cost, capability, availability,
  freshness, and ranking shapes. Reuse existing contracts where suitable;
  implement pure selection/admission and normalization in portable `.cljc`.
  Keep raw native CLI/process I/O in a thin `extern.*` boundary and use an NBB
  orchestration adapter if its capabilities suffice. Follow the checkout's
  Discovery → Describe → specify → define → shape → extern → domain → infra
  construction order when implementation becomes ready.
- Discover candidate(s) from current **MiMo family, fast offering, and free
  metadata**. Qualify every declared price, tools/chat capability, and current
  availability. Define a documented latest-choice ordering using authoritative
  release/current-offering metadata. Preserve exact IDs as observations and
  attempt bindings rather than permanent discovery constants.
- Bind the selected ID to main/default, `small_model`, title generation, and
  the custom `github-reviewer` model. Whitelist the genuine OpenCode provider
  and the selected model. Account for configuration precedence and the pinned
  Muse agent's model field while preserving its prompt, tool exposure, and
  permission restrictions.
- Reuse existing exact-head, full-input verification, recovery, trusted
  publication, and required terminal gates. Change only the selection and
  model-binding seam needed for rotation; preserve the current reviewer and
  publisher contracts.
- After source qualification, propagate the qualified immutable workflow and
  any necessary qualified Muse selection pin to **only the two human-authorized
  PERSONAL consumer repositories**. Identify their exact owner/repository
  identities before pin edits. Organization consumers require a separate
  promotion. Each personal consumer must supply its own current-head evidence.

## Non-goals

- Character implementation, cephalon runtime/mood/graph changes, or deployment.
- Diagnosing or repairing the forwarded 401, changing retry/transport policy,
  rebuilding reviewer permissions, or repairing unrelated Muse/plugin behavior.
- User inference credentials, OpenRouter/API secrets, direct HTTP inference,
  client spoofing, or provisioning inference authentication.
- Paid/provider fallback, silent model escape, weakening reviewer tools or
  permissions, or waiving input, review, quota/ceiling, publication, or terminal
  gates. Existing GitHub App publication credentials remain their own trusted
  boundary and are not inference credentials.
- Implementing an alternate Rheos board parser, validator, writer, or workflow.
  This planning PR carries initial Markdown, bounded evidence and append-only
  receipts/reflection. It performs no existing-card transition, workflow/code
  implementation, runtime mutation or credential provisioning.

## Acceptance criteria

- [ ] **Planning/readiness:** the native planning review qualifies this bounded
  scope and the owning Rheos process lawfully admits implementation. Delegate
  scoped discovery, RED fixtures, and implementation to native subagents under
  the checkout's delegation rule. No readiness or native approval is inferred
  from this card's initial status or a tiny canary.
- [ ] **Native credential-free route:** inference uses the genuine OpenCode CLI
  with `--agent github-reviewer`; user keys, login, credential copying, or a
  directly called inference endpoint are unnecessary. Preserve visible native
  rate-limit/transport failures and existing bounds.
- [ ] **Catalog admission:** obtain a fresh, successfully refreshed native
  catalog in the qualified runtime and validate its shape. Candidate membership
  uses supported MiMo/fast/free metadata. Verify tools and chat support,
  availability, and **every declared cost dimension equals numeric zero**,
  including input, output, cache, and any tiered/conditional prices. Missing
  required price information, null/unknown values, malformed metadata, or any
  nonzero declared cost cannot count as free.
- [ ] **Latest deterministic choice:** zero eligible candidates visibly refuses;
  one eligible candidate selects its exact ID; multiple eligible candidates
  select a unique latest offering only when validated metadata establishes the
  ordering. Sorting a version/name string, assuming a permanent slug, relying
  on catalog iteration order, or inventing a release date is inadmissible.
  Tied, missing, or incomparable ranking metadata visibly refuses.
- [ ] **Failure before inference:** unavailable/stale catalogs or models,
  refresh failure, malformed input, unknown pricing, ambiguous ranking, and
  effective-config mismatch produce explicit diagnostic failure before any
  inference, including small/title requests. No stale-success substitution,
  paid/provider fallback, default-provider escape, or automatic credential
  request occurs.
- [ ] **One effective model:** main/default, small/title, CLI model selection,
  and custom `github-reviewer` all resolve to the same admitted free ID.
  Provider/model whitelists exclude every other inference route. Prove merged
  effective configuration, including Muse frontmatter and hidden title-agent
  overrides, without weakening any review tool/permission restriction or
  substituting a diagnostic prompt for the actual reviewer.
- [ ] **Per-attempt provenance:** retain exact observed provider/model ID,
  actual CLI/runtime identity and version, raw catalog SHA-256 and observation/
  refresh time, eligible candidate metadata and ordering decision, effective
  configuration identity, source/Muse revisions, and admission/refusal outcome.
  Bind recovery attempts to their exact selection evidence; retain prior
  attempts when a refreshed catalog produces a new selection. No silent
  replacement under the same attempt identity.
- [ ] **Review gates:** preserve independent expected/executed/completion-head
  checks, complete immutable input and assessment coverage, bounded recovery,
  structured submission validation, trusted publication, and required terminal
  results. Missing review evidence or a non-success terminal result remains
  visible and blocks qualification.
- [ ] **Mandatory GREEN and propagation:** obtain the actual local no-auth
  restricted reviewer canary and later exact-head hosted structured full-review
  and publication evidence described below. Qualify source before updating
  either personal consumer pin; record consumer qualification separately.

## Verification

**RED — deterministic fixtures, after readiness and before implementation:**

- Rename and version replacement: change eligible model IDs and release/current
  metadata; the same selector follows the unique latest available free offering.
- Zero, one, and multiple eligible candidates; order-independent results; unique
  latest versus tied, missing, or incomparable ranking metadata.
- Stale or unavailable candidates/catalogs, refresh failure, malformed metadata,
  missing/unknown prices, and nonfree input/output/cache/conditional costs.
- Missing tools/chat support; mismatched main/default, small/title, CLI, or custom
  agent model; paid hidden title override and provider/model whitelist escape.
- Every refusal proves that inference was not launched. Paid/provider fallback
  and stale-catalog escape fixtures stay refused; preserve the existing review
  gate regressions. These tests exercise selection/admission, not a new board
  implementation or a diagnosis of the historical 401/403.

**GREEN — qualified local integration:**

- Pass the same fixtures through portable `.cljc` decisions and the actual
  native CLI adapter. Run relevant existing suites and required lint/type checks
  with zero warnings; retain exact failures or unavailable checks.
- Run an actual **credential-free restricted `github-reviewer` canary** on the
  selected offering with the real reviewer prompt and its qualified compiled
  context/tool exposure. Prove the effective main/small/title/agent bindings,
  permitted read-only review behavior, and retained permission restrictions.
  Record runtime, catalog/selection provenance, structured output, and exits.
  The already successful CLI `1.19.0` diagnostic probes are transport evidence;
  they do not satisfy this full reviewer integration requirement. A canary is
  not native review approval or permission to publish/merge.

**GREEN — later hosted qualification, mandatory:**

- For the exact candidate source head, retain the immutable workflow/Muse/runtime
  and catalog selection, expected/executed/completion SHAs, full-input hashes,
  complete structured assessment and submission, recovery attempt artifacts,
  actual trusted publication evidence, and successful required terminal gates.
  Then qualify each of the two authorized personal consumers on its exact head.
  A successful tiny response, diagnostic prompt, retained log, forwarded 401,
  running job, or historical approval cannot substitute for these results.
- Observe Muse `38270669716` attempt 2's eventual native terminal evidence before
  making a claim about that attempt. Its currently observed `in_progress` state
  grants no completion, defect, or approval credit.

## Risks

- Catalogs may lack authoritative fast/current/release metadata, complete costs,
  or a reliable availability/freshness signal. Treat that as an explicit native
  qualification gap and refuse before inference; do not guess from a slug or
  substitute another provider.
- IP-based limits, model rotation, and upstream transport failures can interrupt
  a correctly configured native route. Preserve the failure and existing bounds;
  the forwarded 401 alone supplies no workflow-defect diagnosis.
- OpenCode defaults, hidden title-agent choices, and compiled Muse frontmatter
  may override model bindings. Effective configuration and attempt evidence are
  required even when the top-level CLI argument appears correct.
- The discovery artifact contains observed transcriptions, not fresh catalog
  ranking/hash evidence or complete reviewer/publication qualification. The
  tiny permission-frontmatter success used a diagnostic prompt with no plugin
  or tool events. These limitations keep the plan provisional.
- The coordinator delegated this initial card draft through its native subagent
  tool and reviewed the returned prose. That draft is planning preparation, not
  an independent hosted review, qualified implementation or board transition.
