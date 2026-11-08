---
title: "Python FastAPI chunked upload backend example"
description: "A working FastAPI and python-multipart backend for chunked, resumable and folder uploads, with manifest, chunk status and finalize endpoints. Includes notes for Flask and Django."
---

# Python (FastAPI) example

A minimal implementation of the [backend contract](/protocol) with FastAPI and `python-multipart`, for Python 3.10 or newer. It is a documentation example, not a shipped server: add authentication, check that an `uploadId` belongs to the current user, and limit sizes before using anything like it in production.

It was run against the real client (the built UI in Chromium) with the quick-start configuration: a nested folder with empty folders (through the manifest) and files of four and six chunks, compared with the source by SHA-256, a reload in the middle of a file followed by a resume through chunk status, a path with `..`, a file over the size limit, a short chunk, a missing chunk at finalize, and a repeated finalize.

```sh
python -m venv .venv
. .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install fastapi "uvicorn[standard]" python-multipart
uvicorn main:app --port 3000
```

```python
# pip install fastapi "uvicorn[standard]" python-multipart
# Run: uvicorn main:app --port 3000
import os
import re
import shutil
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

ROOT = Path("uploads").resolve()
TMP = Path("uploads-tmp").resolve()
UUID_RE = re.compile(r"^[0-9a-f-]{36}$", re.I)
DRIVE_RE = re.compile(r"^[A-Za-z]:")
MAX_CHUNK = 64 * 1024 * 1024  # largest request body accepted
MAX_FILE = 10 * 1024 * 1024 * 1024  # largest file accepted (adTotalSize)

app = FastAPI()


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


@app.exception_handler(ApiError)
def api_error(_: Request, exc: ApiError):
    return JSONResponse({"code": exc.code, "message": exc.message}, status_code=exc.status)


# A missing or non-numeric form field would otherwise get FastAPI's own 422 body.
@app.exception_handler(RequestValidationError)
def validation_error(_: Request, exc: RequestValidationError):
    return JSONResponse({"code": "INVALID_CHUNK", "message": "Invalid chunk request"}, status_code=400)


def target(rel) -> Path | None:
    """Absolute path inside ROOT for a client-supplied relative path, or None."""
    if not isinstance(rel, str) or not rel or rel.startswith("/") or "\\" in rel or "\0" in rel:
        return None
    if DRIVE_RE.match(rel) or any(s in ("", ".", "..") for s in rel.split("/")):
        return None
    abs_path = (ROOT / rel).resolve()
    return abs_path if abs_path.is_relative_to(ROOT) else None


def must_target(rel) -> Path:
    dest = target(rel)
    if dest is None:
        raise ApiError(400, "INVALID_PATH", "Invalid path")
    return dest


def must_uuid(value) -> str:
    if not isinstance(value, str) or not UUID_RE.match(value):
        raise ApiError(400, "INVALID_CHUNK", "Invalid upload id")
    return value


def write_atomic(upload: UploadFile, dest: Path) -> None:
    """Write to a temp name, then rename: a cut-off write never shows up as received."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(f"{dest.name}.{uuid.uuid4()}.part")
    try:
        with open(part, "wb") as out:
            shutil.copyfileobj(upload.file, out)
        os.replace(part, dest)
    finally:
        part.unlink(missing_ok=True)


async def json_body(request: Request) -> dict:
    try:
        body = await request.json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        raise ApiError(400, "INVALID_PATH", "Invalid request")
    return body


# Chunk upload, or a whole file. The same chunk may arrive twice: writing it again is harmless.
@app.post("/upload")
def upload_chunk(
    file: UploadFile | None = File(None),
    adUploadId: str | None = Form(None),
    adChunkIndex: int | None = Form(None),
    adChunkCount: int | None = Form(None),
    adChunkSize: int | None = Form(None),
    adChunkOffset: int | None = Form(None),
    adTotalSize: int | None = Form(None),
    adRelativePath: str | None = Form(None),
):
    if file is None:
        raise ApiError(400, "INVALID_CHUNK", "Missing file")
    if (file.size or 0) > MAX_CHUNK:
        raise ApiError(413, "TOO_LARGE", "Request body is too large")

    # Not chunked (a file of at most chunkSize, or chunking is off): no chunk fields, write the file in place.
    if adUploadId is None:
        write_atomic(file, must_target(adRelativePath))
        return {"ok": True}

    must_uuid(adUploadId)
    fields = (adChunkIndex, adChunkCount, adChunkSize, adChunkOffset, adTotalSize)
    if any(f is None or f < 0 for f in fields) or adChunkIndex >= max(adChunkCount, 1):
        raise ApiError(400, "INVALID_CHUNK", "Invalid chunk request")
    if adTotalSize > MAX_FILE:
        raise ApiError(413, "TOO_LARGE", "File is too large")
    if file.size != min(adChunkSize, adTotalSize - adChunkOffset):
        raise ApiError(400, "INVALID_CHUNK", "Chunk length does not match")
    write_atomic(file, TMP / adUploadId / str(adChunkIndex))
    return {"ok": True}


# Chunk status, used to resume.
@app.get("/upload/status")
def upload_status(uploadId: str = ""):
    if not UUID_RE.match(uploadId):
        raise ApiError(404, "HTTP_ERROR", "Unknown upload")
    d = TMP / uploadId
    if (d / "done").exists():
        return {"received": [], "complete": True}
    if not d.is_dir():
        raise ApiError(404, "HTTP_ERROR", "Unknown upload")
    return {"received": sorted(int(n) for n in os.listdir(d) if n.isdigit())}


# Folder manifest: create every folder, including the empty ones.
@app.post("/upload/manifest")
async def upload_manifest(request: Request):
    body = await json_body(request)
    folders, files = body.get("folders") or [], body.get("files") or []
    if not isinstance(folders, list) or not isinstance(files, list):
        raise ApiError(400, "INVALID_PATH", "Invalid manifest")
    dirs = [must_target(f) for f in folders]
    for f in files:  # reject a bad file path now, not at the first chunk
        must_target(f.get("relativePath") if isinstance(f, dict) else None)
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)
    return {"ok": True}


def assemble(upload_id: str, rel: str, dest: Path, total_size: int, total_chunks: int) -> None:
    d = TMP / upload_id
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(f"{dest.name}.{uuid.uuid4()}.part")
    try:
        with open(part, "wb") as out:
            for i in range(total_chunks):
                try:
                    with open(d / str(i), "rb") as chunk:
                        shutil.copyfileobj(chunk, out)
                except FileNotFoundError:
                    raise ApiError(409, "CHUNK_MISMATCH", f"Chunk {i} is missing")
        if part.stat().st_size != total_size:
            raise ApiError(409, "CHUNK_MISMATCH", "Assembled size does not match")
        os.replace(part, dest)  # atomic
    finally:
        part.unlink(missing_ok=True)
    shutil.rmtree(d)
    d.mkdir(parents=True)
    (d / "done").write_text(rel)


# Finalize: assemble the chunks into the final file, then forget them. Idempotent.
@app.post("/upload/finalize")
async def upload_finalize(request: Request):
    body = await json_body(request)
    rel, upload_id = body.get("relativePath"), body.get("uploadId")
    dest = must_target(rel)
    must_uuid(upload_id)
    total_size, total_chunks = body.get("totalSize"), body.get("totalChunks")
    if (TMP / upload_id / "done").exists():
        return {"ok": True, "path": rel}
    if not all(isinstance(n, int) and n >= 0 for n in (total_size, total_chunks)):
        raise ApiError(400, "INVALID_CHUNK", "Invalid finalize request")
    if not (TMP / upload_id).is_dir():
        raise ApiError(409, "CHUNK_MISMATCH", "No chunks received")
    await run_in_threadpool(assemble, upload_id, rel, dest, total_size, total_chunks)
    return {"ok": True, "path": rel}


# Optional: connectivityProbeUrl
@app.head("/upload/ping")
def upload_ping():
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
```

