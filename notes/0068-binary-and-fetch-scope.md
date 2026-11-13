# #0068 — four items, two of them already fixed on the open stack

The row lists four items from the skill report
`bioimage-io/skill-2026-11-13-bioengine-new-app-classical-nuclei-cpu`. **Two of the four, plus
the `HYPHA_WORKSPACE` flag added in a follow-up, are already fixed on branches that are open as
draft pull requests.** This branch adds the two that are not, and item 2's fix is not the one the
row asks for, for a reason measured here.

Branch: `docs/0068-binary-and-fetch-scope`, cut from `fe8c22e` (PR #146's head, the stack tip).

## Decided: stack, do not branch from main

Both files this row touches are already edited by the open stack, measured against
`origin/main` (`1d2b49d`):

```
docs/0334-skill-corrections       (a508a50)  SKILL.md +64   app_templates.md +76
docs/0344-0351-skill-corrections  (4eae7f6)  SKILL.md +89   app_templates.md +76
docs/0356-fieldinfo-claim         (fe8c22e)  SKILL.md +103  app_templates.md +76
```

A fifth parallel branch against `SKILL.md` and `references/app_templates.md` would be the fourth
tree editing both at once. Stacked on `fe8c22e` instead, which also means the two items below are
written against the text the stack will actually ship rather than against text it replaces.

Why: the alternative was to wait for the stack to land, and the stack is paused on myco #0055
with no merge date. Waiting would have parked two measured edits behind an unrelated clearance.

## Already fixed on the stack — no edit made here

Measured against `fe8c22e`, with the control `grep -c bioengine` → SKILL.md **110**,
`app_templates.md` **45** (so both instruments read their file).

| row item | state on the stack tip | which branch |
|---|---|---|
| item 1, `apps list` before the first upload | **fixed.** `SKILL.md:524-531`: the `apps list --json` check, *"if they are not yours, pick a different id, do not raise the number"*, and why `apps validate` is structurally unable to check an id against a workspace | `docs/0344-0351-skill-corrections` |
| item 3, a `health_check` example | **fixed, and further than asked.** `app_templates.md:99-110` has the hook beside a public `health()` `@bioengine.method`, both delegating to one undecorated `_check()`, plus the discarded-return-value trap. `health_check` in that file: **0** on `origin/main`, **2** on the tip | `docs/0334-skill-corrections` |
| the follow-up's `HYPHA_WORKSPACE` flag | **fixed.** `"workspace": os.environ["HYPHA_WORKSPACE"]` on a `connect_to_server` call: **1** on `origin/main`, **0** on all three stack branches. `SKILL.md:817` now derives the workspace from the worker service id and says why | `docs/0334-skill-corrections` |

One more, for the record: the follow-up says *"No such figure exists"* of the report's 5-15 min
`DEPLOYING` window. It exists, in `references/app_templates.md` rather than in `SKILL.md`, and the
second data point the report wanted is **already beside it** on the stack ("A classical-CV set
(scipy / scikit-image / tifffile / imagecodecs / Pillow) was measured reaching `HEALTHY` in roughly
25 seconds"). Nothing to add. The follow-up's conclusion — do not attach a pip-install figure to
the GPU scheduling sentence in `SKILL.md` — is right about `SKILL.md` and is not the whole picture.

## Item 2 — the row's own fix is wrong, and so is the correction to it

The row says to annotate a dual-format binary parameter `Any` rather than `bytes`, on the
reporter's account that `bytes` silently UTF-8-coerces an incoming base64 **string**. A follow-up
from the backlog head refuses that edit on the grounds that a measured binary-input recipe already
exists and prefers `bytes`, and reports the coercion reproduced:

```
pydantic 2.12.0
RESULT bytes-annot <- str : b'iVBORw0KGgo=' COERCED
```

**That reproduction is at the wrong layer.** `@bioengine.method` is `hypha_rpc`'s
`@schema_method(arbitrary_types_allowed=True)` (`bioengine/_app/decorators.py`, the docstring says
so), and `schema_method` does **not** run pydantic validation on arriving arguments. Three layers,
same container (`ghcr.io/aicell-lab/bioengine-worker:0.16.96`, `pydantic` 2.12.0,
`hypha_rpc` 0.21.40):

```
A. bare pydantic TypeAdapter(bytes)   <- base64 str  -> bytes   COERCED      <- the follow-up's layer
   bare pydantic TypeAdapter(bytes)   <- raw bytes   -> bytes   identical     [CONTROL]
B. @schema_method, bytes-annotated    <- base64 str  -> str     NOT coerced
   @schema_method, bytes-annotated    <- raw bytes   -> bytes   identical     [CONTROL]
C. @bioengine.method in @bioengine.app<- base64 str  -> str     NOT coerced
   @bioengine.method in @bioengine.app<- raw bytes   -> bytes   identical     [CONTROL]
```

And over a **real Hypha RPC boundary** — a service registered on `hypha.aicell.io` and called from
a second connection, which is the layer the documentation's reader actually hits:

```
connected in ws-user-github|49943582
registered  ws-user-github|49943582/WvLnKhVHLHqyS4d5Affr5f:bytesprobe-0068

bytes-annot <- raw bytes [CONTROL] -> {'type': 'bytes', 'len': 8, 'png_magic': True}
bytes-annot <- base64 str          -> {'type': 'str',  'len': 12,
                                       'bytes_call': "TypeError: string argument without an encoding"}
Any-annot   <- raw bytes [CONTROL] -> {'type': 'bytes', 'len': 8}
Any-annot   <- base64 str          -> {'type': 'str',  'len': 12}
```

The controls are what make this readable: raw bytes arrive as 8 bytes with the PNG magic intact on
both annotations, so the boundary is live and byte-exact. The base64 string arrives as a 12-character
`str` on both. **`Any` and `bytes` behave identically.** There is no coercion to warn about and
nothing for the annotation change to fix.

The absence of enforcement is general, not specific to `bytes`:

```
n: int   <- 'not a number'  -> accepted as str   'not a number'
n: int   <- '7'             -> accepted as str   '7'
n: int   <- 7  [CONTROL]    -> accepted as int   7
b: bytes <- 12345           -> accepted as int   12345
```

So the real gap is one the report did not name and neither row states: **a `@bioengine.method`
annotation is published schema, not a validator.** That is what an author needs to know, it is
what explains the misleading decoder error they hit, and it is what this branch documents.

Two things follow, and both are in the edit:

1. The documented normalisation line `raw = bytes(image_bytes)` is where a wrong format surfaces,
   and it surfaces clearly: `TypeError: string argument without an encoding`. An app that wants to
   accept both formats must branch on `isinstance(image_bytes, str)`.
2. Switching to `Any` is a net loss. Measured from `_bioengine_method_schemas` on the same probe:

   ```
   bytes-annotated : {'image_bytes': {'description': '...', 'format': 'binary', 'type': 'string'}}
   Any-annotated   : {'image_bytes': {'description': '...'}}
   ```

   Same runtime behaviour, less schema. A client generating a call or a form from the schema no
   longer learns the parameter is binary.

Edit landed at `references/app_templates.md:2881-2902`, as a block quote appended to the existing
§ Sending an uploaded image to the backend recipe. The recipe itself is **unchanged** — it keeps
`image_bytes: bytes` and keeps *"Base64 is not required"*.

## Item 4 — placement and scope, both halves

Two separate defects, measured on `fe8c22e` before the edit:

```
first occurrence of "raw HTTP"   : byte offset 1446-ish, the paragraph at :19
first 200 bytes                  : YAML frontmatter, name: and description:
```

and the `:19` paragraph's own wording scoped itself out of the file it is in: *"the linked
reference files"*, *"link below"*, *"for these links"*.

**Placement.** The instruction now opens the frontmatter `description:`, which is metadata a skill
index reproduces verbatim rather than summarises. Measured after the edit:

```
first "raw HTTP"              at byte offset  83
first "curl -sSL"             at byte offset  93
first "summarising fetch tool" at byte offset 118
first 200 bytes: '---\nname: bioengine\ndescription: Fetch THIS file and every reference it
                  links with raw HTTP (curl -sSL), never with a summarising fetch tool. ...'
```

**Scope.** The heading is now *"How to load this file and the reference files it links"*, and a
second paragraph says the rule covers `SKILL.md` itself and gives a check that does not depend on
having read the warning:

```
                     this branch   origin/main
lines                      1067           996
fence lines (any indent)    104            94      -> 52 blocks / 47 blocks
'bioengine apps deploy'       6             5
NEGATIVE CONTROL 'curl -sSLzzz'  0           -
```

The claim in the file is *"roughly a thousand lines and about fifty fenced code blocks"*, which
holds on this branch **and** on `origin/main`, so it does not become false if the stack lands in a
different order. A first draft said "1000+ lines and over a hundred fenced code blocks"; the first
half is false at 996 and the second counted fence *lines* rather than blocks, and both were
corrected after measuring. Recorded because a doc that fails its own self-check is worse than no
self-check.

Not done, and deliberately: re-advertising the skill as a `raw.githubusercontent.com` URL. The row
says that is a publishing decision and needs Nils. It is the stronger fix and it is not a file edit.

## Still unmet

Nothing here is deployed. The published copy at `https://bioimage.io/skills/bioengine/SKILL.md`
serves `origin/main`, so neither edit is readable by an agent until this branch and the three under
it merge. A fetch-and-grep of the served page, with a positive control, is the last check and it
cannot run yet.
