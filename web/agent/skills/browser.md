---
description: Driving Chromium on the desktop — launching it cleanly, the address bar, and when to skip the browser entirely.
---

# Browser work

## Launching

`app` with `do:'launch'`, a `chromium <url>` command, and a unique title:

```
app  { do: "launch", command: "chromium https://example.com", title: "shop" }
```

The SDK appends an isolated `--user-data-dir` derived from the title, so every
instance starts clean and `app { do: "kill", title: "shop" }` finds it later.
Don't add `--user-data-dir` yourself unless you want to reuse a profile.

The `chromium` on PATH is a wrapper that already passes `--no-sandbox
--disable-dev-shm-usage --no-first-run`, which it needs to run in this container.
The wrapper supplies the flags needed to run Chromium as root in the container.

Chromium window titles usually contain `Chromium`; match the window title rather
than the app's launch title.

```
computer { actions: [
  { do: "wait_for", window: "Chromium", timeoutMs: 45000 },
  { do: "focus", window: "Chromium" }
]}
```

## Navigating

The window opens maximized on the 1600x900 screen. The address bar sits around
`y≈61`, spanning most of the width — `x≈640` is a safe click point. `ctrl+l`
focuses it without a click and is more reliable, so prefer:

```
computer { actions: [
  { do: "focus",  window: "Chromium" },
  { do: "key",    keys: "ctrl+l" },
  { do: "type",   text: "example.com" },
  { do: "key",    keys: "Return" },
  { do: "wait",   ms: 2500 }
]}
```

Use `paste` instead of `type` for long URLs — it's one clipboard write plus
ctrl+v regardless of length.

Useful keys: `ctrl+l` address bar, `ctrl+t` new tab, `ctrl+w` close tab,
`ctrl+r` reload, `ctrl+f` find, `F11` fullscreen, `ctrl+minus` / `ctrl+plus`
zoom (zooming out fits more of a long page into one `observe`).

Then `observe` to see where you landed. A page that renders as a blank white
canvas usually just hasn't finished loading — wait and observe again before
concluding something is wrong.

## When not to use a browser

If you only need the *content* of a URL, don't open Chromium at all — one `cmd`
is faster and costs nothing visually:

```
cmd  { command: "curl -fsSL https://example.com | head -c 2000" }
```

Use the browser when the task is about the browser: something needs to be
clicked, a login has to happen, JavaScript has to run, or the user asked to
*see* a page.
