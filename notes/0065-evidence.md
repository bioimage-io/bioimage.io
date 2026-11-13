## #0065 evidence: the guard now counts the guarded passage, and the count discriminates

### The defect, re-measured first-hand before fixing it

Backlog head carried this forward as my testimony rather than its own measurement, so I re-measured
it at the guard's current head `83a1e7f` rather than citing the earlier run. Four trees, each a copy
of `origin/main`'s `SKILL.md` plus the unfixed guard, `$?` captured before any pipe:

```
origin/main, unmodified                 exit 0   1 copy
guarded blockquote duplicated verbatim  exit 0   2 copies   <-- the defect
SKILL.md absent                         exit 2             could-not-run path works
proxy statement stripped                exit 1             the clause still has teeth
```

The last line is what makes the second meaningful: without it, the duplicate's exit 0 could have
been a guard inert for any reason at all. The duplication was the 28-line blockquote run carrying
both the clause-1b and the clause-3 anchors, inserted a second time after itself, which is what a
both-sides resolution of two branches editing that paragraph produces.

### What the fix counts, and what it deliberately does not

Clause 3's existing `grep -qi` becomes a count, and a new clause 4 fails when that count exceeds 1.

**Counted on clause 3's own anchor, not on a new pattern.** This adds no brittleness clause 3 does
not already carry: if a reword breaks that match, clause 3 fails today regardless. The anchor is
stable at exactly **1** across every ref this paragraph has lived on, measured rather than assumed:

```
904bf29  1     1d2b49d  1     origin/main  1     63d599c  1
f810feb  1     a564f3a  1     83a1e7f  1          duplicated tree  2
```

**NOT counted on clause 1b's claim**, which was my own first instinct when filing the row and is
wrong. That alternation legitimately matches **twice** on `origin/main` (the line-245 bullet and the
line-690 blockquote make the same point in different places) and **once** on `63d599c`, so no fixed
count is correct for it. Filing the row I wrote "count the claim"; measuring it is what caught that.

A `c3` of zero is reported by clause 4 as *cannot count* and fails, rather than being allowed to
read as "not duplicated" — a count of zero is a pass for the wrong reason.

### The fixed guard, measured over nine trees

```
tree      exit   what it is
main       0     origin/main, unmodified
prose      0     63d599c, #0058's prose branch
r0064      0     f810feb, #0064's branch
appres     0     a564f3a, #0062's branch
reword     0     main with clause 1b's wording REPLACED by another accepted phrasing
oldmain    1     904bf29, the pre-fix defect
dup        1     main with the guarded blockquote duplicated   <-- the new clause firing
noproxy    1     main with the proxy statement stripped
absent     2     SKILL.md missing: could not run, NOT a pass
```

`dup`'s output shows the other three assertions still green, which is the whole point:

```
ok    clause 1: max_ongoing_requests no longer redirected to application_resources
ok    clause 1: the top-level number is named as the proxy's instance-wide admission limit
ok    clause 3: memory / gpu_enabled keep their application_resources redirect
FAIL  clause 4: the guarded passage appears 2 times -- a merge resolution duplicated it
```

### The `reword` control took three builds, and only the third tests what it claims

Build 1 reported *"rephrased 0 occurrences"*: I had replaced the literal `proxy admission limit`,
which is **not** the phrasing `origin/main` uses. The tree was therefore byte-identical to `main`
and its exit 0 proved nothing beyond what `main` already proved.

Build 2 replaced the wording main does carry (`ProxyDeployment admits`) and exited 0. The reviewer
was right that this is still not a test of the claim. Clause 1b is an alternation of five
phrasings, and the single line inside the guarded passage that matches it (line 690) carries
**three of them at once**: `ProxyDeployment admits across the whole instance` matches
`ProxyDeployment admits` *and* `admits across the whole instance`, and `a proxy admitting the
default 10` matches `proxy admit(s|ting)`. Replacing one branch leaves the others matching on the
same line, so exit 0 showed only that the alternation still fired, not that a new phrasing is
accepted.

Build 3, measured on a scratch copy of clean `origin/main` with guard md5
`429b3138b5c3c9f76c7f870795c7cb58`. Line 690 is rewritten so every phrasing main carries is gone
from the passage and the only phrasing left is the one main does **not** carry. Counts inside the
guarded passage. That is lines **651..745, 95 lines**, not 650..745: line 650 is the `### App
lifecycle` heading itself and the extractor does not emit it. Immaterial to every count below,
corrected because a reader reproducing this would otherwise diff one line against mine.

