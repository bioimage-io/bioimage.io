#!/usr/bin/env python3
"""
upload_model.py — Upload a validated model package to the BioImage Model Zoo.

Usage:
    export HYPHA_TOKEN=...            # from `python hypha_login.py`
    python upload_model.py <package_dir>
    python upload_model.py <package_dir> --token <hypha_token>

What it does (and deliberately does NOT do):
  1. Loads the package's rdf.yaml as the manifest.
  2. Creates a STAGED artifact under bioimage-io/bioimage.io with status "draft".
     - Sets `id` / `id_emoji` from the generated alias in the manifest and in the
       uploaded rdf.yaml (the local file is not changed); the website editor
       rejects RDF edits until both match. Otherwise rdf.yaml is uploaded verbatim.
     - `status` is an app-level review field kept only in the Hypha manifest,
       never written into the RDF file (bioimageio.spec's ModelDescr is a closed
       schema and rejects unknown top-level fields).
     - Reviewers are granted `rw+` on the model FROM CREATION via config.permissions.
       create() writes config straight into the enforced base config while the
       artifact stays staged/versionless, so reviewers can edit the model at every
       review stage without anyone committing (or publishing) it. This is the ONE
       frontend/API-reachable moment to grant enforced perms without publishing:
       a later stage=False edit would mint a version (publish); a staged edit is
       silently unenforced.
  3. Uploads every file in the package. Anything at or above 16 MiB goes as a
     multipart upload, streamed from disk a part at a time, each part retried
     on its own with backoff and a timeout sized to the part.
  4. Does NOT commit and does NOT set status to in-review. The model stays a
     staged draft. Run `submit_for_review.py` when you're ready for curator review.

Prints the artifact id — you need it for submit_for_review.py.
"""
import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

SERVER_URL = "https://hypha.aicell.io"
PARENT_ID = "bioimage-io/bioimage.io"  # the main Zoo collection

# Permission codes that mark a collection member as a model-zoo reviewer.
# (`r` = public read, `@` = a list of specific readers — neither is a reviewer.)
REVIEWER_CODES = {"rw", "rw+", "*"}
REVIEWER_GRANT = "rw+"  # read/write, NOT delete — what each reviewer gets on the model

# File extensions that count as model weights (higher download weight = ranks
# higher in the popularity sort).
WEIGHT_EXTS = (".pt", ".pth", ".onnx", ".h5", ".pb", ".zip")

# --- Large-file upload -------------------------------------------------------
# A single PUT of a whole weights file is what made uploads fail: the request
# dies with SSLEOFError, stalls part way, or ends in httpx.ReadError, while small
# files to the same draft succeed. Anything at or above the threshold is sent as
# a multipart upload instead, one part at a time, each part retried on its own.
#
# PART_SIZE is 16 MiB: S3 requires at least 5 MiB for every part but the last,
# and allows at most 10,000 parts, so 16 MiB covers files up to 156 GiB while
# keeping a failed part cheap to resend.
MIN_PART_SIZE = 16 * 1024 * 1024         # the floor, used for everything normal
MULTIPART_THRESHOLD = MIN_PART_SIZE      # below this one PUT is simpler and fine
MAX_PARTS = 10_000                       # the server rejects more than this
S3_MIN_PART = 5 * 1024 * 1024            # S3's own floor for a non-final part

# Backwards-compatible name: the part size for an ordinary file.
PART_SIZE = MIN_PART_SIZE

# Parts go up CONCURRENTLY, because a foundation-model checkpoint is hundreds of
# parts and sending them one at a time makes a multi-gigabyte upload take as
# long as the sum of every round trip. Bounded, not unbounded: too many parallel
# PUTs on a domestic link is how you reproduce the stall this change is meant to
# fix, and each in-flight part also costs its own buffer in memory.
PART_CONCURRENCY = 4

# Retries apply per part, not per file, so a 5 GB upload does not restart
# because one part timed out. Transient network faults and 5xx are retried;
# a 4xx is a real refusal and is raised at once.
MAX_ATTEMPTS = 5
BACKOFF_BASE = 2.0                       # seconds: 2, 4, 8, 16

# Presigned part URLs expire. The default in the backend is one hour, which is
# not enough for a slow link and a multi-gigabyte package, so ask for longer and
# derive it from the actual size rather than hoping.
URL_EXPIRY_FLOOR = 3600
URL_EXPIRY_PER_GB = 3600


