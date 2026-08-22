#!/usr/bin/env python3
"""In-container HTTP API for a Linux desktop — the daemon the SDK talks to.

Endpoints (JSON unless noted):
  GET  /api/health                 -> {"ok": true, "display": ":99"}  (503 if X is down)
  POST /api/cmd      {"cmd", "timeoutMs"?}    -> {"exit","stdout","stderr"}
  POST /api/create   {"command", "title"?}    -> {"pid","log"}
  POST /api/kill     {"title"}                -> {"ok": true}
  POST /api/type     {"text", "delayMs"?}     -> {"exit","stdout","stderr"}
  POST /api/key      {"keys"}                 -> {"exit","stdout","stderr"}
  POST /api/mouse    {"x","y"}                -> {"exit","stdout","stderr"}
  POST /api/click    {"button"?,"x"?,"y"?}    -> {"exit","stdout","stderr"}
  POST /api/windows  {}                       -> {"windows": ["Name", ...]}
  POST /api/screenshot {"name"?}              -> {"path","exit","stdout","stderr"}
  GET  /api/observe  ?width=&quality=         -> image/jpeg bytes

Every computer runs one of these (port 8095 by default; publish a different
host port per computer). This is a root shell over the network — same trust
level as `docker exec`. Keep it on your machine's localhost only.
"""

import json
import os
import re
import signal
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DISPLAY = os.environ.get("DISPLAY", ":99")
WORKSPACE = "/workspace"
PORT = int(os.environ.get("API_PORT", "8095"))
MAX_CMD_TIME = 3600


def log(msg: str) -> None:
    print(f"[api] {msg}", flush=True)


def pid_pattern(title: str) -> str:
    """Regex-escape, then wrap the last char in [] so pkill can't match its own shell."""
    esc = re.escape(title)
    return esc if len(esc) < 2 else esc[:-1] + "[" + esc[-1] + "]"


def capture_pipe(args, env=None, timeout: int = 60):
    """Run argv, return (exit, stdout_bytes, stderr_bytes). Kills the whole
    process group on timeout so orphaned grandchildren die too."""
    e = dict(os.environ)
    e["DISPLAY"] = DISPLAY
    if env:
        e.update(env)
    p = subprocess.Popen(
        args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=e, start_new_session=True
    )
    try:
        out, err = p.communicate(timeout=timeout)
        return p.returncode, out, err
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            out, err = p.communicate(timeout=5)
        except Exception:
            out, err = b"", b""
        return -9, out, err


def run(script: str, timeout: int = 60, env=None) -> dict:
    code, out, err = capture_pipe(["bash", "-c", script], env, timeout)
    return {
        "exit": code,
        "stdout": out.decode("utf-8", "replace"),
        "stderr": err.decode("utf-8", "replace"),
    }


_health = {"at": 0.0, "ok": False}
HEALTH_TTL = 2.0


def display_ok() -> bool:
    """True when the X display actually answers.

    Reporting a hardcoded True here used to mask a dead Xvfb: the web UI showed
    a green "desktop online" badge and the compose healthcheck passed while the
    desktop was gone. Result is cached briefly because the UI polls every 5s and
    the SDK gives /api/health a 1s budget.
    """
    now = time.monotonic()
    if now - _health["at"] < HEALTH_TTL:
        return bool(_health["ok"])
    code, _, _ = capture_pipe(["xdpyinfo", "-display", DISPLAY], None, 5)
    _health["at"] = now
    _health["ok"] = code == 0
    return bool(_health["ok"])


def run_argv(args, timeout: int = 60) -> dict:
    code, out, err = capture_pipe(args, None, timeout)
    return {
        "exit": code,
        "stdout": out.decode("utf-8", "replace"),
        "stderr": err.decode("utf-8", "replace"),
    }


TITLE_RE = re.compile(r"[A-Za-z0-9._-]{1,64}")


