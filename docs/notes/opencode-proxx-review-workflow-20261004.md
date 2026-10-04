# Reuse the hosted OpenCode reviewer with Proxx

SPDX-License-Identifier: GPL-3.0-or-later

## Intended first slice

The operator clarified that Proxx is intended for Pi or OpenCode, not Codex CLI.
The first slice therefore configures the existing hosted OpenCode review
workflow to consume Proxx through supported provider/configuration data.
Proxx's existing EDN policy remains responsible for provider selection, routing,
fallback and configured cost policy. Pi is a compatible alternative to inventory
after identifying its existing configuration seam. Native Codex execution and
the GitHub connector support investigation remain separate options.

The reusable eta-mu workflow at
`084cd150b8d5b9848d026e9ef8717747964dcd6d` already checks out the immutable PR
head, stages complete `basehead.diff`, independently verifies input, runs the
bounded OpenCode reviewer and retains a complete frozen submission. Muse already
provides the OpenCode review profile, assessment tools and deterministic
publisher. Reuse that path. This proposal adds configuration and a bounded
qualification, without a new worker, daemon, adapter, policy interpreter,
serializer or review engine.

## Existing path and ownership

```text
existing eligible PR workflow
  -> existing bounded OpenCode reviewer + Muse tools
  -> supported OpenCode provider configuration
  -> existing Proxx gateway
  -> existing EDN routing and permitted fallback
  -> retained complete review evidence
```

| Owner | Responsibility |
| --- | --- |
| Eta-mu | Configure its existing reusable OpenCode workflow, pin sources, preserve exact input and truthful terminal evidence. |
| Proxx | Existing gateway transport and EDN provider/routing/fallback/cost policy. The workflow consumes its decisions. |
| Services | Existing deployment environment overrides and policy mounts where required; distinguish intended data from data loaded by the deployed runtime. |
| Muse | Existing bounded OpenCode profile, review contracts/tools and publisher. |
| Canonical `pr-flow` | Authenticated reviewer identity, evidence admission, planning/review convergence and merge requirements. |

Select the supported OpenCode provider configuration and gateway API surface from
current compatibility evidence. Do not assume a Responses-only path or invent
new configuration fields. Inventory Pi's current provider configuration as a
possible later alternative, without adding a second execution path in this
slice. Native Codex has no Proxx integration in this proposal.

Use the current Proxx EDN policy or reviewed configuration changes that the
existing runtime supports. This plan introduces neither an OpenAI-only lane nor
a blanket prohibition on fallback. Permitted fallback remains governed by EDN;
the qualification records the requested model and the route/model actually
observed, including fallback when it occurs. Unavailable or denied execution
stays visible. Do not implement those decisions in GitHub YAML or add a policy
interpreter to eta-mu.

Qualification names the exact Proxx runtime, policy revision, supported fields
and Services loading/mount configuration. A healthy gateway or an on-disk EDN
file does not prove that a candidate deployment consumes it. If the current
runtime lacks a necessary supported configuration seam, record that precise gap
and re-scope separately instead of adding an adapter to this epic.

## Input and producer evidence

Preserve the existing non-draft same-repository eligibility, exact checkout,
clean-tree checks, full-input verification, complete Muse assessment, bounded
recovery, frozen submission and retained attempts. PR content cannot select
gateway credentials, provider configuration or executable machinery. Use trusted
workflow/context sources and keep gateway-client authentication outside model
tools and untrusted PR execution.

Evidence must distinguish OpenCode as executor, Proxx as gateway, the requested
model/policy and any observable routed provider/model. Record exact source and
runtime versions, native run identity, input/assessment/submission digests and
terminal outcome using existing artifact structures. Missing upstream identity
remains unknown; a configuration label is not proof of actual provider identity.

The existing publisher authenticates with the eta-mu GitHub App. Canonical
`pr-flow` currently associates `eta-mu-ai[bot]` with MiMo and native Codex with
`chatgpt-codex-connector[bot]`. Changing OpenCode's provider configuration does
not automatically admit a different producer or make its result native Codex
approval. Preserve the existing trusted MiMo channel only when its actual
provider identity remains valid. If a chosen route changes that identity or
leaves it unverified, qualification retains the result as clearly labelled
OpenCode/Proxx evidence and must not emit an approving review that the current
gate would misclassify. Any cohort/approval admission change is separately
reviewed in canonical policy.

