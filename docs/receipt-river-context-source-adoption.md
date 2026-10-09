# Qualified Receipt River context consumption

This receiver consumes the owning Receipt River source from personal
[PR1](https://github.com/riatzukiza/receipt-river/pull/1), merge
`5eeb77e035c17160416d0a092415b39b3de55133`, whose tree equals reviewed
`67f43c2fd210c6bf48aa89090f2f863d56ef04de`.

Exactly three production inputs are consumed without local semantic edits:
`api.cljs`, `infra/cli.cljs`, and portable `law/receipt.cljc` replacing the old
`.cljs` file. The source identities and byte hashes are in the
[actual GREEN packet](../.ημ/review-evidence/receiver-receipt-context/GREEN-20261009.json).
All other library source bytes and existing workspace/classpath policy remain.
Standalone source owns validation law; this integration does not create a
receiver-specific receipt parser or exception.

## Actual consumer evidence

The regression invokes the existing compiled `receipt-handler`, actual local
Git root discovery, file reads and owning validator from a nested disposable
checkout. Its original receipt prefix is taken from the existing ledger and
refuses drift from320957bytes/SHA256
`9e9929aed4c42265f6ff24bf655576dfe10729c3aeb3b4270fe68d8142e8d6ff`.
No duplicate320k fixture is added. The default200 window selects59-258.
Original256-258 remain unversioned maps with no persisted repo field; the
reader supplies a resolved checkout string and exposes separately derived
attribution, preserving rawline, event, ordinal and context-free diagnostics.
The declared-envelope, explicit nil-repo, missing-owner and nil-schema controls
exercise the same route and retain strict refusals.

RED `b7ff8067e99ba39fbce3752167aa24e053fb5b46` ran195tests668assertions:
20 context-gap failures,0errors/0compilerwarnings. The unchanged old released
CLI independently rejected256-258. After exact source adoption, the same full
suite passes195/668 and workflow tests6/78, with lint0errors0warnings and
required extern-boundary PASS. The new released CLI independently stops
reporting the three missing-repo failures in both the frozen fixture and the
actual current checkout.

The journal still returns exit1 with34 other historical failures, including
invalid EDN, other missing fields, unknownkind and invalid timestamps. Those
rows and original corrections remain unchanged. No whole-journal PASS, corrected
copy folding, schema retrofit or historical rewrite is claimed. The old source
finding is addressed by the qualified owning context path; current-head hosted
CI/review/merge remain separate gates.

## Character design relationship

This is an existing reviewer prerequisite for the selected physical-field
boundary. It does not implement or complete encounter persistence, physical
field computation, the separate persisted mood model or automatic graph recall.
The cephalon goal remains active and the scheduled heartbeat remains paused.

SPDX-License-Identifier: GPL-3.0-or-later
