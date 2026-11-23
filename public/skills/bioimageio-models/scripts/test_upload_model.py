#!/usr/bin/env python3
"""Tests for upload_model.py's large-file upload path (GitHub issue #162).

Run: python3 -I test_upload_model.py

The defect being fixed: every file was sent as ONE PUT of the whole body held
in memory, so an 85 MB weights file died with SSLEOFError or stalled part way
while small files to the same draft succeeded.

Every assertion here is paired with a control wherever a control can differ, so
a check that stopped discriminating shows up as a failure rather than a pass.
"""

from __future__ import annotations

import asyncio
import sys
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# httpx is imported at module scope by upload_model; provide the pieces used.
if "httpx" not in sys.modules:
    httpx = types.ModuleType("httpx")

    class _Timeout:
        def __init__(self, connect=None, read=None, write=None, pool=None):
            self.connect, self.read, self.write, self.pool = connect, read, write, pool

    class _TransportError(Exception):
        pass

    class _TimeoutException(Exception):
        pass

    class _HTTPStatusError(Exception):
        def __init__(self, msg, request=None, response=None):
            super().__init__(msg)
            self.request, self.response = request, response

    httpx.Timeout = _Timeout
    httpx.TransportError = _TransportError
    httpx.TimeoutException = _TimeoutException
    httpx.HTTPStatusError = _HTTPStatusError
    httpx.AsyncClient = object
    sys.modules["httpx"] = httpx
if "hypha_rpc" not in sys.modules:
    m = types.ModuleType("hypha_rpc")
    m.connect_to_server = lambda *a, **k: None
    sys.modules["hypha_rpc"] = m
if "yaml" not in sys.modules:
    y = types.ModuleType("yaml")
    y.safe_load = lambda *a, **k: {}
    sys.modules["yaml"] = y

import httpx  # noqa: E402
import upload_model as um  # noqa: E402

PASS, FAIL = [], []