The existing publisher binds its review to the event head without refreshing
the live PR head immediately before publication. Keep stale results tied to
their reviewed SHA; never represent them as current-head approval. A newly
enabled publication mode must demonstrate its current-head behavior rather than
silently expanding this configuration task into another publisher implementation.

## Small reuse tasks and qualification

1. Inventory the existing OpenCode configuration seam, Pi alternative and actual
   producer evidence. Reuse existing input/output contracts; create no new schema
   or serialization protocol. Estimate: 1 point.
2. Select current Proxx EDN configuration and confirm what the deployed runtime
   loads through Services. Keep the existing supported routing/fallback policy;
   do not invent extra provider or cost restrictions. Estimate: 1 point.
3. Configure the existing hosted OpenCode workflow using that supported data and
   gateway authentication surface. Preserve its bounded review profile and
   complete evidence path. Estimate: 2 points.
4. Qualify a pinned hosted canary: a clean control, a source-supported defect,
   full input beyond the preview and truthful unavailable/incomplete/stale
   outcomes. Record routing/fallback as observed. Estimate: 2 points.

The epic is 6 points, contingent on current configuration-capability findings.
Tests should exercise the configuration that is actually consumed and the
existing review boundaries, not introduce another engine or mirror a document.
No model call or activation occurs in this planning change.

## Qualified configuration proposal

The current hosted runner pins OpenCode `1.18.18`. Its existing `model` input
already reaches `opencode run --agent github-reviewer --model ...`. The missing
seam is forwarding optional provider configuration and the gateway URL/bearer
into that same process. OpenCode supports `OPENCODE_CONFIG_CONTENT`, merged after
the installed global and project configurations. A provider-only fragment
preserves the pinned Muse tools and reviewer rather than replacing their config.

For a GPT review through the existing gateway, this is the native OpenCode data:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "proxx": {
      "npm": "@ai-sdk/openai",
      "name": "Proxx",
      "options": {
        "baseURL": "{env:PROXX_BASE_URL}",
        "apiKey": "{env:PROXX_API_KEY}"
      },
      "models": {
        "gpt-6.1-sol": {
          "name": "GPT-6.1 Sol",
          "reasoning": true,
          "tool_call": true,
          "limit": {"context": 1050000, "input": 922000, "output": 128000}
        }
      }
    }
  }
}
```

The caller selects `model: proxx/gpt-6.1-sol`. `proxx` is an OpenCode client
provider ID; the actual model sent to the gateway is `gpt-6.1-sol`. It does not
create a Proxx upstream provider or override Proxx's EDN routing. The metadata
above was inspected in Models.dev on October 4; recheck the selected model's
metadata during implementation qualification.

The proposed additions to the existing reusable workflow are configuration data:

```yaml
# workflow_call inputs, alongside the existing model input
opencode_config_content:
  description: Optional provider configuration merged into the pinned OpenCode review profile.
  required: false
  type: string
  default: ""
proxx_base_url:
  description: Existing Proxx API root, including /v1.
  required: false
  type: string
  default: ""

# workflow_call secrets
PROXX_API_KEY:
  required: false