## Size limits

- `MAX_CHUNK` is the largest request body the example accepts, and `MAX_FILE` is the largest finished file (checked against `adTotalSize`). Both answer `413` with the code `TOO_LARGE`, which the client does not retry. Set `MAX_CHUNK` above your `chunkSize`.
- Starlette reads the whole request before your function runs, so these checks happen after the body has arrived. To refuse an oversized body early, also set a limit in the proxy in front of the app (for example `client_max_body_size` in nginx), and have it answer with the same JSON body if you can.
- Starlette keeps a small upload in memory and spools a larger one to a temporary file, and it limits ordinary form fields to 1 MB each. The `ad*` fields are tiny, so this never matters for a chunk.
- The JSON manifest has no limit in FastAPI. A manifest lists every file of a batch, so limit its size in the proxy.

## Notes

- The upload, status and ping functions are plain `def`, so FastAPI runs them in a thread pool and the blocking file work does not stall other requests. The manifest and finalize functions are `async` only to read the JSON body; finalize assembles the file in the thread pool.
- Every error, including a missing or non-numeric form field, is answered as `{ "code", "message" }`. Without the two exception handlers FastAPI would answer a bad form field with its own `422` body, which the client would store as `HTTP_ERROR`.
- A bad or unreadable JSON body on the manifest and finalize endpoints is answered as `400 INVALID_PATH`.
- If the page and the API are on different origins, add `CORSMiddleware` from `fastapi.middleware.cors` with `allow_methods=["GET", "POST", "HEAD", "OPTIONS"]` and `allow_headers=["X-Requested-With", "Cache-Control", "Content-Type"]` (plus your own headers).

## Adapting it to Flask or Django

The path check (`target`), `write_atomic` and `assemble` do not depend on the framework, so copy them unchanged. Only the request and response handling differs. These notes were not run against the client; test them in your project.

**Flask.** Read the file with `request.files.get("file")`, the fields with `request.form` (convert numbers with `int()` and turn a `ValueError` into `400 INVALID_CHUNK`) and the JSON with `request.get_json(silent=True)`. Copy a chunk with `shutil.copyfileobj(file.stream, out)`. Return errors with an `@app.errorhandler(ApiError)` that builds `jsonify(code=..., message=...), status`. `app.config["MAX_CONTENT_LENGTH"]` makes Flask answer `413`, so add `@app.errorhandler(413)` that returns the `TOO_LARGE` body.

**Django.** Read the file with `request.FILES.get("file")` (its `.size` is the chunk length, and `.chunks()` yields it in pieces), the fields with `request.POST` and the manifest with `json.loads(request.body)`. Return `JsonResponse({"code": ..., "message": ...}, status=...)` from a small `try/except ApiError` wrapper. Two Django settings matter: the upload views need `@csrf_exempt` (or send the token through the `headers` option), and `DATA_UPLOAD_MAX_MEMORY_SIZE` (2.5 MB by default) applies to a JSON manifest read from `request.body`, so raise it for large batches. It does not count file parts.

See also the [Express example](/backend/express), the [Java (Spring Boot) example](/backend/java), the [Laravel example](/backend/laravel) and the [protocol](/protocol).