def chk(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'ok  ' if cond else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


class Resp:
    def __init__(self, status=200, etag='"abc"'):
        self.status_code = status
        self.headers = {"ETag": etag} if etag else {}
        self.request = None

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(f"status {self.status_code}",
                                        request=None, response=self)


class FakeClient:
    """Records every PUT body so a test can assert how the file was split."""

    def __init__(self, script=None):
        self.puts = []          # (url, length)
        self.script = list(script or [])
        self.timeout = None
        # Every per-request timeout seen, so a test can assert the timeout is
        # APPLIED and not merely computed. The double used to reject the kwarg
        # outright, which is why a flat client-wide timeout went unnoticed.
        self.put_timeouts = []

    async def put(self, url, content=None, headers=None, timeout=None):
        self.puts.append((url, len(content)))
        self.put_timeouts.append(timeout)
        if self.script:
            nxt = self.script.pop(0)
            if isinstance(nxt, Exception):
                raise nxt
            return nxt
        return Resp()


class FakeAM:
    def __init__(self):
        self.started = []
        self.completed = []
        self.single = []

    async def put_file(self, artifact_id, file_path, download_weight=0):
        self.single.append(file_path)
        return f"https://s3.invalid/{file_path}"

    async def put_file_start_multipart(self, artifact_id, file_path, part_count,
                                       download_weight=0, expires_in=None):
        self.started.append({"file_path": file_path, "part_count": part_count,
                             "expires_in": expires_in})
        return {"upload_id": "upl-1",
                "parts": [{"part_number": i, "url": f"https://s3.invalid/p{i}"}
                          for i in range(1, part_count + 1)]}

    async def put_file_complete_multipart(self, artifact_id, upload_id, parts):
        self.completed.append({"upload_id": upload_id, "parts": parts})
        return {"success": True}


run = asyncio.get_event_loop().run_until_complete

print("\n[1] a large file is split into parts, streamed from disk")
import tempfile  # noqa: E402

with tempfile.TemporaryDirectory() as td:
    big = Path(td) / "weights.pt"
    size = um.PART_SIZE * 2 + 1234          # two full parts and a remainder
    big.write_bytes(b"x" * size)
    cl, am = FakeClient(), FakeAM()
    run(um._upload_multipart(cl, am, "a/b", "weights.pt", big, size, 1))
    chk("start_multipart asked for the right part count",
        am.started and am.started[0]["part_count"] == 3, f"{am.started}")
    chk("one PUT per part", len(cl.puts) == 3, f"{len(cl.puts)} puts")
    # Order-independent on purpose: parts go up concurrently, so the ORDER in
    # which the client saw them is not meaningful. What must hold is the
    # multiset of sizes, two full parts and one short remainder.
    chk("the part sizes are two full parts and one remainder",
        sorted(n for _, n in cl.puts) == sorted([um.PART_SIZE, um.PART_SIZE, 1234]),
        f"{sorted(n for _, n in cl.puts)}")
    chk("CONTROL no part exceeds the part size",
        all(n <= um.PART_SIZE for _, n in cl.puts))
    chk("every byte was sent exactly once", sum(n for _, n in cl.puts) == size)
    chk("complete was called with one etag per part",
        am.completed and [p["part_number"] for p in am.completed[0]["parts"]] == [1, 2, 3],
        f"{am.completed}")
    chk("CONTROL no single-PUT path was used", am.single == [], f"{am.single}")
    chk("the URL expiry is larger than the one-hour default",
        am.started[0]["expires_in"] >= um.URL_EXPIRY_FLOOR, f"{am.started[0]['expires_in']}")

print("\n[2] the threshold: small files still take the simple path")
chk("MULTIPART_THRESHOLD is a real size", um.MULTIPART_THRESHOLD >= 5 * 1024 * 1024,
    f"{um.MULTIPART_THRESHOLD}")
cl, am = FakeClient(), FakeAM()
run(um._upload_single(cl, am, "a/b", "small.txt", b"hello", 0))
chk("a small file uses put_file, not multipart", am.single == ["small.txt"] and not am.started)
chk("and sends exactly one PUT", len(cl.puts) == 1)

print("\n[3] retries: a transient fault does not lose the upload")
cl = FakeClient(script=[httpx.TransportError("reset"),
                        httpx.TimeoutException("stalled"),
                        Resp(500, etag=None),
                        Resp(200, '"good"')])
um.BACKOFF_BASE = 1.0001          # keep the test fast; the logic is unchanged
etag = run(um._put_with_retry(cl, "https://s3.invalid/p1", b"body", "part 1/1"))
chk("it retried through three faults and succeeded", etag == "good", etag)
chk("it really did send four requests", len(cl.puts) == 4, f"{len(cl.puts)}")

cl = FakeClient(script=[httpx.TransportError("x")] * um.MAX_ATTEMPTS)
try:
    run(um._put_with_retry(cl, "u", b"b", "part"))
    chk("CONTROL it gives up after MAX_ATTEMPTS", False, "no exception raised")
except RuntimeError as exc:
    chk("CONTROL it gives up after MAX_ATTEMPTS", "giving up" in str(exc))
    chk("and did not retry forever", len(cl.puts) == um.MAX_ATTEMPTS, f"{len(cl.puts)}")

print("\n[4] a 4xx is NOT retried, because resending cannot help")
cl = FakeClient(script=[Resp(403, etag=None)])
try:
    run(um._put_with_retry(cl, "u", b"b", "part"))
    chk("a 403 raises at once", False, "no exception")
except RuntimeError as exc:
    # RuntimeError, not httpx's HTTPStatusError: the raise is deliberately re-wrapped so the
    # message cannot carry the presigned URL. See case [16].
    chk("a 403 raises at once", "403" in str(exc), str(exc)[:60])
    chk("CONTROL and was attempted only once", len(cl.puts) == 1, f"{len(cl.puts)}")

print("\n[5] a missing ETag is caught, not silently completed")
with tempfile.TemporaryDirectory() as td:
    f = Path(td) / "w.bin"
    f.write_bytes(b"y" * (um.PART_SIZE + 10))
    cl = FakeClient(script=[Resp(200, etag=None), Resp(200, '"e2"')])
    am = FakeAM()
    try:
        run(um._upload_multipart(cl, am, "a/b", "w.bin", f, um.PART_SIZE + 10, 1))
        chk("an empty ETag aborts the upload", False, "it completed anyway")
    except RuntimeError as exc:
        chk("an empty ETag aborts the upload", "no ETag" in str(exc))
        chk("CONTROL and complete_multipart was never called", am.completed == [])

print("\n[6] timeouts scale with the part, instead of one flat number")
small = um._timeout_for(1024)
large = um._timeout_for(um.PART_SIZE)
chk("a bigger part gets a longer read timeout", large.read > small.read,
    f"{small.read} -> {large.read}")
chk("even a tiny part keeps a sane floor", small.read >= 120, f"{small.read}")
chk("connect stays bounded", large.connect == 60.0, f"{large.connect}")

print("\n[7] expiry scales with the file, so a slow big upload does not expire")
chk("a 10 GB file asks for more than a 1 GB file",
    um._expiry_for(10 * 1024 ** 3) > um._expiry_for(1024 ** 3))
chk("CONTROL a tiny file still gets at least the floor",
    um._expiry_for(1) >= um.URL_EXPIRY_FLOOR, f"{um._expiry_for(1)}")


print("\n[8] adaptive part size: a file past the 10,000-part cap must not fail")
chk("a small file keeps the floor", um._part_size_for(100 * 1024 ** 2) == um.MIN_PART_SIZE)
for gb in (200, 500, 1000):
    size = gb * 1024 ** 3
    ps = um._part_size_for(size)
    parts = -(-size // ps)
    chk(f"a {gb} GB file fits under the cap", parts <= um.MAX_PARTS, f"{parts} parts of {ps//(1024*1024)} MiB")
    chk(f"CONTROL a {gb} GB file would NOT fit at the 16 MiB floor",
        -(-size // um.MIN_PART_SIZE) > um.MAX_PARTS)
chk("every adaptive part size respects S3's own 5 MiB floor",
    all(um._part_size_for(g * 1024 ** 3) >= um.S3_MIN_PART for g in (1, 200, 1000)))

print("\n[9] a many-part upload, at the scale of a multi-GB checkpoint")
# Exercise the REAL code path at 320 parts, the part count of a 5 GB file, by
# shrinking the part size instead of moving 5 GB.
_floor, _ps, _s3 = um.MIN_PART_SIZE, um.PART_SIZE, um.S3_MIN_PART
um.MIN_PART_SIZE = um.PART_SIZE = 1024
um.S3_MIN_PART = 512          # scale S3's own floor with the simulation
try:
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / "foundation.safetensors"
        total = 1024 * 320 + 511          # 321 parts, last one short
        f.write_bytes(bytes(range(256)) * (total // 256) + b"Z" * (total % 256))
        cl, am = FakeClient(), FakeAM()
        run(um._upload_multipart(cl, am, "a/b", "foundation.safetensors", f, total, 1))
        chk("start asked for 321 parts", am.started[0]["part_count"] == 321, f"{am.started[0]}")
        chk("321 PUTs were sent", len(cl.puts) == 321, f"{len(cl.puts)}")
        chk("every byte sent exactly once", sum(n for _, n in cl.puts) == total,
            f"{sum(n for _,n in cl.puts)} vs {total}")
        got = [p["part_number"] for p in am.completed[0]["parts"]]
        chk("parts are completed in ASCENDING order despite concurrency",
            got == sorted(got) and got == list(range(1, 322)), f"first={got[:3]} last={got[-3:]}")
        chk("every completed part carries an etag",
            all(p["etag"] for p in am.completed[0]["parts"]))

    print("\n[10] concurrency is bounded, not unbounded")
    class CountingClient(FakeClient):
        def __init__(self):
            super().__init__(); self.inflight = 0; self.peak = 0
        async def put(self, url, content=None, headers=None, timeout=None):
            self.inflight += 1; self.peak = max(self.peak, self.inflight)
            try:
                await asyncio.sleep(0.002)
                return await super().put(url, content=content, headers=headers,
                                         timeout=timeout)
            finally:
                self.inflight -= 1
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / "w.bin"; total = 1024 * 40
        f.write_bytes(b"q" * total)
        cl, am = CountingClient(), FakeAM()
        run(um._upload_multipart(cl, am, "a/b", "w.bin", f, total, 0))
        chk("more than one part was in flight at once", cl.peak > 1, f"peak={cl.peak}")
        chk("and never more than PART_CONCURRENCY", cl.peak <= um.PART_CONCURRENCY,
            f"peak={cl.peak} limit={um.PART_CONCURRENCY}")
finally:
    um.MIN_PART_SIZE, um.PART_SIZE, um.S3_MIN_PART = _floor, _ps, _s3

print("\n[11] a partial upload is never completed")
_floor, _ps, _s3 = um.MIN_PART_SIZE, um.PART_SIZE, um.S3_MIN_PART
um.MIN_PART_SIZE = um.PART_SIZE = 1024
um.S3_MIN_PART = 512          # scale S3's own floor with the simulation
try:
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / "w.bin"; total = 1024 * 4
        f.write_bytes(b"r" * total)
        cl = FakeClient(script=[Resp(200,'"a"'), Resp(403, etag=None),
                                Resp(200,'"c"'), Resp(200,'"d"')])
        am = FakeAM()
        try:
            run(um._upload_multipart(cl, am, "a/b", "w.bin", f, total, 0))
            chk("a 403 on one part aborts the whole upload", False, "it completed")
        except RuntimeError as exc:
            # Re-wrapped so the message cannot carry the presigned URL; see case [16].
            chk("a 403 on one part aborts the whole upload", "403" in str(exc), str(exc)[:50])
            chk("CONTROL and complete_multipart was never called", am.completed == [],
                f"{am.completed}")
finally:
    um.MIN_PART_SIZE, um.PART_SIZE, um.S3_MIN_PART = _floor, _ps, _s3

print("\n[12] the per-part timeout is APPLIED, not just computed")
# Review found the file documented a part-sized timeout in three places while every
# PUT ran under one flat client-wide value. Case [6] asserted that _timeout_for
# SCALES, which stayed green over that gap, because scaling a number nobody passes
# to the client proves nothing. These assert it reaches the request.
with tempfile.TemporaryDirectory() as td:
    _floor, _ps, _s3 = um.MIN_PART_SIZE, um.PART_SIZE, um.S3_MIN_PART
    try:
        # 8 MiB parts give 240 s; the 1 MiB tail falls back to the 120 s floor.
        # Below 4 MiB every part hits the floor and this test cannot discriminate,
        # which is how the first version of it failed with three equal values.
        um.MIN_PART_SIZE = um.PART_SIZE = 8 * 1024 * 1024
        um.S3_MIN_PART = 1
        f = Path(td) / "w.bin"
        total = 8 * 1024 * 1024 * 2 + 1024 * 1024      # 2 full parts + a 1 MiB tail
        f.write_bytes(b"z" * total)
        c, am = FakeClient(), FakeAM()
        asyncio.get_event_loop().run_until_complete(
            um._upload_multipart(c, am, "ws/a", "w.bin", f, total, 0))
        chk("every PUT carried a timeout", c.put_timeouts and all(
            t is not None for t in c.put_timeouts), f"{c.put_timeouts}")
        reads = [t.read for t in c.put_timeouts if t is not None]
        # The short final part must get a SMALLER window than a full part, which is
        # only true if the timeout is derived from each body rather than a constant.
        chk("the short last part gets its own smaller timeout",
            len(set(reads)) > 1 and min(reads) < max(reads), f"{reads}")
        # There WAS a line here labelled CONTROL asserting `len(set(reads)) != 1`.
        # It was decoration: with the timeout removed, `reads` is empty, so the set
        # has length 0, which is also not 1, and it stayed green while the two
        # assertions above went red. The two above are the control. Measured by
        # deleting the `timeout=` argument: 2 failures, this line still passing.
    finally:
        um.MIN_PART_SIZE, um.PART_SIZE, um.S3_MIN_PART = _floor, _ps, _s3

print("\n[13] a short part-URL list is refused BEFORE anything is uploaded")
# This used to surface as a bare `KeyError: 4` partway through, after real parts had
# already gone up, and the guard that was written could never fire because gather()
# raised first.
with tempfile.TemporaryDirectory() as td:
    _floor, _ps, _s3 = um.MIN_PART_SIZE, um.PART_SIZE, um.S3_MIN_PART
    try:
        um.MIN_PART_SIZE = um.PART_SIZE = 1024
        um.S3_MIN_PART = 1
        f = Path(td) / "w.bin"
        f.write_bytes(b"z" * 4096)          # wants 4 parts
        class ShortAM(FakeAM):
            async def put_file_start_multipart(self, *a, **kw):
                full = await super().put_file_start_multipart(*a, **kw)
                full["parts"] = full["parts"][:-1]     # one URL missing
                return full
        c, am = FakeClient(), ShortAM()
        try:
            asyncio.get_event_loop().run_until_complete(
                um._upload_multipart(c, am, "ws/a", "w.bin", f, 4096, 0))
            raised = ""
        except Exception as exc:
            raised = f"{type(exc).__name__}: {exc}"
        chk("it raises rather than KeyError-ing", "RuntimeError" in raised, raised[:90])
        chk("the message names the missing part", "missing part number" in raised, raised[:90])
        chk("and NOTHING was uploaded first", c.puts == [], f"{len(c.puts)} PUT(s)")
        # CONTROL: the same file, same sizes, a COMPLETE list. If this failed too,
        # the guard above would be rejecting something unrelated to the short list.
        c2, am2 = FakeClient(), FakeAM()
        asyncio.get_event_loop().run_until_complete(
            um._upload_multipart(c2, am2, "ws/a", "w.bin", f, 4096, 0))
        chk("CONTROL the same file uploads fine with a complete list",
            len(c2.puts) == 4, f"{len(c2.puts)} PUT(s)")
    finally:
        um.MIN_PART_SIZE, um.PART_SIZE, um.S3_MIN_PART = _floor, _ps, _s3

print("\n[14] 408 and 429 retry; every other 4xx still fails fast")
for code, should_retry in ((408, True), (429, True), (403, False), (400, False), (503, True)):
    c = FakeClient(script=[Resp(code), Resp(200)])
    try:
        etag = asyncio.get_event_loop().run_until_complete(
            um._put_with_retry(c, "http://x/p1", b"abc", "p1"))
        ok = True
    except Exception:
        ok = False
    chk(f"{code}: {'retried and recovered' if should_retry else 'failed fast'}",
        ok is should_retry, f"{len(c.puts)} attempt(s)")

print("\n[15] a failing part cancels its siblings instead of leaving them running")
# Review measured this as correct but found the suite blind to it: reverting the
# wrapper left the suite green. My first attempt at this case was ALSO green on that
# mutant, for a reason worth writing down: run_until_complete stops the loop as soon
# as the coroutine raises, so the slow siblings never resume and never record that
# they finished. "Did a sibling finish late" is therefore untestable from outside the
# loop; both versions look identical.
#
# What does discriminate is the task STATE at the moment of the raise, inspected from
# inside the still-running loop. The wrapper cancels and awaits the siblings before
# re-raising, so none is left pending. A plain gather() leaves them running.
with tempfile.TemporaryDirectory() as td:
    _floor, _ps, _s3 = um.MIN_PART_SIZE, um.PART_SIZE, um.S3_MIN_PART
    try:
        um.MIN_PART_SIZE = um.PART_SIZE = 1024
        um.S3_MIN_PART = 1
        f = Path(td) / "w.bin"
        f.write_bytes(b"z" * 4096)                  # 4 parts

        class SlowSiblingClient(FakeClient):
            """The 2nd part URL fails at once with a 403; the others take 0.3 s."""
            def __init__(self):
                super().__init__()
                self._idx = {}

            async def put(self, url, content=None, headers=None, timeout=None):
                if url not in self._idx:
                    self._idx[url] = len(self._idx) + 1
                if self._idx[url] == 2:
                    return Resp(403)
                await asyncio.sleep(0.3)
                return await super().put(url, content=content, headers=headers,
                                         timeout=timeout)

        async def drive():
            before = set(asyncio.all_tasks())
            c, am = SlowSiblingClient(), FakeAM()
            try:
                await um._upload_multipart(c, am, "ws/a", "w.bin", f, 4096, 0)
                return "", 0, len(c._idx)
            except Exception as exc:
                # Tasks this upload created that are STILL not finished.
                leftover = [t for t in asyncio.all_tasks()
                            if t not in before and not t.done()]
                return type(exc).__name__, len(leftover), len(c._idx)

        raised, leftover, attempted = asyncio.get_event_loop().run_until_complete(drive())
        chk("the upload still fails", raised != "", raised)
        chk("no sibling task is left running when the error is raised",
            leftover == 0, f"{leftover} task(s) still pending")
        chk("CONTROL the siblings really were in flight to begin with",
            attempted > 1, f"{attempted} part URL(s) attempted")
    finally:
        um.MIN_PART_SIZE, um.PART_SIZE, um.S3_MIN_PART = _floor, _ps, _s3

print("\n[16] a refused upload does not print the presigned URL")
# A presigned URL carries its signature in the query string, so httpx's own error message is a
# working credential. A contributor pastes that into an issue without thinking about it.
SECRET_URL = "https://store.example/bucket/w.bin?X-Amz-Signature=deadbeefcafe&X-Amz-Expires=900"
c = FakeClient(script=[Resp(403)])
try:
    asyncio.get_event_loop().run_until_complete(
        um._put_with_retry(c, SECRET_URL, b"abc", "weights.pt part 3/6"))
    msg = ""
except Exception as exc:
    msg = str(exc)
chk("a 4xx still fails the upload", msg != "", msg[:60])
chk("the message does NOT contain the signature", "X-Amz-Signature" not in msg, msg[:80])
chk("nor the URL at all", SECRET_URL not in msg and "store.example" not in msg, msg[:80])
chk("and it DOES name the part", "weights.pt part 3/6" in msg, msg[:80])
chk("and the status code", "403" in msg, msg[:80])

print(f"\n{len(PASS)} passed, {len(FAIL)} failed, {len(PASS)+len(FAIL)} cases ran")
if FAIL:
    print("FAILED: " + "; ".join(FAIL))
sys.exit(1 if FAIL else 0)
