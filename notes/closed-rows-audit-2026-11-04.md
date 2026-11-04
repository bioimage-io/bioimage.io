# Audit: the seven closed rows a reviewer flagged as "closed without evidence"

2026-11-04. A review of this session's loop held verification, on the finding that seven closed
issues (#0021, #0023, #0024, #0029, #0030, #0031, #0039) carry no recorded evidence on the close
and fail the close gate, and concluded that "the loop closed issues without recording verifiable
evidence".

**The closes are legitimate. The diagnosis does not hold.** Six of the seven are automated test
exhaust with synthetic identifiers, and the seventh is a duplicate retirement whose record had
already been corrected on the row itself. None of them is real work that was closed without
evidence, and none was closed by the issue-working loop.

## The measurement that settles it

How long each row was open, computed from the store's own `created` and `closed` fields:

| row | open for | what it is |
|---|---|---|
| #0021 | 2.5 s | seeded exhaust, #0015 end-to-end test |
| #0023 | 2.6 s | seeded exhaust, #0015 end-to-end test (same text as #0021) |
| #0024 | 7.1 s | self-declared scratch for the #0022 regression check |
| #0029 | 2.3 s | seeded exhaust, `scripts/test_sweep_filing.py` |
| #0030 | 2.5 s | seeded exhaust, `scripts/test_sweep_filing.py` |
| #0031 | 2.8 s | seeded exhaust, `scripts/test_sweep_filing.py` |
| #0039 | 1779.4 s | duplicate of #0041, retired in favour of it |

Six rows were open between 2.3 and 7.1 seconds. Nothing can be investigated, fixed or verified in
2.5 seconds, so "closed without recording evidence" is the wrong frame: there was never any work
to evidence. The short lifetime is the signature, and it is what distinguishes a test fixture from
a real finding that was waved through.

## What each one actually says, in its own close note

- **#0021 / #0023** — "Seeded test exhaust from the #0015 end-to-end test. The ids are
  synthetic." Both name the fixture artifact `test-report-seeded-phantom-0015` for a model
  `seeded-phantom-0015`. Both were closed from paused with a stated reason under the
  close-from-paused rule (#1205).
- **#0029 / #0030 / #0031** — "Seeded test exhaust from `scripts/test_sweep_filing.py` (myco
  #0007). The artifact ids are synthetic and do not exist in the collection." They name
  `bioimage-io/seeded-test-artifact-0007` and `bioimage-io/seeded-test-model-nostatus-0007`. The
  script is real and present: `scripts/test_sweep_filing.py`, 6,027 bytes.
- **#0024** — body reads, in full, "Transient. Filed by the #0022 regression check to prove a
  finding is NOT lost when the target session does not resolve. Closed immediately." It is a
  deliberate artifact of a test that proves the filing path does not silently drop findings.
- **#0039** — the three-layer prompt rollout, retired as a duplicate of #0041.

Three duplicate pairs/triples among them (#0021 with #0023, and #0029 with #0030 with #0031) are
themselves expected: a watcher's escalation latch is keyed on the page's subject slug, so a
re-worded page orphans the latch and the same condition files a fresh row instead of commenting on
the old one. That is bookkeeping, not three separate faults.

## The `CLOSED WITH NOTHING RUN` banner is not the gap

Several of these carry it, and it reads like an indictment. It is not. The tool prints it so that
a sweep can find an assertion-only close without parsing prose (#0429), and it states in the same
breath that this is allowed, because "a backlog that cannot discharge duplicates and obsolete
items seizes up". A duplicate retirement has nothing re-runnable by construction. Demanding
executed evidence on one is demanding evidence that cannot exist.

The test for these closes is therefore not "did something run" but "is the condition still
tracked somewhere". For the six fixtures there is no condition, because the ids are synthetic. For
#0039 the condition is tracked on #0041, which is paused and carries both of #0039's gates.

## One real error, and it is mine

**#0041 is a duplicate I created, of a row that already existed.** #0039 was filed at
17:31:26.371Z and #0041 at 17:41:36.677Z, so #0039 predates it by ten minutes. I filed #0041
while triaging #0038 without first checking whether the charter rollout was already on the board.

The cause is specific and worth not repeating: `myco issue add` blocks on lexical duplicate
candidates and prints them, and I passed `--anyway` in the same invocation, which suppressed the
prompt before I had read what it would have flagged. `--anyway` is for confirming a candidate is
genuinely different *after* looking at it, not a flag to pass pre-emptively. It correctly stopped
me on #0040 only because I had not yet learned to add it by default.

The outcome is nonetheless correct and does not need unwinding: #0041 is the live card, it is
paused on both of #0039's gates, and it additionally frames the question on Nils's
more-conservative caveat for bioimage.io. #0039's own close note originally had the duplicate
direction backwards and has already been corrected on the row. Which id carries the decision
changes nothing a human acts on, so reopening to swap them would churn two cards to reach the
same single paused question.

## What remains genuinely open

Nothing about these seven. The backlog's real state is unchanged: eight rows on `quick-river` are
done and committed but cannot close while the branch holds commits `main` has never seen, and that
merge needs Nils. The reviewer's third point agrees, and it is the only open item.
