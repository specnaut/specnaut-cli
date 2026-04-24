#!/usr/bin/env python3
"""
Miximodel blog CLI — called by `miximodel.sh`.

Uses only the Python standard library so the skill has zero install step.
The admin token + base URL come from environment variables that
`miximodel.sh` loads from the sibling `.env` file.

Subcommands:
  blog-create  <path/to/article.md>
  blog-list    [--status=published] [--page=N] [--per-page=N]
  blog-show    <slug>
  blog-update  <slug> <path/to/article.md>
  blog-delete  <slug>
  blog-publish <slug>
  api          <METHOD> <path> [--data @file.json | --data '{"...": ...}']
"""

from __future__ import annotations

import io
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


API_URL = os.environ.get("MIXIMODEL_API_URL", "https://miximodel.com").rstrip("/")
TOKEN = os.environ.get("MIXIMODEL_ADMIN_TOKEN", "")

MARKDOWN_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")


# ---------------------------------------------------------------------------
# Low-level HTTP
# ---------------------------------------------------------------------------


class HttpError(RuntimeError):
    def __init__(self, status: int, body: str, url: str):
        super().__init__(f"HTTP {status} on {url}: {body}")
        self.status = status
        self.body = body
        self.url = url


def _request(
    method: str,
    path: str,
    *,
    body: Optional[bytes] = None,
    headers: Optional[dict[str, str]] = None,
    query: Optional[dict[str, Any]] = None,
) -> tuple[int, bytes, dict[str, str]]:
    url = f"{API_URL}{path}"
    if query:
        filtered = {k: v for k, v in query.items() if v is not None}
        if filtered:
            url = f"{url}?{urllib.parse.urlencode(filtered)}"

    req_headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/json",
    }
    if headers:
        req_headers.update(headers)

    req = urllib.request.Request(url, data=body, method=method, headers=req_headers)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read(), dict(resp.headers.items())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise HttpError(e.code, err_body, url) from e
    except urllib.error.URLError as e:
        raise RuntimeError(
            f"Cannot reach {API_URL} ({e.reason}). "
            f"Is the server running? Check MIXIMODEL_API_URL in your .env."
        ) from e


def _json_request(method: str, path: str, payload: Any = None, query: Optional[dict] = None) -> Any:
    body = None
    headers = {}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    status, data, _ = _request(method, path, body=body, headers=headers, query=query)
    if not data:
        return None
    try:
        return json.loads(data.decode("utf-8"))
    except json.JSONDecodeError:
        return data.decode("utf-8")


# ---------------------------------------------------------------------------
# Multipart upload (stdlib, so we build it by hand)
# ---------------------------------------------------------------------------


def _upload_image(file_path: Path) -> str:
    mime, _ = mimetypes.guess_type(file_path.name)
    if mime not in {"image/jpeg", "image/png", "image/webp"}:
        raise RuntimeError(
            f"Unsupported image type for {file_path} (got {mime!r}); "
            "allowed: jpeg, png, webp"
        )

    boundary = f"----miximodel-{uuid.uuid4().hex}"
    buf = io.BytesIO()
    buf.write(f"--{boundary}\r\n".encode())
    buf.write(
        f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"\r\n'.encode()
    )
    buf.write(f"Content-Type: {mime}\r\n\r\n".encode())
    buf.write(file_path.read_bytes())
    buf.write(f"\r\n--{boundary}--\r\n".encode())

    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    status, data, _ = _request("POST", "/api/blog/media", body=buf.getvalue(), headers=headers)
    if status != 201:
        raise HttpError(status, data.decode("utf-8", errors="replace"), "/api/blog/media")
    parsed = json.loads(data.decode("utf-8"))
    url = parsed.get("url")
    if not url:
        raise RuntimeError(f"Upload response missing `url`: {parsed!r}")
    return url


# ---------------------------------------------------------------------------
# Markdown frontmatter + inline image rewriting
# ---------------------------------------------------------------------------


