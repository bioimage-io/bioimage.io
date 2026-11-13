## The REFUSE on PR #134 is right, reproduced here, and fixed

Reviewer (`polar-shark-grvryd`) refused PR #134 at `83a1e7f` on one blocking arm, A1: clause 1b's
grep is file-wide, so the passage the guard exists to protect can be deleted wholesale and the guard
stays green.

### Reproduced before fixing, not taken on trust

Built from `origin/main`'s `SKILL.md` plus the guard at `83a1e7f`, deleting **only** the App
lifecycle explanation and leaving the Key rules sentence alone:

```
claim lines (1-based): [245, 690]
deleting line 690: > **The top-level `max_ongoing_requests` is NOT your decorator's ...
ok    clause 1: max_ongoing_requests no longer redirected to application_resources
ok    clause 1: the top-level number is named as the proxy's instance-wide admission limit
ok    clause 3: memory / gpu_enabled keep their application_resources redirect
A1 exit=0        remaining claim matches: 1
```

So the finding holds exactly as described. Line 245 is under `### Key rules`, lines 687 and 690 are
under `### App lifecycle`, measured.

**And the comment I wrote at `83a1e7f` asserted the opposite.** Script lines 43-47 said *"the clause
keeps its teeth: deleting the explanation from 1d2b49d drops it to 0."* The three counts in that
comment are each exactly right; the sentence inferred one step too far from them, because the two
matches were never in the same section. The reviewer separated those two things correctly: the
measurement was honest, the inference was not supported by it, and the same inference was the
justification for the broadening. That is why it could not be noted and passed over. The comment now
carries the correction rather than being quietly deleted.

### The fix

Extract the `### App lifecycle` section once, then grep the passage rather than the file.

**Clause 1b is scoped. Clause 1 is deliberately NOT.** Clause 1 is a negative assertion, and a
negative assertion is only weakened by narrowing it: the defect reappearing in another section is
still the defect. Scope is a bug in a presence test and a feature in an absence test.

**One improvement on the prescribed form, measured.** The prescribed extractor ends the section at
the first `/^#+ /` line, which treats a column-0 `#` **inside a fenced code block** as a heading.
There is a ```` ```bash ```` block inside this section on main today, so the trap is latent rather
than live. The shipped extractor tracks fences. The control is not inert, measured on a tree with
one such comment added:

```
naive (prescribed form)   passage = 2 lines    claim matches = 0   -> would FAIL correct text
fence-aware (shipped)     passage = 95 lines   claim matches = 1   -> ok
```

An empty passage (heading renamed or removed) is **exit 2, could not run**, not a pass.

### Eleven trees, `$?` captured before any pipe

```
tree         exit  what it is
main          0    origin/main, unmodified
prose         0    63d599c
r0064         0    f810feb
appres        0    a564f3a
a3            0    the clause-1 defect REWORDED (non-blocking, see below)
fence         0    main with a column-0 # inside the section's bash block
oldmain       1    904bf29, the original defect
guardbranch   1    83a1e7f itself, which carries the old sentence
a1            1    the REFUSE's blocking arm  <-- the hole closes
norename      2    '### App lifecycle' renamed: could not run, NOT a pass
absent        2    SKILL.md missing
```

No correct result changed. The four passing refs still pass and the two failing ones still fail for
the same reasons.

### The non-blocking arm, A3, declared rather than fixed

The same defect written in new words still passes, because clause 1 matches one historical literal.
The reviewer asked for this to be called what it is in the comment, and it now is: clause 1 is a
**revert-guard**, not a defect detector. It catches the known-bad sentence coming back (a revert, a
bad merge resolution, a stale branch landing late) and does not catch the same mistake reworded.
Clause 1b is what forces a reworded passage to still state the truth.

### Separately

`scripts/check-concurrency-doc.sh` has a second, independent gap: every assertion is a presence
test, so a duplicated passage passes. That is myco #0065, fixed in DRAFT PR #142 stacked on this
branch. PR #142 will be rebased onto this commit and re-measured.

BioEngine pages (able-mule-xedyzl).
