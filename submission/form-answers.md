# Razorpay AI Builders — application answers

Fill the form at https://razorpay.com/ai-builders/ — paste from below.
Replace every `[bracketed]` placeholder before submitting.

---

## Project name

**desktop** — a computer-use environment for agents

## One-liner

A lightweight Linux desktop that runs entirely inside Docker and exposes
shell, GUI, browser, keyboard, mouse and screen over plain HTTP — so any AI
agent can operate a real computer, safely, in seconds.

## Project description

Computer-use agents are stuck between bad options: heavyweight proprietary
VM sandboxes, or automating a real machine where one bad command is
catastrophic. `desktop` is the middle path — a full Debian 13 + XFCE +
Chromium desktop inside one Docker container (capped at 2 CPU / 3 GB),
booted with `docker compose up`, reset by throwing the container away.

Every control surface is an HTTP endpoint served by an in-container daemon:
run shell commands, launch and kill apps, move the mouse, type, click,
screenshot, and stream the screen as live MJPEG. A TypeScript SDK
(`computer-use-sdk`) wraps it all; because each call is one round-trip to a
process already running, actions cost milliseconds instead of ~150 ms+
`docker exec` spawns.

To prove the stack, the repo ships **eve** — a complete operator agent with
21 tools that takes tasks in a web UI chat, works on the desktop while you
watch it live in the browser, and finishes real GitHub workflows end-to-end:
clone → reproduce → fix → test → commit → open PR, with a summary, PR link,
inline screenshots and a session recording posted straight into the chat.

- GitHub: https://github.com/tanav29/desktop
- Demo video: [add link]
- Live desktop viewer: noVNC at :6080, MJPEG feed via SDK

## The problem it solves

AI agents can reason about code but can't touch the GUI world where most
work happens — browsers, terminals, IDEs, desktop apps. Existing
computer-use infrastructure is either locked into a vendor's cloud VM or
requires automating your actual machine. Developers need a sandbox that is
cheap, disposable, fast per-action, and model-agnostic.

## Role of AI

eve is an LLM-driven operator agent: it plans, calls desktop tools
(type/click/key/screenshot/inspect), reads textual desktop state when the
model has no vision, recovers from failed actions by re-inspecting, and
completes multi-step engineering tasks autonomously. The same SDK feeds
live JPEG frames to any vision model (`computer.frames()`), making the
environment usable by Claude, GPT, Gemini, GLM or open models.

## What's built vs. ideas

Shipped and working: containerized desktop image, HTTP daemon (11 endpoints),
TypeScript SDK (npm-consumable), eve agent + Next.js chat UI with live
desktop pane and in-chat screenshots/session recordings, session recording hook.
Next: multi-container fleets behind one SDK, snapshot/restore of desktop
state, and a hosted version.

## Links

- Repo: https://github.com/tanav29/desktop (public)
- Video: [add YouTube/Loom link after recording]

## Personal details

- Name: Tanav Poswal
- [Add: email, phone, college/year if asked, LinkedIn/GitHub profile links]