# additional env on the existing bounded OpenCode invocation
OPENCODE_CONFIG_CONTENT: ${{ inputs.opencode_config_content || '' }}
PROXX_BASE_URL: ${{ inputs.proxx_base_url || '' }}
PROXX_API_KEY: ${{ secrets.PROXX_API_KEY }}
```

The API root ends in `/v1`. OpenCode's bundled `@ai-sdk/openai` adapter uses
Responses; `@ai-sdk/openai-compatible` uses Chat Completions. Choose the adapter
that matches the selected model and the existing gateway surface. The hosted
pin bundles those adapters at `3.0.84` and `2.0.41` respectively. The locally
installed OpenCode is `1.18.34`, so local registration alone cannot qualify the
hosted pin. Do not print resolved OpenCode configuration: environment
substitution can include the gateway bearer.

A configuration-only probe ran the example with OpenCode `1.18.18` in isolated
XDG directories, a non-routable gateway URL and a placeholder credential.
`opencode models proxx` exited zero and listed `proxx/gpt-6.1-sol`. This verifies
registration under the hosted pin; it is not a gateway conversation or hosted
review. The retained local probe is
`/tmp/opencode-proxx-config-20261004-6YvYMY/result.json`.

Muse also already supports EDN `:settings` fragments containing `:provider` data,
deep-merged into its emitted OpenCode JSON. This is an existing authoring option;
the integration does not require adding provider interpretation to Muse.
Proxx policy remains in its own existing EDN tree in either authoring path.

At Proxx source `88471efd7f8cd27f64fc733a1c31369f00a6d432`, the normal GPT provider
preference is Vivgrid, OpenAI, Requesty, OpenRouter, Factory and Blaze, subject to
eligibility and tenant policy. No new EDN clause is required to connect this
client. Record the actual route rather than infer OpenAI execution from the
requested GPT model. The Services compose declaration requires the CLJS policy
runtime and authoritative policy mode; it currently uses the bundled policy
tree rather than a deployment-mounted alternate manifest.

Upstream Pi coding agent separately supports an equivalent `models.json`
provider declaration with `baseUrl`, `api: "openai-responses"`, an environment
API-key reference and a model ID. There is no inventoried hosted Pi review
pipeline here. The current shell's `pi` resolves to eta-mu's CLI alias, so select
and pin the intended upstream Pi distribution before claiming a Pi canary.

## Bootstrap and activation

Normal planning review proceeds under unchanged canonical `pr-flow`. There is
no bootstrap waiver: unavailable optional reviewers remain unavailable, other
valid reviewers can satisfy the rules when permitted, and an unmet mandatory
requirement remains a blocker. Native Codex support work does not change those
requirements or this transport's identity.

Provider credentials remain behind Proxx. An existing admitted gateway-client
credential and reviewed deployment loading are activation prerequisites; this
proposal creates no secrets, changes no permissions and performs no deployment.
It does not admit a new approval cohort or authorize spending or automatic merge.

The five new cards are hand-authored Markdown, a supported entry point. No
status transition has been performed. A source Rheos CLI probe could not run
under the available NBB because `malli.core` was unavailable, so this planning
packet does not claim Rheos board validation.

## References

- [Epic](../../kanban/epics/opencode-proxx-review-workflow.md), UUID
  `5b6d71a4-d0d6-429a-ab25-e96677bc9dd0`.
- Existing workflow: `.github/workflows/opencode-code-review.yml`.
- Existing recovery and fixtures: `.github/scripts/run-opencode-review-recovery.mjs`,
  `.github/scripts/opencode-code-review-workflow.test.mjs`.
- Muse: `.ημ/config/opencode/agents/github-reviewer.md`,
  `.ημ/plugins/review_pipeline.cljs`, `src/cljs/eta_mu/domain/review.cljc`.
- Services: `digitalocean/hosts/production.yaml`,
  `digitalocean/services/proxx/compose.yaml`, `.github/workflows/deploy-stack.yml`.
- [OpenCode custom providers](https://opencode.ai/docs/providers/#custom-provider)
  and [configuration precedence/substitution](https://opencode.ai/docs/config/).
- [Pinned OpenCode inline configuration loader](https://github.com/anomalyco/opencode/blob/v1.18.18/packages/opencode/src/config/config.ts#L433)
  and [model registration](https://github.com/anomalyco/opencode/blob/v1.18.18/packages/opencode/src/provider/provider.ts#L1334).
- [AI SDK OpenAI adapter](https://ai-sdk.dev/providers/ai-sdk-providers/openai)
  and [Models.dev metadata](https://models.dev/api.json).
- [Pinned Muse settings projection](https://github.com/octave-commons/muse/blob/0b9a91492c8355e6933dc2164d35668cb76d9e60/src/clj/eta_mu/opencode/build.clj#L173).
- [Current Proxx GPT routing](https://github.com/open-hax/proxx/blob/88471efd7f8cd27f64fc733a1c31369f00a6d432/resources/policies/runtime/30-model-routing.edn#L75)
  and [provider preferences](https://github.com/open-hax/proxx/blob/88471efd7f8cd27f64fc733a1c31369f00a6d432/resources/policies/runtime/20-provider-capabilities.edn).
- [Upstream Pi compatible endpoint configuration](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md#configure-a-compatible-endpoint).
