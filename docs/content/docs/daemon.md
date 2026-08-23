---
title: Daemon API
description: The in-container HTTP control plane — endpoints, actions vocabulary, and security model.
---

The daemon (`daemon/daemon.py`) is the computer's control plane: a small HTTP
server written with the Python standard library only, started by the entrypoint,
listening on `0.0.0.0:8095` (override with `API_PORT`). It handles shell quoting
and process-group cleanup for you, so callers never wrangle either.

Every SDK method is a thin wrapper over one of these endpoints — anything the
SDK can do, raw `fetch()` can do too.

## Security

> **This is a root shell over the network** — same trust level as
> `docker exec`. Keep it reachable only from your own machine (the default:
> only port 8095 is published, bound to your localhost).

## Endpoints

All JSON unless noted.

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/api/health` | — | `{"ok": true, "display": ":99"}` · 503 when X is down |
| POST | `/api/cmd` | `{"cmd", "timeoutMs"?}` | `{"exit", "stdout", "stderr"}` |
| POST | `/api/create` | `{"command", "title"?}` | `{"pid", "log"}` |
| POST | `/api/kill` | `{"title"}` | `{"ok": true}` |
| POST | `/api/actions` | `{"actions": [...]}` | `{"ok", "failedAt"?, "steps", "state"}` |
| POST | `/api/type` | `{"text", "delayMs"?}` | `{"exit", "stdout", "stderr"}` |
| POST | `/api/key` | `{"keys"}` | `{"exit", "stdout", "stderr"}` |
| POST | `/api/mouse` | `{"x", "y"}` | `{"exit", "stdout", "stderr"}` |
| POST | `/api/click` | `{"button"?, "x"?, "y"?}` | `{"exit", "stdout", "stderr"}` |
| POST | `/api/windows` | `{}` | `{"windows": ["Name", ...]}` |
| POST | `/api/screenshot` | `{"name"?}` | `{"path", "exit", "stdout", "stderr"}` |
| GET | `/api/observe` | `?width=&quality=` | `image/jpeg` bytes |
| GET | `/api/pointer` | — | `{"x", "y", "click": {"x","y","button","at"}}` |

## `POST /api/actions`

The primary control surface. The daemon runs a whole input sequence in-container
and answers once — one round-trip per *task*, not per keystroke. The SDK's
`mouse`/`click`/`type`/`key` helpers are one-element calls into it.

```bash
curl -sX POST localhost:8095/api/actions -H 'content-type: application/json' -d '{
  "actions": [
    {"do": "wait_for", "window": "Chromium", "timeoutMs": 20000},
    {"do": "focus",    "window": "Chromium"},
    {"do": "key",      "keys": "ctrl+l"},
    {"do": "type",     "text": "example.com"},
    {"do": "key",      "keys": "Return"},
    {"do": "wait",     "ms": 2500}
  ]}'
```

### Vocabulary

| `do` | Args | Notes |
|---|---|---|
| `move` | `x, y` | Absolute pointer move |
| `click` | `button=1, x?, y?, count=1` | Moves first when `x`/`y` given |
| `drag` | `x1, y1, x2, y2` | Hops through the midpoint so motion-watching apps see it |
| `scroll` | `dir: up\|down, amount=3` | Wheel buttons 4/5 |
| `type` | `text, delayMs=12` | Real keystrokes |
| `key` | `keys, count=1` | xdotool key syntax (`ctrl+shift+t`) |
| `paste` | `text` | Clipboard + `ctrl+v`; length-independent |
| `focus` | `window` | search → `windowactivate --sync` |
| `wait` | `ms` | Sleep between steps |
| `wait_for` | `window, timeoutMs=15000` | Polls in-container — no round-trips |

Limits: max **32 actions** per call, **120 s** total budget.

Execution stops at the first failure and the response says exactly where:

```json
{"ok": false, "failedAt": 3,
 "steps": [{"i": 0, "do": "focus", "ok": true}, "...",
           {"i": 3, "do": "click", "ok": false, "note": "..."}],
 "state": {"pointer": [812, 61], "focused": "Chromium"}}
```

Free text (`text`, `window`) reaches xdotool through environment variables,
never interpolated into a shell string — payloads containing `$(…)`, backticks
or quotes are typed literally rather than executed.

## Pointer state

`GET /api/pointer` returns where the pointer *actually* is plus the last click.
Xvfb has no hardware cursor, so a VNC viewer cannot show it — this endpoint is
the only way to know, and it's what overlays draw on top of live views.

## Health checks that don't lie

`GET /api/health` probes the real X display (`xdpyinfo`) and returns 503 when
it's down — a static noVNC page alone is not proof of a working desktop.

```bash
curl -sf http://localhost:8095/api/health && echo online
```
