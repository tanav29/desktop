#!/usr/bin/env python3
"""In-container HTTP API for a Linux desktop — the daemon the SDK talks to.

Endpoints (JSON unless noted):
  GET  /api/health                 -> {"ok": true, "display": ":99"}  (503 if X is down)
  POST /api/cmd      {"cmd", "timeoutMs"?}    -> {"exit","stdout","stderr"}
  POST /api/create   {"command", "title"?}    -> {"pid","log"}
  POST /api/kill     {"title"}                -> {"ok": true}
  POST /api/actions  {"actions": [...]}       -> {"ok","failedAt"?,"steps","state"}
  POST /api/type     {"text", "delayMs"?}     -> {"exit","stdout","stderr"}
  POST /api/key      {"keys"}                 -> {"exit","stdout","stderr"}
  POST /api/mouse    {"x","y"}                -> {"exit","stdout","stderr"}
  POST /api/click    {"button"?,"x"?,"y"?}    -> {"exit","stdout","stderr"}
  POST /api/windows  {}                       -> {"windows": ["Name", ...]}
  POST /api/screenshot {"name"?}              -> {"path","exit","stdout","stderr"}
  GET  /api/observe  ?width=&quality=         -> image/jpeg bytes
  GET  /api/pointer                -> {"x","y","click":{"x","y","button","at"}}

/api/actions runs a whole input sequence in one round-trip, which is the point:
a caller driving this over the network pays one HTTP hop per *task* instead of
one per keystroke. See ACTION_KINDS for the vocabulary.

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

# ---------------------------------------------------------------------------
# Pointer state
# ---------------------------------------------------------------------------
# Xvfb has no hardware cursor and x11vnc ships the cursor as a client-side
# shape, so a noVNC viewer draws a cursor wherever the *human's* mouse is and
# never where xdotool actually moved the pointer. The UI draws its own marker
# instead, and polls these two values at ~10Hz to do it.

_pointer = {"at": 0.0, "x": 0, "y": 0}
POINTER_TTL = 0.06

_last_click = {"x": 0, "y": 0, "button": 0, "at": 0.0}


def _int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _clamp(value: int, lo: int, hi: int) -> int:
    return max(lo, min(value, hi))


def pointer_now(cached: bool = False):
    """Current pointer position as (x, y). Cached briefly for the UI's poll."""
    now = time.monotonic()
    if cached and now - _pointer["at"] < POINTER_TTL:
        return int(_pointer["x"]), int(_pointer["y"])
    code, out, _ = capture_pipe(["xdotool", "getmouselocation", "--shell"], None, 5)
    x, y = int(_pointer["x"]), int(_pointer["y"])
    if code == 0:
        for line in out.decode("utf-8", "replace").splitlines():
            if line.startswith("X="):
                x = _int(line[2:], x)
            elif line.startswith("Y="):
                y = _int(line[2:], y)
    _pointer.update({"at": now, "x": x, "y": y})
    return x, y


def note_click(x: int, y: int, button: int) -> None:
    """Record a click so the UI can draw a ripple where it landed."""
    _last_click.update({"x": int(x), "y": int(y), "button": int(button), "at": time.time()})


def focused_now() -> str:
    """Title of the focused window, or "" when nothing is focused."""
    code, out, _ = capture_pipe(
        ["bash", "-c", "xdotool getactivewindow getwindowname 2>/dev/null"], None, 5
    )
    if code != 0:
        return ""
    text = out.decode("utf-8", "replace").strip()
    return text.splitlines()[0][:120] if text else ""


# ---------------------------------------------------------------------------
# Action sequences (/api/actions)
# ---------------------------------------------------------------------------

MAX_ACTIONS = 32
ACTIONS_BUDGET = 120.0
ACTION_KINDS = (
    "move", "click", "drag", "scroll", "type", "key", "paste", "focus", "wait", "wait_for",
)


def safe_window(name) -> str:
    """Validate a window pattern.

    The pattern reaches xdotool through an env var, never through a shell
    string, so quoting is a non-issue here — length and control bytes are the
    only things worth rejecting. Window titles legitimately contain spaces and
    punctuation ("example.com - Chromium"), so TITLE_RE would be far too
    strict for this field.
    """
    if not isinstance(name, str) or not name.strip():
        return ""
    if len(name) > 128 or any(ord(c) < 32 for c in name):
        return ""
    return name