| phrasing | clean main | after rewrite |
|---|---|---|
| `ProxyDeployment admits` | 1 | 0 |
| `proxy admitting` | 1 | 0 |
| `admits across the whole instance` | 1 | 0 |
| `proxy admits` | 0 | 0 |
| `proxy admission limit` | 0 | 1 |

(`proxy admits` is outside the passage clause 1b reads, on line 245 of both trees. State that
carefully, because it is the exact distinction this whole branch turns on: line 245 is **1 line
carrying 2 occurrences**, not "1" unqualified. `grep -c` reads 1 and `grep -o | wc -l` reads 2,
and a note that explains the line-vs-occurrence split while writing an unqualified count in its
own margin would mislead whoever reproduces it. Raised by the reviewer.) The guard exits **0**
on that tree, so it does accept a phrasing it has never seen. Paired negative control, same tree: strip the explanation off line 690 altogether and
it exits **1**, failing clause 1 and clause 4, so the pass is not vacuous.

### Rebased onto PR #134's new head, and re-measured there

PR #134's head moved from `83a1e7f` to `25014fb` when the reviewer's REFUSE was answered: clause 1b
is now scoped to the `### App lifecycle` passage instead of grepping the whole file. This branch was
rebased onto that commit. The rebase was clean, but a clean rebase is not a measurement, so the
whole matrix was re-run on the combined script, now with the two trees the base commit added:

```
tree      exit   what it is
main       0     origin/main, unmodified
prose      0     63d599c
r0064      0     f810feb
appres     0     a564f3a
reword     0     clause 1b's wording replaced by another accepted phrasing
fence      0     a column-0 '#' inside the section's bash block
oldmain    1     904bf29, the pre-fix defect
dup        1     the guarded blockquote duplicated        <-- this row's clause
noproxy    1     the proxy statement stripped everywhere
a1         1     ONLY the App lifecycle explanation deleted  <-- the base's fix
norename   2     '### App lifecycle' renamed: could not run, NOT a pass
absent     2     SKILL.md missing
```

The two fixes compose rather than shadowing each other: `a1` is caught by the base's scoping and
`dup` by this row's count, and all six correct trees stay green.

**Clause 4 counts file-wide, deliberately differing from clause 1b's new passage scope.** A
both-sides merge resolution can put the second copy anywhere, including outside the section, which
is exactly what a passage-scoped count would wave through. Each clause takes the scope its own
question needs, and the script now says so.

One mechanism in that argument is worth stating outright, because the framing above would lead a
reader to expect both arms to fire together and on the hardest tree they do not. Duplicate the
**whole** App lifecycle passage and the file then carries **two `### App lifecycle` headings**. The
extractor stops at the next heading, so it still emits **95 lines** and `c1b` still reads **1**:
the in-passage arm sees nothing wrong. Only the file-wide `c3` arm fires, and the guard exits 1 on
its strength alone. Measured on that tree: 2 headings, 95 lines emitted, `c1b` 1, exit 1. That is
the asymmetry doing the work on the one tree that most needs it, not an incidental difference, and
it is why a passage-scoped `c3` would have been a hole rather than a tidier design. Raised by the
reviewer.

### The residual Backlog head found on the draft, reproduced 4/4 and closed

Counting only clause 3's anchor was half a fix, and the half it missed is the one that matters most.
The guarded passage is **two different lines** of one blockquote: line 688 of main carries clause
3's `application_resources` redirect, line 690 carries clause 1b's proxy explanation. My `dup`
control duplicated the whole contiguous blockquote run (lines 665 to 692), which contains both, so
it fired and hid the gap. Duplicating line 690 alone does not.

