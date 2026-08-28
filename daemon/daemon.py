#!/usr/bin/env python3
"""In-container HTTP API for a Linux desktop — the daemon the SDK talks to.

Endpoints (JSON unless noted):
  GET  /api/health                 -> {"ok": true, "display": ":99", ...}  (503 if X is down)
  GET  /api/info                   -> extended health + version, uptime, workers, mem
  GET  /api/workers                -> {"workers": [{title, pid, alive, ...}]}
  GET  /api/ps                     -> {"processes": [...], "windows": [...], "workers": [...]}
  POST /api/cmd      {"cmd", "timeoutMs"?}    -> {"exit","stdout","stderr","durationMs"}
  POST /api/exec     alias for /api/cmd
  POST /api/create   {"command", "title"?,"waitMs"?} -> {"pid","log","title","startedAt"}
  POST /api/kill     {"title","signal"?,"waitMs"?,"clean"?} -> {"ok", ...details}
  POST /api/killAll  {"prefix"?,"clean"?}     -> {"ok","killed":[],"failed":[]}
  POST /api/kill/all alias
  POST /api/system   {"action":"killAll"|"clean"|"reset",...} -> {"ok", ...}
  POST /api/actions  {"actions": [...]}       -> {"ok","failedAt"?,"steps","state"}
  POST /api/type     {"text", "delayMs"?}     -> {"exit","stdout","stderr"}
  POST /api/key      {"keys"}                 -> {"exit","stdout","stderr"}
  POST /api/mouse    {"x","y"}                -> {"exit","stdout","stderr"}
  POST /api/click    {"button"?,"x"?,"y"?}    -> {"exit","stdout","stderr"}
  POST /api/windows  {}                       -> {"windows": ["Name", ...]} or ?detail=1 -> [{id,name,...}]
  POST /api/screenshot {"name"?}              -> {"path","exit","stdout","stderr"}
  GET  /api/observe  ?width=&quality=         -> image/jpeg bytes
  GET  /api/pointer                -> {"x","y","click":{"x","y","button","at"}}
  GET  /api/windows  ?detail=1     -> detailed windows

  # Recording + sharing — daemon-native so callers don't need shell via /api/cmd.
  POST /api/record/capture {"sessionId","quality"?} -> {"ok", "frame","path","frames"}
  POST /api/record/build   {"sessionId"}            -> {"ok","url","path","bytes","frames"} or {"ok":false,"reason"}
  GET  /api/record?sessionId=xxx                    -> same as build (status)
  POST /api/share {"what":"screenshot"|"recording","sessionId"?,"label"?} -> {"ok","media":...,"note"}

/api/actions runs a whole input sequence in one round-trip, which is the point:
a caller driving this over the network pays one HTTP hop per *task* instead of
one per keystroke. See ACTION_KINDS for the vocabulary.

Every computer runs one of these (port 8095 by default; publish a different
host port per computer). This is a root shell over the network — same trust
level as `docker exec`. Keep it on your machine's localhost only.
"""

import glob
import json
import os
import re
import signal
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DISPLAY = os.environ.get("DISPLAY", ":99")
RESOLUTION = os.environ.get("RESOLUTION", "1600x900")
WORKSPACE = "/workspace"
PORT = int(os.environ.get("API_PORT", "8095"))
MAX_CMD_TIME = 3600  # seconds
VERSION = "2.0.0"
STARTED_AT = time.time()


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
    try:
        p = subprocess.Popen(
            args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=e, start_new_session=True
        )
    except FileNotFoundError as ex:
        return 127, b"", f"not found: {args[0] if args else ''}: {ex}".encode()
    except OSError as ex:
        return 127, b"", str(ex).encode()
    try:
        out, err = p.communicate(timeout=timeout)
        return p.returncode, out, err
    except subprocess.TimeoutExpired:
        try:
            if hasattr(os, "killpg"):
                os.killpg(p.pid, signal.SIGKILL)
            else:
                # Windows fallback — kill the process directly
                try:
                    p.kill()
                except Exception:
                    try:
                        os.kill(p.pid, signal.SIGTERM)  # type: ignore
                    except Exception:
                        pass
        except (ProcessLookupError, OSError, AttributeError):
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

# Recording constants — match web/lib/recording.ts so both paths produce identical GIFs.
RECORDINGS_DIR = f"{WORKSPACE}/recordings"
SHOTS_DIR = f"{WORKSPACE}/shots"
WORKERS_DIR = f"{WORKSPACE}/.workers"
SESSION_ID_RE = re.compile(r"[A-Za-z0-9._-]{1,64}")
FRAME_DELAY_TICKS = 50  # 0.5s per frame (100ths)
OUTPUT_WIDTH = 960
MIN_BYTES = 1000
MAX_FRAMES_PER_SESSION = 300

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
# Workers helpers — filesystem backed so they survive daemon restarts
# ---------------------------------------------------------------------------

