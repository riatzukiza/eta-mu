# Immutable preparation evidence

This candidate replaces personal EtaMu PR 3 without editing that PR, its published head, or its receipt history. The exact rejected published row is `published-invalid-receipt.edn`; the commit patches preserve the original changes and identities. Those archive files are provenance, not admitted Receipt River inputs.

The operator checked the global skill's fields but missed the child consumer's required `:repo`. The canonical `eta-mu.receipt-river.law.receipt/record-errors` returns `missing required key: repo` for that archived row. A fresh `domain.event/build-event` envelope with a valid payload is admitted. No validator or schema was weakened. The original native finding remains unresolved on the original published PR.

The current personal base is `084cd150b8d5b9848d026e9ef8717747964dcd6d`. Its root river has inherited invalid legacy records; this candidate preserves its entire byte prefix and does not claim whole-root-history validity. The replacement's owned receipt suffix is valid. Source SHA-256 comparisons and exact canonical results are archived alongside this note.

No merge, deployment, board transition, native approval, or completed review round is claimed. Fresh native qualification is required for the replacement head.

Original document-history source commit `a2f428afd7623dcd188d535512525ee521a5ba61` remains a Git ancestor through an ordinary personal-base merge. All three original `.ημ/receipts.edn` records are retained byte-exact; all four rows including the new envelope pass the actual child law. The storage implementation and tests match predecessor `d2487fad2a71d974b21d8cd71a81bfde8fc5e479` byte-for-byte. A fresh private NBB run passes 13 tests/97 assertions; prior compiled results remain explicitly predecessor preparation evidence.