def run_action(action: dict, deadline: float):
    """Run one action. Returns (ok, note). Never raises for bad input."""
    kind = action.get("do")
    if kind not in ACTION_KINDS:
        return False, f"unknown action {kind!r} (expected one of: {', '.join(ACTION_KINDS)})"

    left = deadline - time.monotonic()
    if left <= 0:
        return False, "sequence ran out of time before this action"
    budget = max(1, int(min(left, 60)))

    def shell(script: str, env=None, timeout=None):
        r = run(script, timeout or budget, env)
        if r["exit"] == 0:
            return True, ""
        why = (r["stderr"] or r["stdout"]).strip()
        return False, (why[:300] or f"exit {r['exit']}")

    def argv(args):
        r = run_argv(args, budget)
        if r["exit"] == 0:
            return True, ""
        why = (r["stderr"] or r["stdout"]).strip()
        return False, (why[:300] or f"exit {r['exit']}")

    if kind == "move":
        x = _clamp(_int(action.get("x")), -1, 8192)
        y = _clamp(_int(action.get("y")), -1, 8192)
        return argv(["xdotool", "mousemove", str(x), str(y)])

    if kind == "click":
        button = _clamp(_int(action.get("button"), 1), 1, 9)
        count = _clamp(_int(action.get("count"), 1), 1, 10)
        args = ["xdotool"]
        has_xy = action.get("x") is not None and action.get("y") is not None
        if has_xy:
            x = _clamp(_int(action.get("x")), 0, 8192)
            y = _clamp(_int(action.get("y")), 0, 8192)
            args += ["mousemove", "--sync", str(x), str(y)]
        args += ["click", "--repeat", str(count), "--delay", "120", str(button)]
        ok, note = argv(args)
        cx, cy = (x, y) if has_xy else pointer_now()
        if ok:
            note_click(cx, cy, button)
        return ok, note

    if kind == "drag":
        x1 = _clamp(_int(action.get("x1")), 0, 8192)
        y1 = _clamp(_int(action.get("y1")), 0, 8192)
        x2 = _clamp(_int(action.get("x2")), 0, 8192)
        y2 = _clamp(_int(action.get("y2")), 0, 8192)
        button = _clamp(_int(action.get("button"), 1), 1, 3)
        mx, my = (x1 + x2) // 2, (y1 + y2) // 2
        # The midpoint hop and the sleeps are not decoration: apps that
        # implement drag by watching motion events ignore a press/release pair
        # that teleports, so a two-point drag silently does nothing.
        return argv([
            "xdotool",
            "mousemove", "--sync", str(x1), str(y1),
            "sleep", "0.1",
            "mousedown", str(button),
            "sleep", "0.1",
            "mousemove", "--sync", str(mx), str(my),
            "sleep", "0.05",
            "mousemove", "--sync", str(x2), str(y2),
            "sleep", "0.1",
            "mouseup", str(button),
        ])

    if kind == "scroll":
        direction = str(action.get("dir") or "down").lower()
        if direction not in ("up", "down"):
            return False, "scroll dir must be 'up' or 'down'"
        amount = _clamp(_int(action.get("amount"), 3), 1, 25)
        button = "4" if direction == "up" else "5"
        args = ["xdotool"]
        if action.get("x") is not None and action.get("y") is not None:
            args += ["mousemove", "--sync",
                     str(_clamp(_int(action.get("x")), 0, 8192)),
                     str(_clamp(_int(action.get("y")), 0, 8192))]
        args += ["click", "--repeat", str(amount), "--delay", "60", button]
        return argv(args)

    if kind == "type":
        text = action.get("text")
        if not isinstance(text, str) or text == "":
            return False, "type needs non-empty text"
        delay = _clamp(_int(action.get("delayMs"), 12), 0, 500)
        return shell(
            'xdotool type --delay "$DELAY" -- "$TEXT"',
            {"TEXT": text, "DELAY": str(delay)},
            timeout=max(budget, min(60, 5 + len(text) // 20)),
        )

    if kind == "key":
        keys = action.get("keys")
        if not isinstance(keys, str) or not keys.strip() or len(keys) > 200:
            return False, "key needs a keysym string, e.g. 'Return' or 'ctrl+shift+t'"
        count = _clamp(_int(action.get("count"), 1), 1, 50)
        # run_argv does not go through a shell, so keysyms need no quoting.
        return argv(["xdotool", "key", "--repeat", str(count), "--delay", "40"] + keys.split())

    if kind == "paste":
        text = action.get("text")
        if not isinstance(text, str) or text == "":
            return False, "paste needs non-empty text"
        # Two things worth knowing here:
        #  * xclip forks and stays alive to own the selection, so its stdout and
        #    stderr must be detached — otherwise it holds the pipe open, we never
        #    see EOF, and the step dies on the timeout instead of returning.
        #  * terminals bind paste to ctrl+shift+v; ctrl+v is a no-op there. Read
        #    the focused window's process name to pick the right combo, so the
        #    caller doesn't have to care which kind of window it is. (xdotool
        #    3.20160805 has no getwindowclassname, hence the /proc route.)
        return shell(
            'printf %s "$TEXT" | xclip -selection clipboard >/dev/null 2>&1 || exit 1; '
            'pid=$(xdotool getactivewindow getwindowpid 2>/dev/null); '
            'comm=$(cat "/proc/$pid/comm" 2>/dev/null); '
            'case "$comm" in *term*) combo=ctrl+shift+v ;; *) combo=ctrl+v ;; esac; '
            'xdotool key --clearmodifiers "$combo"',
            {"TEXT": text},
        )

    if kind == "focus":
        window = safe_window(action.get("window"))
        if not window:
            return False, "focus needs a window name (<=128 chars, no control characters)"
        return shell(
            'wid=$(xdotool search --onlyvisible --name "$WIN" 2>/dev/null | head -1); '
            '[ -n "$wid" ] || { echo "no visible window matching: $WIN" >&2; exit 1; }; '
            'xdotool windowactivate --sync "$wid"',
            {"WIN": window},
        )

    if kind == "wait":
        ms = _clamp(_int(action.get("ms"), 500), 0, 30_000)
        time.sleep(min(ms / 1000.0, max(0.0, deadline - time.monotonic())))
        return True, ""

    if kind == "wait_for":
        window = safe_window(action.get("window"))
        if not window:
            return False, "wait_for needs a window name (<=128 chars, no control characters)"
        timeout_ms = _clamp(_int(action.get("timeoutMs"), 15_000), 250, 60_000)
        timeout_ms = min(timeout_ms, int(max(0.25, deadline - time.monotonic()) * 1000))
        return shell(
            'end=$(( $(date +%s%3N) + TIMEOUT )); '
            'while :; do '
            '  wid=$(xdotool search --onlyvisible --name "$WIN" 2>/dev/null | head -1); '
            '  if [ -n "$wid" ]; then exit 0; fi; '
            '  if [ "$(date +%s%3N)" -ge "$end" ]; then '
            '    echo "timed out after ${TIMEOUT}ms waiting for window: $WIN" >&2; exit 1; '
            '  fi; '
            '  sleep 0.25; '
            'done',
            {"WIN": window, "TIMEOUT": str(timeout_ms)},
            timeout=int(timeout_ms / 1000) + 5,
        )

    return False, f"action {kind!r} not implemented"


def run_actions(actions: list) -> dict:
    """Run actions in order, stopping at the first failure."""
    deadline = time.monotonic() + ACTIONS_BUDGET
    steps = []
    failed_at = None

    for i, action in enumerate(actions):
        if not isinstance(action, dict):
            steps.append({"i": i, "do": None, "ok": False, "note": "each action must be an object"})
            failed_at = i
            break
        ok, note = run_action(action, deadline)
        step = {"i": i, "do": action.get("do"), "ok": ok}
        if note:
            step["note"] = note
        steps.append(step)
        if not ok:
            failed_at = i
            break

    x, y = pointer_now()
    result = {
        "ok": failed_at is None,
        "ran": len(steps),
        "steps": steps,
        "state": {"pointer": [x, y], "focused": focused_now()},
    }
    if failed_at is not None:
        result["failedAt"] = failed_at
    return result


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
        if route in ("/api/pointer", "/pointer"):
            x, y = pointer_now(cached=True)
            click = dict(_last_click) if _last_click["at"] else None
            return self._json(200, {"x": x, "y": y, "click": click})
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

        if route in ("/api/actions", "/actions"):
            actions = body.get("actions")
            if not isinstance(actions, list) or not actions:
                return self._json(400, {"error": "actions must be a non-empty array"})
            if len(actions) > MAX_ACTIONS:
                return self._json(400, {"error": f"at most {MAX_ACTIONS} actions per request"})
            return self._json(200, run_actions(actions))

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
            has_xy = body.get("x") is not None and body.get("y") is not None
            if has_xy:
                args += ["mousemove", str(int(body["x"])), str(int(body["y"]))]
            args += ["click", str(button)]
            result = run_argv(args)
            if result["exit"] == 0:
                cx, cy = (
                    (int(body["x"]), int(body["y"])) if has_xy else pointer_now()
                )
                note_click(cx, cy, button)
            return self._json(200, result)

        if route in ("/api/windows", "/windows"):
            # `%@` is load-bearing: a command chained after `search` defaults to
            # acting on `%1`, the first match only — so without it this returned
            # a single name, or nothing at all when the first match was unnamed.
            code, out, err = capture_pipe(
                ["xdotool", "search", "--onlyvisible", "--name", ".", "getwindowname", "%@"],
                None,
                30,
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