def _worker_dir(title: str) -> str:
    return f"{WORKERS_DIR}/{title}"


def _meta_path(title: str) -> str:
    return f"{_worker_dir(title)}/meta.json"


def _is_pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError, ValueError, OSError):
        return False


def _pgrep_pids(title: str) -> list[int]:
    """Return pids whose full command line contains title (regex escaped)."""
    pattern = pid_pattern(title)
    # Use pgrep -f to avoid shell; we still escape title via pid_pattern
    # run via capture_pipe to avoid shell injection — pass pattern as arg
    code, out, _ = capture_pipe(["pgrep", "-f", pattern], None, 5)
    if code != 0:
        return []
    pids: list[int] = []
    for line in out.decode("utf-8", "replace").splitlines():
        line = line.strip()
        if line.isdigit():
            try:
                pids.append(int(line))
            except ValueError:
                pass
    return pids


def _window_ids_for_title(title: str) -> list[str]:
    """Return window ids whose name contains title (visible only)."""
    # Use env var to avoid shell injection
    code, out, _ = capture_pipe(
        ["bash", "-c", 'xdotool search --onlyvisible --name "$WIN" 2>/dev/null || true'],
        {"WIN": title},
        5,
    )
    ids: list[str] = []
    for line in out.decode("utf-8", "replace").splitlines():
        line = line.strip()
        if line:
            ids.append(line)
    return ids


def _read_worker_meta(title: str) -> dict | None:
    path = _meta_path(title)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _write_worker_meta(title: str, data: dict) -> None:
    d = _worker_dir(title)
    try:
        os.makedirs(d, exist_ok=True)
        with open(_meta_path(title), "w", encoding="utf-8") as f:
            json.dump(data, f)
    except Exception:
        pass


def _worker_status(title: str) -> dict:
    """Single worker status dict. Never throws."""
    d = _worker_dir(title)
    meta = _read_worker_meta(title)
    pid = int(meta.get("pid", 0)) if meta and "pid" in meta else 0
    command = str(meta.get("command", "")) if meta else ""
    started_at = float(meta.get("startedAt", 0)) if meta else 0
    # alive check: either pid alive or pgrep finds something
    alive = False
    pids: list[int] = []
    if pid and _is_pid_alive(pid):
        alive = True
        pids = [pid]
    else:
        pids = _pgrep_pids(title)
        alive = len(pids) > 0
    # window check
    wids = _window_ids_for_title(title)
    window_found = len(wids) > 0
    # log size
    log_path = f"{d}/console.log"
    log_bytes = 0
    try:
        log_bytes = os.path.getsize(log_path)
    except Exception:
        log_path = "/dev/null" if not title else log_path
    # fallback command if meta missing but pgrep found
    if not command and alive and pids:
        # best-effort: ps to retrieve cmd
        code, out, _ = capture_pipe(["ps", "-o", "cmd=", "-p", str(pids[0])], None, 3)
        if code == 0:
            command = out.decode("utf-8", "replace").strip()[:500]
    return {
        "title": title,
        "pid": pid or (pids[0] if pids else 0),
        "pids": pids,
        "alive": alive,
        "command": command,
        "startedAt": started_at,
        "log": log_path if os.path.exists(log_path) else "/dev/null",
        "logBytes": log_bytes,
        "windowFound": window_found,
        "windowIds": wids[:5],
    }


def list_workers() -> list[dict]:
    """Enumerate .workers/* dirs and return status for each valid title."""
    try:
        entries = os.listdir(WORKERS_DIR)
    except FileNotFoundError:
        return []
    except Exception:
        return []
    out: list[dict] = []
    for name in sorted(entries):
        if not TITLE_RE.fullmatch(name):
            continue
        # skip hidden or non-dirs
        full = os.path.join(WORKERS_DIR, name)
        try:
            if not os.path.isdir(full):
                continue
        except Exception:
            continue
        out.append(_worker_status(name))
    return out