Reproduced on the served file (`md5 e5663e3b…`, matching the head's) against this branch's own
earlier head `03cd296`, 4/4 agreeing with the head's matrix:

```
served unmutated      rc=0        line 688 duplicated   rc=1
line 690 deleted      rc=1        line 690 duplicated   rc=0   <- the residual
```

The second cost is the message. On the `dup690` tree the old clause printed *"the guarded passage
appears exactly once"*, which a reader who has just read clause 1b takes to mean line 690, and about
line 690 it was false. That is the same over-claiming shape the reviewer refused PR #134 for.

**Fixed by counting both anchors, each at the scope its own anchor supports.** The asymmetry is not
a compromise, it is the measurement:

```
ref           claim in passage   claim file-wide   clause-3 anchor file-wide
904bf29              0                 0                      1
1d2b49d              1                 2                      1
origin/main          1                 2                      1
63d599c              1                 1                      1
f810feb              1                 2                      1
a564f3a              1                 2                      1
83a1e7f              0                 0                      1
25014fb              0                 0                      1
```

Clause 3's anchor is unique file-wide on all eight refs, so counting it file-wide is sound and
catches a copy a merge drops outside the section. The clause-1b claim is legitimately 2 file-wide on
main, so no file-wide count of it is correct; inside the App lifecycle passage it is exactly 1
wherever the fix is present and 0 where it is not. Each arm now also names which line it counted.

After the fix:

```
served unmutated      rc=0        line 688 duplicated   rc=1
line 690 deleted      rc=1        line 690 duplicated   rc=1   <- closed
```

and the twelve-tree matrix above re-runs **identically**, so no correct result changed.

**The row's acceptance criterion was wrong and has been corrected**, rather than left to collide
with the implementation. Clause 3 of it demanded the count be over the claim alternation and *not*
over one literal phrasing. Measured, that is wrong in one direction and incomplete in the other: the
alternation is uncountable file-wide, the literal is measurably unique file-wide, and the right
check is that each count carries the scope its own anchor supports and that the script says which.
Left as written, the first reviewer to check clause 3 against the code would have refused a correct
fix.

### Both arms now name their own scope, not just their own line

The reviewer's remaining point was about what someone reading *output* rather than source can
learn. Each arm already named which line it counted, but only one named over **what**: the clause-1b
arm said "of the App lifecycle passage" while the clause-3 arm said only "on exactly one line". The
two arms are deliberately scoped differently, and that difference is the argument this row rests on,
so output that states it once and omits it once teaches the reader the wrong half. A reader would
carry clause 1b's passage scope straight onto the clause-3 line and read a file-wide result as a
passage-scoped one.

Both arms now say it, on the pass path and the fail path:

```
FAIL  clause 4: the application_resources redirect (clause 3's line) appears on 2 lines of
      public/skills/bioengine/SKILL.md -- a merge resolution duplicated it
ok    clause 4: the proxy-admission explanation appears on exactly one line of the App lifecycle
      passage (counted in-passage; main carries it twice file-wide, so a file-wide count of it is
      not usable)
```

That is the real `duppassage` output, and it is the tree where the distinction matters: one arm
reports file-wide and fails, the other reports in-passage and passes, and now the output says which
is which instead of leaving a reader to assume they agree.

**Strings only, and measured as such.** `git diff` over the script shows no changed line that is not
a comment or an `echo`, and the thirteen-tree matrix was re-run against the committed script and the
edited one side by side. Every exit code is identical, including the five green trees:

```
tree         HEAD   new        tree         HEAD   new
main           0     0         dup            1     1
prose          0     0         noproxy        1     1
r0064          0     0         a1             1     1
appres         0     0         norename       2     2
reword         0     0         absent         2     2
fence          0     0         duppassage     1     1
oldmain        1     1
```

### Honest limits

- Clause 4 is scoped to the concurrency paragraph, like the rest of this guard. Duplication of some
  other passage of `SKILL.md` is not caught, and the script says so.
- A copy of the clause-1b line dropped **outside** the App lifecycle section is not caught either:
  `c1b` cannot see it, and no file-wide count of that claim is usable because main legitimately
  carries it twice. Declared in the script rather than left to be discovered.
- A general whole-file duplicate-line detector was tried and **rejected on measurement**: clean
  `origin/main` already repeats three long lines legitimately (code snippets), so it false-fails
  correct text. A longest-consecutive-duplicate-run variant was measured next, defined as the
  longest run of consecutive non-blank lines each of which occurs more than once in the file, with
  blank lines resetting the run. An earlier draft of this note reported it separating clean from
  duplicated by "3 against 8". **That number does not reproduce and is withdrawn.** Re-measured on
  `origin/main`, `8b2c3ab`, `645ef16` and the working tree, all four agree:

  | tree | longest run |
  |---|---|
  | clean | 4 |
  | line 688 duplicated | 4 |
  | line 690 duplicated | 4 |
  | whole App lifecycle passage duplicated | 41 |

  The rejection stands, and for a stronger reason than a thin margin: on the single-line
  duplications the longest run is **identical to clean**, so no threshold on it can catch the case
  this guard exists to catch. Only the whole-passage duplication separates, and clause 4 already
  counts that directly.
- This does not touch PR #134's head `83a1e7f`, which the reviewer is measuring right now. The fix
  sits on a branch stacked on it.

BioEngine pages (able-mule-xedyzl).