def find_id_emoji(collection_config: dict, model_type: str, short_id: str) -> str:
    """Emoji for a generated id like "naked-rabbit" (port of Upload.tsx findEmoji)."""
    category = {"model": "animal", "application": "object", "dataset": "fruit"}.get(model_type)
    id_parts = collection_config.get("id_parts") or {}
    nouns = id_parts.get(category) or []
    noun = short_id.split("-")[-1]
    return id_parts[f"{category}_emoji"][nouns.index(noun)] if noun in nouns else "🦒"


def set_rdf_ids(rdf_text: str, short_id: str, id_emoji: str) -> str:
    """Return rdf.yaml text with top-level `id` / `id_emoji` set, all other lines unchanged.

    A line edit, not a PyYAML load/dump: RDFs are YAML 1.2 and a PyYAML round
    trip silently rewrites some fields (timestamps, booleans, null forms).
    ponytail: assumes any existing top-level id / id_emoji is a one-line scalar.
    """
    lines = [
        line for line in rdf_text.splitlines(keepends=True)
        if not line.startswith(("id:", "id_emoji:"))
    ]
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += "\n"
    # JSON strings are valid YAML double-quoted scalars.
    lines.append(f"id: {json.dumps(short_id)}\n")
    lines.append(f"id_emoji: {json.dumps(id_emoji, ensure_ascii=False)}\n")
    return "".join(lines)