def _kill_title_detailed(title: str, signal_mode: str = "auto", wait_ms: int = 2000, clean: bool = False) -> dict:
    """Phased kill: TERM -> wait -> KILL -> windowkill. Returns detailed report."""
    title = str(title or "").strip()
    if not TITLE_RE.fullmatch(title):
        return {"ok": False, "reason": "bad title", "title": title}
    signal_mode = str(signal_mode or "auto").lower()
    if signal_mode not in ("auto", "term", "kill", "9", "15"):
        signal_mode = "auto"
    wait_ms = _clamp(_int(wait_ms, 2000), 0, 15000)

    start_pids = _pgrep_pids(title)
    start_wids = _window_ids_for_title(title)
    meta = _read_worker_meta(title)
    start_pid = int(meta.get("pid", 0)) if meta else 0
    if start_pid and start_pid not in start_pids and _is_pid_alive(start_pid):
        start_pids.append(start_pid)

    # nothing to kill? still try windowkill and return early but report
    if not start_pids and not start_wids:
        # clean up stale dir if requested or if dead
        if clean:
            try:
                import shutil
                shutil.rmtree(_worker_dir(title), ignore_errors=True)
            except Exception:
                pass
        return {
            "ok": True,
            "title": title,
            "killed": False,
            "reason": "nothing running for that title",
            "pidsKilled": [],
            "windowsKilled": 0,
            "startedWith": {"pids": start_pids, "windows": len(start_wids)},
            "aliveAfter": False,
            "cleaned": bool(clean),
        }

    # Phase 1: TERM (or immediate KILL if requested)
    # Also kill the known meta pid directly — pgrep may miss short-lived or
    # generic commands where the title is only in the parent bash's `# comment`.
    def _kill_pid(pid: int, sig: str):
        if not pid or not _is_pid_alive(pid):
            return
        try:
            # kill process group if we can (negative pid = pgid), else single pid
            run(f'kill -{sig} -- -{pid} 2>/dev/null || kill -{sig} {pid} 2>/dev/null || true', 3)
        except Exception:
            pass

    if signal_mode in ("kill", "9"):
        # go straight to KILL
        if start_pid:
            _kill_pid(start_pid, "KILL")
        run(f'pkill -9 -f "$PAT" 2>/dev/null || true', 5, {"PAT": pid_pattern(title)})
        for pid in start_pids:
            if pid != start_pid:
                _kill_pid(pid, "KILL")
    else:
        if start_pid:
            _kill_pid(start_pid, "TERM")
        run(f'pkill -TERM -f "$PAT" 2>/dev/null || true', 5, {"PAT": pid_pattern(title)})
        for pid in start_pids:
            if pid != start_pid:
                _kill_pid(pid, "TERM")
        # also windowkill early — some apps only have a window, no pgrep match (e.g. chromium renderer)
        run(f'xdotool search --name "$WIN" windowkill 2>/dev/null || true', 5, {"WIN": title})
        if signal_mode == "term":
            # only TERM, wait then check
            time.sleep(min(wait_ms / 1000.0, 5.0))
        else:  # auto
            time.sleep(min(wait_ms / 1000.0, 2.0))
            remaining = _pgrep_pids(title)
            still_windows = _window_ids_for_title(title)
            # also consider meta pid still alive
            if start_pid and _is_pid_alive(start_pid) and start_pid not in remaining:
                remaining.append(start_pid)
            if remaining or still_windows:
                # escalate to KILL
                if start_pid:
                    _kill_pid(start_pid, "KILL")
                run(f'pkill -KILL -f "$PAT" 2>/dev/null || true', 5, {"PAT": pid_pattern(title)})
                for pid in remaining:
                    if pid != start_pid:
                        _kill_pid(pid, "KILL")
                run(f'xdotool search --name "$WIN" windowkill 2>/dev/null || true', 5, {"WIN": title})
                time.sleep(0.5)

    if signal_mode in ("kill", "9"):
        run(f'xdotool search --name "$WIN" windowkill 2>/dev/null || true', 5, {"WIN": title})
        time.sleep(0.5)

    # final windowkill sweep (pattern with regex escape trick already handled via env)
    run(f'xdotool search --name "$WIN" windowkill 2>/dev/null || true', 5, {"WIN": title})
    # final direct kill sweep for any remaining pids seen at start
    for pid in start_pids:
        if _is_pid_alive(pid):
            _kill_pid(pid, "KILL")

    end_pids = _pgrep_pids(title)
    end_wids = _window_ids_for_title(title)
    alive_after = len(end_pids) > 0 or len(end_wids) > 0
    # also check original pid
    if start_pid and _is_pid_alive(start_pid):
        alive_after = True
        if start_pid not in end_pids:
            end_pids.append(start_pid)

    killed_pids = [p for p in start_pids if p not in end_pids]
    # if we killed at least one pid or removed a window, consider it killed
    killed = (len(killed_pids) > 0) or (len(start_wids) > len(end_wids)) or (not alive_after and (start_pids or start_wids))

    # log tail for debugging (last 2KB)
    log_tail = ""
    log_path = f"{_worker_dir(title)}/console.log"
    try:
        with open(log_path, "rb") as f:
            f.seek(0, 2)
            sz = f.tell()
            f.seek(max(0, sz - 2048))
            log_tail = f.read().decode("utf-8", "replace").strip()[-800:]
    except Exception:
        log_tail = ""

    cleaned = False
    if clean and not alive_after:
        try:
            import shutil
            target = _worker_dir(title)
            # safety: must be under WORKERS_DIR and title is validated
            # normpath for cross-platform (Windows vs Linux slash)
            try:
                common = os.path.commonpath([os.path.abspath(target), os.path.abspath(WORKERS_DIR)])
                is_safe = common == os.path.abspath(WORKERS_DIR)
            except Exception:
                is_safe = target.startswith(WORKERS_DIR)
            if is_safe and title:
                shutil.rmtree(target, ignore_errors=True)
                cleaned = True
        except Exception:
            pass

    return {
        "ok": True,
        "title": title,
        "killed": bool(killed),
        "pidsKilled": killed_pids,
        "pidsBefore": start_pids,
        "pidsAfter": end_pids,
        "windowsKilled": max(0, len(start_wids) - len(end_wids)),
        "windowsBefore": len(start_wids),
        "windowsAfter": len(end_wids),
        "aliveAfter": bool(alive_after),
        "signal": signal_mode,
        "waitMs": wait_ms,
        "logTail": log_tail,
        "cleaned": cleaned,
    }