def _parse_article_file(path: Path) -> tuple[dict[str, Any], str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise RuntimeError(
            f"{path} does not start with YAML frontmatter (`---` on line 1)"
        )
    end = text.find("\n---\n", 4)
    if end == -1:
        raise RuntimeError(f"{path} frontmatter is not closed with `---`")

    front_text = text[4:end]
    body = text[end + 5 :].lstrip("\n")

    meta = _parse_simple_yaml(front_text)
    return meta, body


def _parse_simple_yaml(text: str) -> dict[str, Any]:
    """
    Minimal YAML subset: `key: value` lines, optional quoted values,
    `#` comments. No nesting, no lists — matches the article frontmatter
    schema. Keeps the skill free of a PyYAML dependency.
    """
    out: dict[str, Any] = {}
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        if ":" not in line:
            raise RuntimeError(f"Malformed frontmatter line (no colon): {raw!r}")
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip()
        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]
        if value == "":
            value = None
        elif value.lower() == "true":
            value = True
        elif value.lower() == "false":
            value = False
        out[key] = value
    return out


def _is_remote(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    return parsed.scheme in {"http", "https"}


def _upload_local_images(body: str, base_dir: Path) -> tuple[str, int]:
    """Rewrites `![alt](./foo.jpg)` to the uploaded URL. Returns (new_body, count)."""
    uploaded = 0

    def replace(match: re.Match) -> str:
        nonlocal uploaded
        alt = match.group(1)
        src = match.group(2)
        if _is_remote(src):
            return match.group(0)
        candidate = (base_dir / src).resolve()
        if not candidate.is_file():
            raise RuntimeError(f"Referenced image not found: {candidate}")
        print(f"  ↑ uploading {candidate.relative_to(base_dir) if candidate.is_relative_to(base_dir) else candidate}")
        url = _upload_image(candidate)
        uploaded += 1
        return f"![{alt}]({url})"

    new_body = MARKDOWN_IMAGE_RE.sub(replace, body)
    return new_body, uploaded


def _build_payload(meta: dict[str, Any], body: str, base_dir: Path) -> dict[str, Any]:
    body, uploaded = _upload_local_images(body, base_dir)
    if uploaded:
        print(f"  ✓ {uploaded} inline image(s) uploaded")

    cover_image = meta.get("cover_image")
    if cover_image and not _is_remote(str(cover_image)):
        candidate = (base_dir / str(cover_image)).resolve()
        if not candidate.is_file():
            raise RuntimeError(f"cover_image not found: {candidate}")
        print(f"  ↑ uploading cover_image {candidate.name}")
        cover_image = _upload_image(candidate)

    payload: dict[str, Any] = {}
    if "title" in meta and meta["title"]:
        payload["title"] = str(meta["title"])
    if "slug" in meta and meta["slug"]:
        payload["slug"] = str(meta["slug"])
    if body:
        payload["body"] = body
    if meta.get("excerpt") is not None:
        payload["excerpt"] = str(meta["excerpt"]) if meta["excerpt"] else None
    if cover_image is not None:
        payload["coverImage"] = cover_image
    if meta.get("status"):
        payload["status"] = str(meta["status"])
    if meta.get("published_at"):
        payload["publishedAt"] = str(meta["published_at"])
    return payload


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------


def cmd_blog_create(args: list[str]) -> int:
    if len(args) != 1:
        print("Usage: blog-create <path/to/article.md>", file=sys.stderr)
        return 2
    path = Path(args[0]).resolve()
    if not path.is_file():
        print(f"File not found: {path}", file=sys.stderr)
        return 1
    meta, body = _parse_article_file(path)
    print(f"Publishing {path.name}…")
    payload = _build_payload(meta, body, path.parent)
    if "title" not in payload or "body" not in payload:
        print("Article must have at least `title` + body", file=sys.stderr)
        return 1
    article = _json_request("POST", "/api/blog", payload)
    print(f"\n✓ Created: {article.get('slug')}")
    print(f"  URL:     {API_URL}/blog/{article.get('slug')}")
    print(f"  Status:  {article.get('status')}")
    return 0


def cmd_blog_list(args: list[str]) -> int:
    page = 1
    per_page = 20
    for a in args:
        if a.startswith("--page="):
            page = int(a.split("=", 1)[1])
        elif a.startswith("--per-page="):
            per_page = int(a.split("=", 1)[1])
        elif a.startswith("--status="):
            print("note: public /api/blog only returns published articles", file=sys.stderr)
        else:
            print(f"Unknown flag: {a}", file=sys.stderr)
            return 2
    result = _json_request("GET", "/api/blog", query={"page": page, "per_page": per_page})
    data = result.get("data", [])
    meta = result.get("meta", {})
    print(f"Page {meta.get('currentPage')}/{meta.get('lastPage')}  ({meta.get('total')} total)")
    for a in data:
        print(f"  [{a.get('status')}] {a.get('slug'):40s}  {a.get('title')}")
    return 0


def cmd_blog_show(args: list[str]) -> int:
    if len(args) != 1:
        print("Usage: blog-show <slug>", file=sys.stderr)
        return 2
    article = _json_request("GET", f"/api/blog/{args[0]}")
    print(json.dumps(article, indent=2, ensure_ascii=False))
    return 0


def cmd_blog_update(args: list[str]) -> int:
    if len(args) != 2:
        print("Usage: blog-update <slug> <path/to/article.md>", file=sys.stderr)
        return 2
    slug, file_arg = args
    path = Path(file_arg).resolve()
    if not path.is_file():
        print(f"File not found: {path}", file=sys.stderr)
        return 1
    meta, body = _parse_article_file(path)
    print(f"Updating {slug} from {path.name}…")
    payload = _build_payload(meta, body, path.parent)
    if not payload:
        print("Empty payload — nothing to update", file=sys.stderr)
        return 1
    article = _json_request("PUT", f"/api/blog/{slug}", payload)
    print(f"\n✓ Updated: {article.get('slug')}")
    return 0


def cmd_blog_delete(args: list[str]) -> int:
    if len(args) != 1:
        print("Usage: blog-delete <slug>", file=sys.stderr)
        return 2
    slug = args[0]
    print(f"Soft-deleting {slug}…")
    _json_request("DELETE", f"/api/blog/{slug}")
    print(f"✓ Deleted: {slug}")
    return 0


def cmd_blog_publish(args: list[str]) -> int:
    if len(args) != 1:
        print("Usage: blog-publish <slug>", file=sys.stderr)
        return 2
    slug = args[0]
    payload = {
        "status": "published",
        "publishedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    article = _json_request("PUT", f"/api/blog/{slug}", payload)
    print(f"✓ Published: {article.get('slug')} at {article.get('publishedAt')}")
    return 0


def cmd_api(args: list[str]) -> int:
    if len(args) < 2:
        print("Usage: api <METHOD> <path> [--data '<json>' | --data @file.json]", file=sys.stderr)
        return 2
    method = args[0].upper()
    path = args[1]
    payload = None
    if len(args) >= 4 and args[2] == "--data":
        raw = args[3]
        if raw.startswith("@"):
            raw = Path(raw[1:]).read_text(encoding="utf-8")
        payload = json.loads(raw)
    result = _json_request(method, path, payload)
    print(json.dumps(result, indent=2, ensure_ascii=False) if isinstance(result, (dict, list)) else result)
    return 0


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


COMMANDS = {
    "blog-create": cmd_blog_create,
    "blog-list": cmd_blog_list,
    "blog-show": cmd_blog_show,
    "blog-update": cmd_blog_update,
    "blog-delete": cmd_blog_delete,
    "blog-publish": cmd_blog_publish,
    "api": cmd_api,
}


def main(argv: list[str]) -> int:
    if not TOKEN:
        print("MIXIMODEL_ADMIN_TOKEN is not set", file=sys.stderr)
        return 1
    if len(argv) < 2:
        print("Usage: miximodel.sh <subcommand> [args]", file=sys.stderr)
        print(f"Available: {', '.join(COMMANDS)}", file=sys.stderr)
        return 2
    subcommand = argv[1]
    handler = COMMANDS.get(subcommand)
    if not handler:
        print(f"Unknown subcommand: {subcommand}", file=sys.stderr)
        print(f"Available: {', '.join(COMMANDS)}", file=sys.stderr)
        return 2
    try:
        return handler(argv[2:])
    except HttpError as e:
        print(f"\n✗ {e}", file=sys.stderr)
        return 1
    except (RuntimeError, FileNotFoundError, ValueError) as e:
        print(f"\n✗ {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