def _part_size_for(total_bytes: int) -> int:
    """Part size for a file, grown so the part count stays under the server's cap.

    At the 16 MiB floor the 10,000-part limit tops out at about 156 GiB, and a
    file past that used to fail outright. Rather than refuse, grow the part size
    just enough: the part count is what the server caps, not the part size.
    Rounded up to a MiB so the numbers stay readable in the log.
    """
    size = MIN_PART_SIZE
    if total_bytes > MIN_PART_SIZE * MAX_PARTS:
        needed = -(-total_bytes // MAX_PARTS)          # ceil division
        size = max(MIN_PART_SIZE, -(-needed // (1024 * 1024)) * 1024 * 1024)
    assert size >= S3_MIN_PART
    return size


def _expiry_for(total_bytes: int) -> int:
    """How long the presigned URLs must stay valid, from the size actually sent."""
    gigabytes = total_bytes / (1024 ** 3)
    return int(URL_EXPIRY_FLOOR + URL_EXPIRY_PER_GB * gigabytes)


def _timeout_for(part_bytes: int) -> "httpx.Timeout":
    """A timeout sized to the part, not a flat number.

    The old code used one 300 s timeout for the whole file, which is both too
    long for a 2 MB file and too short for a slow 5 GB one. Allow 60 s of
    connect/handshake plus 30 s per MiB, with a floor so tiny parts still get a
    sane window.
    """
    import httpx

    seconds = max(120.0, 30.0 * (part_bytes / (1024 * 1024)))
    return httpx.Timeout(connect=60.0, read=seconds, write=seconds, pool=60.0)


#: 4xx codes that ARE worth retrying, against the general rule below.
#: 408 is the server saying the request timed out, 429 is it saying to slow down.
#: Both are explicitly temporary, and a proxy in front of the object store can
#: emit either even when the store itself would have said 503.
RETRYABLE_4XX = frozenset({408, 429})


async def _put_with_retry(client, url: str, data: bytes, what: str) -> str:
    """PUT one body, retrying transient faults. Returns the response ETag.

    Retries a connection error, a timeout, any 5xx, and the two 4xx codes that
    mean "temporary" (see RETRYABLE_4XX). Every other 4xx is NOT retried: it
    means the request itself is wrong (expired URL, bad signature, refused by
    policy) and resending it only wastes the user's time.

    The timeout is set PER REQUEST from this body's size. It used to be set once
    on the client from the PART_SIZE constant, which meant every part ran under
    the same flat window no matter how big it was: fine at the usual 16 MiB, but
    a 525 MiB part on a slow link got the same 480 s, which is a 1.1 MB/s floor.
    That defeated the adaptive part sizing it was supposed to support.
    """
    import httpx

    last = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            resp = await client.put(url, content=data, headers={"Content-Type": ""},
                                    timeout=_timeout_for(len(data)))
            if resp.status_code >= 500 or resp.status_code in RETRYABLE_4XX:
                raise httpx.HTTPStatusError(
                    f"server error {resp.status_code}", request=resp.request, response=resp
                )
            resp.raise_for_status()
            etag = (resp.headers.get("ETag") or resp.headers.get("etag") or "").strip('"')
            return etag
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code if exc.response is not None else 0
            if code < 500 and code not in RETRYABLE_4XX:
                # Do NOT re-raise httpx's own error here. Its message embeds the full URL, and
                # these are presigned: the signature is in the query string, so a refused upload
                # would print a working credential into the contributor's terminal and into any
                # log or issue they paste it into. Report the part and the status instead, which
                # is also what they need to act on.
                raise RuntimeError(
                    f"{what}: upload refused with HTTP {code}; not retried, because a {code} "
                    f"means the request itself cannot succeed (an expired link, a bad signature "
                    f"or a permission problem). Re-run the upload to get fresh links."
                ) from None
            last = exc
        except (httpx.TransportError, httpx.TimeoutException) as exc:
            last = exc
        if attempt < MAX_ATTEMPTS:
            delay = BACKOFF_BASE ** attempt
            print(f"    {what}: attempt {attempt} failed ({type(last).__name__}); "
                  f"retrying in {delay:.0f}s")
            await asyncio.sleep(delay)
    raise RuntimeError(f"{what}: giving up after {MAX_ATTEMPTS} attempts: {last!r}")


async def _upload_single(client, am, artifact_id: str, rel_path: str,
                         data: bytes, weight: float) -> None:
    """Small file: one presigned PUT, still retried."""
    url = await am.put_file(artifact_id=artifact_id, file_path=rel_path,
                            download_weight=weight)
    await _put_with_retry(client, url, data, rel_path)


async def _upload_multipart(client, am, artifact_id: str, rel_path: str,
                            source, size: int, weight: float) -> None:
    """Large file: multipart upload, parts sent concurrently, each retried alone.

    `source` is either a Path to stream from disk, or bytes already in memory
    (the rewritten rdf.yaml). Reading per part matters: the old code called
    read_bytes() on the whole file, so an 85 MB weights file became an 85 MB
    buffer before a single byte moved. Here at most PART_CONCURRENCY parts are
    resident at once. That bound is PART_CONCURRENCY x the part size, so it is
    flat at 64 MiB for anything up to 156 GiB, and grows with the part size above
    that: about 420 MiB for a 1 TiB file and 2.1 GiB for a 5 TiB one. Still far
    below holding the whole file, which is what the single-PUT path did, but not
    constant, so it is stated rather than rounded off to "whatever the size".

    There is no abort call in the artifact service's API, only start and complete,
    so a multipart upload that fails partway cannot be torn down from here. The
    parts already sent stay until the draft itself is discarded or deleted. On a
    store that is short of space that is worth knowing, so discard a draft whose
    upload failed rather than retrying into the same one indefinitely.
    """
    part_size = _part_size_for(size)
    part_count = (size + part_size - 1) // part_size
    if part_count > MAX_PARTS:            # cannot happen via _part_size_for; a guard, not a path
        raise RuntimeError(
            f"{rel_path} is {size} bytes, which still needs {part_count} parts and the "
            f"server allows {MAX_PARTS}."
        )
    started = await am.put_file_start_multipart(
        artifact_id=artifact_id,
        file_path=rel_path,
        part_count=part_count,
        download_weight=weight,
        expires_in=_expiry_for(size),
    )
    upload_id = started["upload_id"]
    part_urls = {p["part_number"]: p["url"] for p in started["parts"]}
    # Check the server gave us a URL for every part BEFORE uploading any of them.
    # Without this, a short or renumbered list fails as a bare `KeyError: 4` partway
    # through, after several parts have already gone up, and a contributor has no way
    # to tell from that whether retrying is worth anything. The later
    # `len(results) != part_count` check cannot catch it: gather() propagates the
    # KeyError before that line is ever reached.
    missing = sorted(set(range(1, part_count + 1)) - set(part_urls))
    if missing:
        raise RuntimeError(
            f"{rel_path}: the server started a multipart upload but returned "
            f"{len(part_urls)} part URL(s) for {part_count} part(s); "
            f"missing part number(s) {missing[:10]}. Nothing was uploaded."
        )
    print(f"    multipart: {part_count} part(s) of up to {part_size // (1024*1024)} MiB, "
          f"{PART_CONCURRENCY} at a time")

    def read_part(number: int) -> bytes:
        offset = (number - 1) * part_size
        if isinstance(source, (bytes, bytearray)):
            return bytes(source)[offset:offset + part_size]
        with open(source, "rb") as handle:     # a handle per part: concurrent
            handle.seek(offset)                # readers must not share a cursor
            return handle.read(part_size)

    done = 0
    results: dict[int, str] = {}
    semaphore = asyncio.Semaphore(PART_CONCURRENCY)

    async def one(number: int) -> None:
        nonlocal done
        async with semaphore:
            chunk = await asyncio.get_event_loop().run_in_executor(None, read_part, number)
            etag = await _put_with_retry(
                client, part_urls[number], chunk,
                f"{rel_path} part {number}/{part_count}",
            )
            if not etag:
                raise RuntimeError(
                    f"{rel_path} part {number}: the server returned no ETag, so the "
                    f"upload cannot be completed."
                )
            results[number] = etag
            done += 1
            if part_count <= 8 or done % 10 == 0 or done == part_count:
                print(f"    {done}/{part_count} parts uploaded")

    # Cancel the siblings when one part gives up, and WAIT for them before raising.
    # A plain gather() propagates the first error but leaves the other parts running,
    # so they keep PUTting into a client that is already closing. What the contributor
    # then sees is the real error buried under a ReadError from an unrelated part, and
    # a backoff message printed after the script has already decided to stop.
    tasks = [asyncio.ensure_future(one(n)) for n in range(1, part_count + 1)]
    try:
        await asyncio.gather(*tasks)
    except BaseException:
        for task in tasks:
            if not task.done():
                task.cancel()
        # Swallow the cancellations only: the original exception is re-raised below.
        await asyncio.gather(*tasks, return_exceptions=True)
        raise

    if len(results) != part_count:
        raise RuntimeError(
            f"{rel_path}: {len(results)} of {part_count} parts returned an ETag; "
            f"refusing to complete a partial upload."
        )
    parts = [{"part_number": n, "etag": results[n]} for n in sorted(results)]
    await am.put_file_complete_multipart(
        artifact_id=artifact_id, upload_id=upload_id, parts=parts
    )


def build_reviewer_permissions(collection_config: dict) -> dict:
    """Reviewer ids from the collection, each granted rw+ on the new model.

    Never downgrades anyone already at `*` (they're skipped; create() gives the
    uploader `*` automatically). Returns a plain {user_id: code} dict.
    """
    perms: dict[str, str] = {}
    for uid, code in (collection_config.get("permissions") or {}).items():
        # Codes can be non-string (the `@` key maps to a list of reader ids);
        # those are never reviewers. Guard the type before the set membership
        # test (matches roles.ts `typeof code === 'string'`).
        if isinstance(code, str) and code in REVIEWER_CODES and code != "*":
            perms[uid] = REVIEWER_GRANT
    return perms


async def _upload_file(client, am, artifact_id: str, rel_path: str,
                       source, weight: float) -> int:
    """Upload one file by whichever path suits its size. Returns the size in bytes.

    `source` is a Path to stream from disk, or bytes already in memory. This is the only
    place that decides between the single-request and the multipart path, so callers, and
    the re-upload snippet documented in SKILL.md, cannot drift away from the script.
    """
    size = len(source) if isinstance(source, (bytes, bytearray)) else source.stat().st_size
    if size >= MULTIPART_THRESHOLD:
        await _upload_multipart(client, am, artifact_id, rel_path, source, size, weight)
    else:
        data = source if isinstance(source, (bytes, bytearray)) else source.read_bytes()
        await _upload_single(client, am, artifact_id, rel_path, data, weight)
    return size


async def upload_model(package_dir: str, token: str) -> str:
    package = Path(package_dir).resolve()
    rdf_path = package / "rdf.yaml"
    if not rdf_path.exists():
        raise FileNotFoundError(f"rdf.yaml not found in {package}")

    import yaml  # pip install pyyaml
    with open(rdf_path) as f:
        manifest = yaml.safe_load(f)

    name = manifest.get("name", "unnamed-model")
    model_type = manifest.get("type", "model")
    print(f"Uploading: {name} (type={model_type})")

    # alias pattern is type-specific (matches the website's Upload.tsx logic).
    alias_pattern = {
        "model": "{animal_adjective}-{animal}",
        "dataset": "{fruit_adjective}-{fruit}",
        "application": "{object_adjective}-{object}",
    }.get(model_type, "{object_adjective}-{object}")

    import httpx
    from hypha_rpc import connect_to_server

    async with connect_to_server({
        "server_url": SERVER_URL,
        "token": token,
        "method_timeout": 120,
    }) as server:
        am = await server.get_service("public/artifact-manager")

        # Read the collection to resolve the reviewer set for the permission grant.
        collection = await am.read(artifact_id=PARENT_ID)
        reviewer_permissions = build_reviewer_permissions(collection.get("config") or {})
        permissions = dict(reviewer_permissions)
        # Grant the uploader's ACCOUNT, by email, at `rd+` and nothing more.
        #
        # Why a grant is needed at all: `create()` gives `*` to the id of the
        # token that made the call, and a token minted by `generate_token` has
        # its own random id that expires with it. Without a second key the
        # account loses all access to its own submission once that token is
        # gone, typically after 12 hours.
        #
        # Why the email and not the account id: permission checks match on the
        # email, and the email is what survives the account changing how it
        # signs in.
        #
        # Why `rd+` and not `*`: `rd+` expands to read, get_file, get_status,
        # list, list_files, edit, put_file, remove_file, discard_changes and
        # draft. It does NOT include `commit`, `detach` or `mutate`. So the
        # uploader can keep working on their submission but cannot publish it
        # themselves, which is what keeps the curator review in the path. A `*`
        # grant here would let any contributor commit their own model and skip
        # review entirely.
        user = server.config.get("user") or {}
        email = user.get("email")
        if email:
            permissions[email] = "rd+"

        artifact = await am.create(
            parent_id=PARENT_ID,
            alias=alias_pattern,
            type=model_type,
            manifest={**manifest, "status": "draft"},  # app-level manifest only
            config={"permissions": permissions},
            stage=True,           # staged = not publicly visible; awaits curator review
            overwrite=False,
        )
        artifact_id = artifact["id"]
        print(f"Created staged artifact: {artifact_id}")
        print(f"  granted rw+ to {len(reviewer_permissions)} reviewer(s)")

        # The alias is only known now, so set id / id_emoji after create(), in both
        # the manifest and the uploaded rdf.yaml, as Upload.tsx does. The editor
        # (Edit.tsx validateRdfContent) rejects any RDF edit until both match.
        short_id = artifact_id.split("/")[-1]
        id_emoji = find_id_emoji(collection.get("config") or {}, model_type, short_id)
        await am.edit(
            artifact_id=artifact_id,
            manifest={**manifest, "id": short_id, "id_emoji": id_emoji, "status": "draft"},
            stage=True,
        )
        rdf_bytes = set_rdf_ids(rdf_path.read_text(encoding="utf-8"), short_id, id_emoji).encode("utf-8")
        print(f"  id: {short_id}  id_emoji: {id_emoji}")

        # Upload every file in the package (skip build junk).
        files = [
            f for f in package.rglob("*")
            if f.is_file() and "__pycache__" not in f.parts
        ]
        async with httpx.AsyncClient(timeout=_timeout_for(PART_SIZE)) as client:
            for file_path in files:
                rel_path = str(file_path.relative_to(package))
                weight = 1 if rel_path.endswith(WEIGHT_EXTS) else 0
                is_rdf = file_path == rdf_path
                size = len(rdf_bytes) if is_rdf else file_path.stat().st_size
                megabytes = size / (1024 * 1024)

                if size >= MULTIPART_THRESHOLD:
                    print(f"  uploading {rel_path} ({megabytes:.1f} MiB)")
                await _upload_file(
                    client, am, artifact_id, rel_path,
                    rdf_bytes if is_rdf else file_path, weight,
                )
                print(f"  uploaded {rel_path} ({megabytes:.1f} MiB)")

        # NO commit: the model stays a staged draft for curator review.
        staging_url = f"https://bioimage.io/#/upload?artifact_id={artifact_id}&stage=true"
        print("\nUpload complete (staged draft, not yet submitted for review).")
        print(f"Artifact ID: {artifact_id}")
        # Same caveat as submit_for_review.py: this reopens the upload form on the
        # draft, it is not a preview of a published model page.
        print(f"Resume editing: {staging_url}")
        print(f"\nNext: python submit_for_review.py {artifact_id}")
        return artifact_id


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload a model package to the BioImage Model Zoo.")
    parser.add_argument("package_dir", help="Path to the validated model package directory")
    parser.add_argument(
        "--token",
        default=os.environ.get("HYPHA_TOKEN"),
        help="Hypha token (default: $HYPHA_TOKEN). Get one with hypha_login.py.",
    )
    args = parser.parse_args()
    if not args.token:
        print("No Hypha token. Set $HYPHA_TOKEN (run hypha_login.py) or pass --token.", file=sys.stderr)
        sys.exit(1)
    asyncio.run(upload_model(args.package_dir, args.token))


if __name__ == "__main__":
    main()