def _kill_all(prefix: str = "", clean: bool = False) -> dict:
    """Kill all workers (or those matching prefix). Returns aggregated report."""
    prefix = str(prefix or "").strip()
    workers = list_workers()
    # filter
    if prefix:
        # prefix must be safe snippet — allow same charset as title but also empty
        # we do simple startswith, not regex
        workers = [w for w in workers if w["title"].startswith(prefix)]
    killed: list[str] = []
    failed: list[dict] = []
    details: list[dict] = []
    for w in workers:
        title = w["title"]
        res = _kill_title_detailed(title, "auto", 2000, bool(clean))
        details.append(res)
        if res.get("ok") and (res.get("killed") or not w["alive"]):
            # count as killed if it was alive and now dead, or already dead but cleaned
            if w["alive"] and not res.get("aliveAfter"):
                killed.append(title)
            elif not w["alive"] and clean and res.get("cleaned"):
                killed.append(title)
            elif res.get("killed"):
                killed.append(title)
        elif res.get("ok") and res.get("aliveAfter"):
            failed.append({"title": title, "reason": "still alive after kill", "detail": res})
        elif not res.get("ok"):
            failed.append({"title": title, "reason": res.get("reason", "kill failed")})

    # Also sweep any stray pgrep matches and windows that have no worker dir (orphans)
    # Find all windows and try to kill those whose title matches prefix but weren't in workers list
    # We do a best-effort xdotool sweep for prefix pattern when cleanAll without workers
    if not workers and not prefix:
        # no workers at all — still try generic sweep? skip to avoid killing panel
        pass

    return {
        "ok": len(failed) == 0,
        "killed": killed,
        "failed": failed,
        "count": len(killed),
        "total": len(workers),
        "cleaned": bool(clean),
        "details": details,
    }


def _system_info() -> dict:
    """Gather daemon system info (no secrets)."""
    uptime = time.time() - STARTED_AT
    workers = list_workers()
    alive = sum(1 for w in workers if w["alive"])
    # disk
    disk_free = 0
    disk_total = 0
    try:
        st = os.statvfs(WORKSPACE)
        disk_free = st.f_bavail * st.f_frsize
        disk_total = st.f_blocks * st.f_frsize
    except Exception:
        pass
    # mem via /proc/meminfo
    mem_total = 0
    mem_avail = 0
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    mem_total = int(line.split()[1]) * 1024
                elif line.startswith("MemAvailable:"):
                    mem_avail = int(line.split()[1]) * 1024
    except Exception:
        pass
    # resolution parsed
    res = RESOLUTION
    # display check without caching (fresh)
    disp_ok = display_ok()
    # focused + pointer
    try:
        fx, fy = pointer_now()
        focused = focused_now()
    except Exception:
        fx, fy, focused = 0, 0, ""
    return {
        "version": VERSION,
        "display": DISPLAY,
        "resolution": res,
        "displayOk": disp_ok,
        "uptime": round(uptime, 1),
        "startedAt": STARTED_AT,
        "workers": len(workers),
        "workersAlive": alive,
        "workspace": WORKSPACE,
        "pid": os.getpid(),
        "pointer": [fx, fy],
        "focused": focused,
        "diskFree": disk_free,
        "diskTotal": disk_total,
        "memTotal": mem_total,
        "memAvailable": mem_avail,
    }


