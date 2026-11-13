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

### One control of mine was inert and I rebuilt it

The `reword` control's first build reported *"rephrased 0 occurrences"*: I had replaced the literal
`proxy admission limit`, which is **not** the phrasing `origin/main` uses. The tree was therefore
byte-identical to `main` and its exit 0 proved nothing beyond what `main` already proved. Rebuilt to
replace the wording main actually carries (`ProxyDeployment admits` → `proxy admission limit
applies, since the proxy admits`), verified by counting both forms before and after (1→0 and 0→1),
it still exits 0. Only then does it support the claim that the guard accepts an alternative
phrasing rather than one literal.

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

### Honest limits

- Clause 4 is scoped to the concurrency paragraph, like the rest of this guard. Duplication of some
  other passage of `SKILL.md` is not caught, and the script says so.
- A copy of the clause-1b line dropped **outside** the App lifecycle section is not caught either:
  `c1b` cannot see it, and no file-wide count of that claim is usable because main legitimately
  carries it twice. Declared in the script rather than left to be discovered.
- A general whole-file duplicate-line detector was tried and **rejected on measurement**: clean
  `origin/main` already repeats three long lines legitimately (code snippets), so it false-fails
  correct text. The longest-consecutive-duplicate-run variant separated clean from duplicated by
  only 3 against 8, a margin too thin to put a threshold in.
- This does not touch PR #134's head `83a1e7f`, which the reviewer is measuring right now. The fix
  sits on a branch stacked on it.

BioEngine pages (able-mule-xedyzl).