class Handler(BaseHTTPRequestHandler):
    server_version = "computer-api"
    protocol_version = "HTTP/1.1"

    def _route(self) -> str:
        return urlparse(self.path).path.rstrip("/") or "/"

    def _send(self, code: int, body: bytes = b"", ctype: str = "application/json") -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, code: int, obj) -> None:
        self._send(code, json.dumps(obj).encode("utf-8"))

    def _body(self) -> dict:
        try:
            n = int(self.headers.get("Content-Length", 0) or 0)
            raw = self.rfile.read(n) if n else b"{}"
            obj = json.loads(raw or b"{}")
            return obj if isinstance(obj, dict) else {}
        except Exception:
            return {}

    def do_GET(self) -> None:
        try:
            self._handle_get()
        except Exception as err:
            log(f"GET error: {err!r}")
            self._json(500, {"error": str(err)[:500]})

    def _handle_get(self) -> None:
        route = self._route()
        if route in ("/", "/api/health", "/health"):
            ok = display_ok()
            return self._json(200 if ok else 503, {"ok": ok, "display": DISPLAY})
        if route in ("/api/observe", "/observe"):
            q = parse_qs(urlparse(self.path).query)
            quality = max(1, min(int((q.get("quality") or ["70"])[0]), 95))
            width = int((q.get("width") or ["0"])[0])
            if width > 0:
                script = (
                    f"import -window root -display {DISPLAY} -quality {quality} jpg:- "
                    f"| convert - -resize {width}x -quality {quality} jpg:-"
                )
                code, out, err = capture_pipe(["bash", "-c", script], None, 60)
            else:
                code, out, err = capture_pipe(
                    ["import", "-window", "root", "-display", DISPLAY,
                     "-quality", str(quality), "jpg:-"],
                    None, 60,
                )
            if code != 0 or not out:
                note = err.decode("utf-8", "replace").strip() or "no frame"
                return self._json(500, {"error": note[:500]})
            return self._send(200, out, "image/jpeg")
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        try:
            self._handle_post()
        except Exception as err:
            log(f"POST error: {err!r}")
            self._json(500, {"error": str(err)[:500]})

    def _handle_post(self) -> None:
        route = self._route()
        body = self._body()

        if route in ("/api/cmd", "/cmd"):
            script = body.get("cmd", "")
            if not isinstance(script, str) or not script.strip():
                return self._json(400, {"error": "cmd required"})
            timeout = min(int(body.get("timeoutMs") or 120), MAX_CMD_TIME)
            return self._json(200, run(script, timeout))

        if route in ("/api/create", "/create"):
            command = body.get("command", "")
            if not isinstance(command, str) or not command.strip():
                return self._json(400, {"error": "command required"})
            title = body.get("title")
            log_path = "/dev/null"
            if isinstance(title, str) and TITLE_RE.fullmatch(title):
                log_path = f"{WORKSPACE}/.workers/{title}/console.log"
                os.makedirs(os.path.dirname(log_path), exist_ok=True)
            e = dict(os.environ)
            e["DISPLAY"] = DISPLAY
            with open(log_path, "ab") as f:
                p = subprocess.Popen(
                    ["bash", "-c", command],
                    stdin=subprocess.DEVNULL, stdout=f, stderr=f,
                    env=e, start_new_session=True,
                )
            return self._json(200, {"pid": p.pid, "log": log_path})

        if route in ("/api/kill", "/kill"):
            title = str(body.get("title", ""))
            if not TITLE_RE.fullmatch(title):
                return self._json(400, {"error": "bad title"})
            pattern = pid_pattern(title)
            run(
                f"pkill -f '{pattern}' || true; "
                f"xdotool search --name '{pattern}' windowkill 2>/dev/null || true",
                30,
            )
            return self._json(200, {"ok": True})

        if route in ("/api/type", "/type"):
            text = body.get("text", "")
            if not isinstance(text, str):
                return self._json(400, {"error": "text required"})
            delay = max(0, min(int(body.get("delayMs") or 30), 500))
            return self._json(200, run(
                'xdotool type --delay "$DELAY" -- "$TEXT"', 30, {"TEXT": text, "DELAY": str(delay)}
            ))

        if route in ("/api/key", "/key"):
            keys = body.get("keys", "")
            if not isinstance(keys, str):
                return self._json(400, {"error": "keys required"})
            return self._json(200, run_argv(["xdotool", "key", keys]))

        if route in ("/api/mouse", "/mouse"):
            x, y = int(body.get("x", 0)), int(body.get("y", 0))
            return self._json(200, run_argv(["xdotool", "mousemove", str(x), str(y)]))

        if route in ("/api/click", "/click"):
            button = int(body.get("button", 1))
            args = ["xdotool"]
            if body.get("x") is not None and body.get("y") is not None:
                args += ["mousemove", str(int(body["x"])), str(int(body["y"]))]
            args += ["click", str(button)]
            return self._json(200, run_argv(args))

        if route in ("/api/windows", "/windows"):
            code, out, err = capture_pipe(
                ["xdotool", "search", "--onlyvisible", "--name", ".*", "getwindowname"], None, 30
            )
            names = [
                ln.strip()
                for ln in out.decode("utf-8", "replace").splitlines()
                if ln.strip()
            ]
            return self._json(200, {"windows": names})

        if route in ("/api/screenshot", "/screenshot"):
            name = str(body.get("name") or f"shot-{int(time.time() * 1000)}.png")
            name = re.sub(r"[^A-Za-z0-9._-]", "_", os.path.basename(name))
            if not name.endswith(".png"):
                name += ".png"
            path = f"{WORKSPACE}/{name}"
            r = run(f"import -window root -display {DISPLAY} '{path}'", 60)
            r["path"] = path
            return self._json(200, r)

        self._json(404, {"error": "not found"})


class ApiServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    server = ApiServer(("0.0.0.0", PORT), Handler)
    log(f"listening on 0.0.0.0:{PORT} (display {DISPLAY})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()