def _ps_snapshot() -> dict:
    """Process + window snapshot for debugging / SDK ps()."""
    # ps
    code, out, _ = capture_pipe(["ps", "-eo", "pid,ppid,etime,pcpu,pmem,cmd", "--sort=-pcpu"], None, 5)
    processes: list[dict] = []
    if code == 0:
        lines = out.decode("utf-8", "replace").splitlines()
        # header is first line
        for line in lines[1:50]:  # cap at 50 hottest
            line = line.strip()
            if not line:
                continue
            # ps output is columns; cmd is last field with spaces
            parts = line.split(None, 5)
            if len(parts) < 6:
                continue
            try:
                processes.append({
                    "pid": int(parts[0]),
                    "ppid": int(parts[1]),
                    "etime": parts[2],
                    "pcpu": parts[3],
                    "pmem": parts[4],
                    "cmd": parts[5][:500],
                })
            except Exception:
                continue
    # windows detailed
    windows: list[dict] = []
    # get all visible window ids
    code, out, _ = capture_pipe(["xdotool", "search", "--onlyvisible", "--name", ".", "2>/dev/null"], None, 5)
    # fallback: use bash -c to allow search without failure
    if code != 0:
        code, out, _ = capture_pipe(["bash", "-c", "xdotool search --onlyvisible --name '.' 2>/dev/null || true"], None, 5)
    wids: list[str] = []
    if out:
        for ln in out.decode("utf-8", "replace").splitlines():
            ln = ln.strip()
            if ln:
                wids.append(ln)
    for wid in wids[:20]:  # cap detail calls
        # name
        c1, o1, _ = capture_pipe(["xdotool", "getwindowname", wid], None, 3)
        name = o1.decode("utf-8", "replace").strip() if c1 == 0 else ""
        # pid
        c2, o2, _ = capture_pipe(["xdotool", "getwindowpid", wid], None, 3)
        wpid = 0
        if c2 == 0:
            try:
                wpid = int(o2.decode("utf-8", "replace").strip().split()[0])
            except Exception:
                wpid = 0
        # geometry
        c3, o3, _ = capture_pipe(["xdotool", "getwindowgeometry", wid], None, 3)
        geom = o3.decode("utf-8", "replace").strip().replace("\n", " ")[:200] if c3 == 0 else ""
        windows.append({"id": wid, "name": name[:120], "pid": wpid, "geometry": geom})
    return {
        "processes": processes,
        "windows": windows,
        "workers": list_workers(),
        "at": time.time(),
    }

# ---------------------------------------------------------------------------
# Recording helpers (daemon-native so /api/cmd not required)
# ---------------------------------------------------------------------------

def safe_session_id(sid) -> str:
    if not isinstance(sid, str):
        return ""
    sid = sid.strip()
    if not SESSION_ID_RE.fullmatch(sid):
        return ""
    # no path traversal
    if "/" in sid or "\\" in sid or ".." in sid:
        return ""
    return sid


def frame_filename(index: int) -> str:
    return f"frame_{index:06d}.jpg"


def recording_dir(session_id: str) -> str:
    return f"{RECORDINGS_DIR}/{session_id}"


def count_frames(session_id: str) -> int:
    d = recording_dir(session_id)
    try:
        # glob is cheaper than shell ls|wc
        return len(glob.glob(f"{d}/frame_*.jpg"))
    except Exception:
        return 0


def capture_frame(session_id: str, quality: int = 70) -> dict:
    sid = safe_session_id(session_id)
    if not sid:
        return {"ok": False, "reason": "bad sessionId (1-64 chars, A-Z a-z 0-9 . _ -)"}
    d = recording_dir(sid)
    try:
        os.makedirs(d, exist_ok=True)
    except Exception as e:
        return {"ok": False, "reason": f"mkdir failed: {e}"}
    n = count_frames(sid)
    if n >= MAX_FRAMES_PER_SESSION:
        return {"ok": False, "reason": f"hit {MAX_FRAMES_PER_SESSION} frames cap"}
    fname = frame_filename(n)
    path = f"{d}/{fname}"
    quality = _clamp(_int(quality, 70), 1, 95)
    r = run(f"import -window root -display {DISPLAY} -quality {quality} '{path}'", 10)
    if r["exit"] != 0:
        return {"ok": False, "reason": (r["stderr"] or r["stdout"]).strip()[:300] or f"exit {r['exit']}"}
    # verify file exists and has bytes
    try:
        sz = os.path.getsize(path)
        if sz < 100:
            return {"ok": False, "reason": f"frame too small ({sz} bytes)"}
    except Exception:
        pass
    return {"ok": True, "frame": fname, "path": path, "frames": n + 1}


def build_recording(session_id: str) -> dict:
    sid = safe_session_id(session_id)
    if not sid:
        return {"ok": False, "reason": "bad sessionId"}
    d = recording_dir(sid)
    n = count_frames(sid)
    if n == 0:
        return {"ok": False, "reason": "no frames have been captured for this session yet"}
    gif_path = f"{d}/session.gif"
    tmp_path = f"{gif_path}.tmp"
    # -layers Optimize keeps mostly-static desktop small; explicit gif: coder
    # avoids ImageMagick guessing format from .tmp suffix.
    cmd = (
        f"convert -delay {FRAME_DELAY_TICKS} -loop 0 \"{d}\"/frame_*.jpg "
        f"-resize {OUTPUT_WIDTH}x -layers Optimize \"gif:{tmp_path}\" && "
        f"mv -f \"{tmp_path}\" \"{gif_path}\""
    )
    r = run(cmd, 180)
    if r["exit"] != 0:
        return {"ok": False, "reason": (r["stderr"] or r["stdout"]).strip()[:500] or f"exit {r['exit']}"}
    try:
        sz = os.path.getsize(gif_path)
    except Exception as e:
        return {"ok": False, "reason": f"could not stat gif: {e}"}
    if sz < MIN_BYTES:
        return {"ok": False, "reason": f"compiled recording was only {sz} bytes"}
    return {
        "ok": True,
        "url": f"/api/media/recordings/{sid}/session.gif",
        "path": gif_path,
        "bytes": sz,
        "frames": n,
    }


def do_share(what: str, session_id: str = "", label: str = "") -> dict:
    what = str(what or "").strip().lower()
    if what == "recording":
        sid = safe_session_id(session_id)
        if not sid:
            return {"ok": False, "reason": "recording share needs a valid sessionId"}
        res = build_recording(sid)
        if not res.get("ok"):
            return {"ok": False, "reason": res.get("reason", "build failed")}
        caption = (label or "Session recording")[:80]
        return {
            "ok": True,
            "media": {"kind": "video", "url": res["url"], "caption": caption},
            "path": res["path"],
            "bytes": res["bytes"],
            "frames": res["frames"],
            "note": f"Timelapse of {res['frames']} frame(s) posted to the chat.",
        }
    if what == "screenshot":
        # capture to workspace root then move to shots/ like web/agent/tools/share.ts
        ts = int(time.time() * 1000)
        fname = f"shot-{ts}.png"
        # sanitize label for caption only, not filename
        caption = (label or "Desktop screenshot")[:80]
        tmp_path = f"{WORKSPACE}/{fname}"
        r = run(f"import -window root -display {DISPLAY} '{tmp_path}'", 60)
        if r["exit"] != 0:
            return {"ok": False, "reason": (r["stderr"] or r["stdout"]).strip()[:300] or f"exit {r['exit']}"}
        try:
            os.makedirs(SHOTS_DIR, exist_ok=True)
            final = f"{SHOTS_DIR}/{fname}"
            os.rename(tmp_path, final)
        except Exception as e:
            return {"ok": False, "reason": f"move to shots failed: {e}"}
        return {
            "ok": True,
            "media": {"kind": "image", "url": f"/api/media/shots/{fname}", "caption": caption},
            "path": final,
            "note": f"Screenshot posted to the chat ({caption}).",
        }
    return {"ok": False, "reason": "what must be 'screenshot' or 'recording'"}


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
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, code: int, obj) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        try:
            n = int(self.headers.get("Content-Length", 0) or 0)
            # Guard against huge bodies (1 MB cap)
            if n > 1_000_000:
                return {}
            raw = self.rfile.read(n) if n else b"{}"
            obj = json.loads(raw or b"{}")
            return obj if isinstance(obj, dict) else {}
        except Exception:
            return {}

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        t0 = time.monotonic()
        try:
            self._handle_get()
        except Exception as err:
            log(f"GET error: {err!r}")
            try:
                self._json(500, {"error": str(err)[:500]})
            except Exception:
                pass
        finally:
            try:
                dur = (time.monotonic() - t0) * 1000
                log(f"GET {self.path} -> {dur:.0f}ms")
            except Exception:
                pass

    def _handle_get(self) -> None:
        route = self._route()
        q = parse_qs(urlparse(self.path).query)
        if route in ("/", "/api/health", "/health"):
            ok = display_ok()
            info = _system_info()
            # keep backward compat: always include ok + display, add extras
            body = {
                "ok": ok,
                "display": DISPLAY,
                "resolution": RESOLUTION,
                "version": VERSION,
                "uptime": info["uptime"],
                "workers": info["workers"],
                "workersAlive": info["workersAlive"],
            }
            return self._json(200 if ok else 503, body)
        if route in ("/api/info", "/info"):
            info = _system_info()
            ok = info["displayOk"]
            return self._json(200 if ok else 503, {"ok": ok, **info})
        if route in ("/api/workers", "/workers"):
            workers = list_workers()
            return self._json(200, {"workers": workers, "count": len(workers)})
        if route in ("/api/ps", "/ps"):
            snap = _ps_snapshot()
            return self._json(200, snap)
        if route in ("/api/windows", "/windows"):
            # Support detail flag via query
            detail = (q.get("detail") or q.get("detailed") or [""])[0]
            if str(detail).lower() in ("1", "true", "yes"):
                snap = _ps_snapshot()
                return self._json(200, {"windows": snap["windows"], "names": [w["name"] for w in snap["windows"]]})
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
        if route in ("/api/observe", "/observe"):
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
        # Daemon-native recording status — GET variant of build so polling is cheap.
        if route in ("/api/record", "/record"):
            sid = (q.get("sessionId") or q.get("session_id") or [""])[0]
            if not sid and "id" in q:
                sid = q["id"][0]
            if not sid:
                return self._json(400, {"error": "sessionId query param required"})
            res = build_recording(sid)
            # build_recording returns ok:false when no frames — still 200 with reason
            return self._json(200, res)
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        t0 = time.monotonic()
        try:
            self._handle_post()
        except Exception as err:
            log(f"POST error: {err!r}")
            try:
                self._json(500, {"error": str(err)[:500]})
            except Exception:
                pass
        finally:
            try:
                dur = (time.monotonic() - t0) * 1000
                log(f"POST {self.path} -> {dur:.0f}ms")
            except Exception:
                pass

    def _handle_post(self) -> None:
        route = self._route()
        body = self._body()

        if route in ("/api/cmd", "/cmd", "/api/exec", "/exec"):
            script = body.get("cmd", body.get("command", ""))
            if not isinstance(script, str) or not script.strip():
                return self._json(400, {"error": "cmd required"})
            # timeoutMs is in ms from SDK; convert to seconds for run()
            raw_timeout = body.get("timeoutMs", body.get("timeout", 120_000))
            try:
                raw_ms = int(raw_timeout)
            except Exception:
                raw_ms = 120_000
            # if value looks like seconds (< 5000 and caller passed 120) treat as seconds? SDK sends ms.
            # Heuristic: if raw_ms < 2000 and raw_ms <= 120, it's likely seconds from old callers — keep as seconds*1000
            # We already handle both: if raw_ms <= MAX_CMD_TIME (3600) and raw_ms < 1000 it could be seconds.
            # Prefer ms: convert to seconds, clamp.
            timeout_s = raw_ms / 1000.0 if raw_ms > 1000 else float(raw_ms)
            # Also accept if timeoutMs was passed as seconds directly (e.g. 120) -> 120s
            if timeout_s < 1:
                timeout_s = 1
            timeout_s = min(timeout_s, MAX_CMD_TIME)
            started = time.monotonic()
            result = run(script, int(timeout_s) if timeout_s < 3600 else 3600)
            result["durationMs"] = int((time.monotonic() - started) * 1000)
            return self._json(200, result)

        if route in ("/api/create", "/create"):
            command = body.get("command", "")
            if not isinstance(command, str) or not command.strip():
                return self._json(400, {"error": "command required"})
            title = body.get("title")
            # generate title if missing but keep validation
            if not isinstance(title, str) or not title.strip():
                # generate fallback like worker-abc123
                import random, string
                title = "worker-" + "".join(random.choices(string.hexdigits.lower(), k=6))
            title = title.strip()
            if not TITLE_RE.fullmatch(title):
                return self._json(400, {"error": "bad title (1-64 chars, A-Z a-z 0-9 . _ -)"})
            # duplicate check: if worker dir exists and alive, reject with 409
            existing = _worker_status(title)
            if existing["alive"]:
                return self._json(409, {"error": f"title '{title}' already running", "worker": existing})
            log_path = f"{WORKERS_DIR}/{title}/console.log"
            try:
                os.makedirs(os.path.dirname(log_path), exist_ok=True)
                # truncate log if stale dead worker
                if not existing["alive"]:
                    try:
                        open(log_path, "w").close()
                    except Exception:
                        pass
            except Exception:
                log_path = "/dev/null"
            e = dict(os.environ)
            e["DISPLAY"] = DISPLAY
            started_at = time.time()
            with open(log_path, "ab") as f:
                p = subprocess.Popen(
                    ["bash", "-c", command],
                    stdin=subprocess.DEVNULL, stdout=f, stderr=f,
                    env=e, start_new_session=True,
                )
            _write_worker_meta(title, {"pid": p.pid, "command": command, "title": title, "startedAt": started_at, "log": log_path})
            # optional wait for window
            wait_ms = _clamp(_int(body.get("waitMs", body.get("waitForMs", 0)), 0), 0, 15000)
            window_found = False
            if wait_ms > 0:
                deadline = time.monotonic() + wait_ms / 1000.0
                while time.monotonic() < deadline:
                    if _window_ids_for_title(title):
                        window_found = True
                        break
                    time.sleep(0.25)
            else:
                # quick check without waiting
                window_found = bool(_window_ids_for_title(title))
            return self._json(200, {"pid": p.pid, "log": log_path, "title": title, "startedAt": started_at, "command": command, "windowFound": window_found, "meta": _meta_path(title)})

        if route in ("/api/kill", "/kill"):
            title = str(body.get("title", body.get("name", "")))
            if not TITLE_RE.fullmatch(title):
                return self._json(400, {"error": "bad title"})
            signal_mode = str(body.get("signal", body.get("sig", "auto")))
            wait_ms = body.get("waitMs", body.get("timeoutMs", 2000))
            clean = bool(body.get("clean", body.get("remove", False)))
            res = _kill_title_detailed(title, signal_mode, wait_ms, clean)
            # keep simple ok:true for backward compat, but include details
            return self._json(200, res)

        if route in ("/api/killAll", "/killAll", "/api/kill/all", "/kill/all", "/api/killall"):
            prefix = str(body.get("prefix", body.get("titlePrefix", "")) or "")
            # also allow title as prefix filter via title field
            if not prefix:
                prefix = str(body.get("title", "") or "")
            clean = bool(body.get("clean", body.get("remove", False)))
            # also support filter via query? body only for POST
            res = _kill_all(prefix, clean)
            return self._json(200, res)

        if route in ("/api/system", "/system"):
            action = str(body.get("action", "")).strip().lower()
            if action in ("killall", "kill_all", "nuke", "kill-all"):
                prefix = str(body.get("prefix", "") or "")
                clean = bool(body.get("clean", True))
                res = _kill_all(prefix, clean)
                return self._json(200, {"ok": res["ok"], "action": "killAll", **res})
            if action in ("clean", "gc", "prune"):
                # remove dead worker dirs
                workers = list_workers()
                removed: list[str] = []
                for w in workers:
                    if not w["alive"] and not w["windowFound"]:
                        try:
                            import shutil
                            target = _worker_dir(w["title"])
                            if os.path.commonpath([target, WORKERS_DIR]) == WORKERS_DIR:
                                shutil.rmtree(target, ignore_errors=True)
                                removed.append(w["title"])
                        except Exception:
                            pass
                return self._json(200, {"ok": True, "action": "clean", "removed": removed, "count": len(removed)})
            if action in ("info", "status"):
                return self._json(200, {"ok": True, "action": "info", **_system_info()})
            if action in ("reset", "reboot", "restart"):
                # soft reset: kill all + clear shots/recordings optionally
                clean_ws = bool(body.get("cleanWorkspace", False))
                res = _kill_all("", True)
                if clean_ws:
                    try:
                        import shutil, glob as _glob
                        for pat in [f"{WORKSPACE}/shot-*.png", f"{WORKSPACE}/.workers/*/console.log"]:
                            for fpath in _glob.glob(pat):
                                try:
                                    os.remove(fpath)
                                except Exception:
                                    pass
                    except Exception:
                        pass
                return self._json(200, {"ok": True, "action": "reset", "killed": res.get("killed", []), "note": "all workers killed; workspace cleaned" if clean_ws else "all workers killed"})
            return self._json(400, {"error": "unknown system action (expected killAll|clean|reset|info)"})

        if route in ("/api/workers", "/workers") and self.command == "POST":
            # listing via POST as well (some SDKs use POST)
            workers = list_workers()
            return self._json(200, {"workers": workers, "count": len(workers)})

        if route in ("/api/ps", "/ps") and self.command == "POST":
            snap = _ps_snapshot()
            return self._json(200, snap)

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
            # also support detailed via body flag
            if body.get("detail") or body.get("detailed"):
                snap = _ps_snapshot()
                return self._json(200, {"windows": names, "detailed": snap["windows"]})
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

        # -------------------------------------------------------------------
        # Recording — daemon-native so callers don't need shell via /api/cmd
        # -------------------------------------------------------------------
        if route in ("/api/record/capture", "/record/capture"):
            sid = body.get("sessionId") or body.get("session_id") or body.get("id") or ""
            quality = body.get("quality", 70)
            res = capture_frame(sid, quality)
            return self._json(200 if res.get("ok") else 400, res)

        if route in ("/api/record/build", "/record/build", "/api/recording/build", "/recording/build"):
            sid = body.get("sessionId") or body.get("session_id") or body.get("id") or ""
            res = build_recording(sid)
            return self._json(200, res)

        if route in ("/api/record", "/record"):
            # POST variant — build by body instead of query
            sid = body.get("sessionId") or body.get("session_id") or body.get("id") or ""
            if not sid:
                return self._json(400, {"error": "sessionId required"})
            res = build_recording(sid)
            return self._json(200, res)

        # -------------------------------------------------------------------
        # Share — unified screenshot / recording endpoint (what the chat shows)
        # -------------------------------------------------------------------
        if route in ("/api/share", "/share"):
            what = body.get("what", "")
            sid = body.get("sessionId") or body.get("session_id") or body.get("id") or ""
            label = body.get("label", "")
            res = do_share(what, sid, label)
            return self._json(200 if res.get("ok") else 400, res)

        # Back-compat aliases for share
        if route in ("/api/share/screenshot", "/share/screenshot"):
            label = body.get("label", "")
            res = do_share("screenshot", "", label)
            return self._json(200 if res.get("ok") else 500, res)
        if route in ("/api/share/recording", "/share/recording"):
            sid = body.get("sessionId") or body.get("session_id") or body.get("id") or ""
            label = body.get("label", "")
            res = do_share("recording", sid, label)
            return self._json(200 if res.get("ok") else 400, res)

        self._json(404, {"error": "not found"})


class ApiServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    server = ApiServer(("0.0.0.0", PORT), Handler)
    log(f"listening on 0.0.0.0:{PORT} (display {DISPLAY}) v{VERSION} workers={WORKERS_DIR}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
