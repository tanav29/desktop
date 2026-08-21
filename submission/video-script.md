# 5-minute demo video script — "desktop"

Target: ~5:00. Speak at a normal pace; ~750 words total. Record the terminal,
browser, and the desktop pane side by side. Do one dry run of the eve task
before recording so it completes cleanly.

---

## [0:00–0:30] The hook — the problem

**On screen:** a chat window with an AI assistant.

> "AI agents are getting scary smart — but they still live in a chat box.
> Ask one to fix a bug, and it edits files blind. Ask it to use a browser,
> fill a form, run a GUI app — it can't, because giving an agent a *real
> computer* either means heavyweight cloud VMs, or automating your own
> machine and praying.

**Beat.**

> "So I built the thing I wanted to exist."

## [0:30–1:15] What it is — one command

**On screen:** terminal, fresh clone.

> "This is `desktop` — a full Linux desktop that runs entirely inside
> Docker. One command:"
>
> ```bash
> docker compose up -d --build
> ```
>
> "Debian, XFCE, Chromium — capped at two CPUs and three gigs of RAM. When
> it's healthy, here's my desktop, right in the browser through noVNC."
>
> *(open http://localhost:6080/vnc.html — show the desktop)*

> "And everything on it — shell, apps, keyboard, mouse, screen — is exposed
> over plain HTTP by a tiny daemon inside the container. Any model, any
> framework, anything that can call an API can drive this computer."

## [1:15–2:15] The SDK — agents drive it programmatically

**On screen:** editor with the SDK snippet, desktop visible beside it.

> "The TypeScript SDK makes each control one line:"
>
> ```ts
> await computer.cmd("pgrep -f xfce4-session");
> await computer.create("chromium https://example.com", { title: "web-1" });
> await computer.screenshot("state.png");
> await computer.kill("web-1");
> ```
>
> *(run it live — watch Chromium open on the desktop, screenshot appear in
> ./workspace)*

> "Notice the speed — every call is a single HTTP round-trip to a process
> already inside the container, milliseconds per action, not a docker exec
> spawn each time.
>
> Two more things I care about: you can *watch* what the agent sees —
> `live()` streams the screen as motion-JPEG for humans and vision models
> alike — and computers are just ports, so spin up five containers and the
> SDK addresses them like five machines."

## [2:15–3:45] eve — the proof, a real task end-to-end

**On screen:** the web app — chat left, live desktop right. Then Slack.

> "An SDK is only worth something if an agent can build real work on top of
> it. So meet eve — a full operator agent shipping in this repo, with
> nineteen tools: type, click, key, inspect the desktop, git clone, commit…
>
> She works even without a vision model — she reads window state, focus and
> pointer position as text. Give her a vision model and she also sees the
> actual pixels.
>
> Let's give her a real job. Not from this app — from Slack, because that's
> where work asks for help:"
>
> *(type in Slack)* `@eve fix the login bug on github.com/<you>/<repo>`
>
> *(cut back to Slack: progress posts are already landing in the thread —*
> *every tool call with a desktop screenshot attached)*
>
> "And watch the thread — she narrates her own work into Slack as she goes,
> screenshots included. I don't even need the dashboard."
>
> *(now narrate over the live desktop while she works — keep it tight)*
>
> "She clones the repo… reproduces the bug in the browser… finds the cause…
> fixes it… runs the tests… commits… opens a pull request."
>
> *(cut to the Slack thread)*
>
> "And back in the thread: a summary, the PR link, and a recording of her
> whole session — captured automatically while she worked. I watched the
> entire thing happen live, but I never touched the machine."

## [3:45–4:30] Why it's built this way — the role of AI

**On screen:** architecture diagram (README).

> "Quick architecture: the container is just a real X11 desktop. A Python
> stdlib daemon turns HTTP into xdotool, ImageMagick and bash — quoting and
> process cleanup handled. The SDK is a thin client. And eve is a plain
> agent loop over those primitives.
>
> That layering is the point: swap the desktop, keep the daemon. Swap the
> model — Claude, GPT, Gemini, GLM — keep the agent. Nothing here depends on
> one vendor, and nothing runs on my host machine but Docker. When a session
> goes sideways, `docker compose down` and it's like it never happened."

## [4:30–5:00] Close — what's next

> "So: a disposable computer for agents, drivable over HTTP in milliseconds,
> with an agent that already ships real pull requests from a Slack message.
>
> Next I'm building fleet orchestration — many desktops behind one SDK —
> snapshot and restore, and a hosted version.
>
> The repo is github.com/tanav29/[desktop] — README, setup docs, and the
> whole stack are public. I'm Tanav — if this sounds like the kind of
> builder Razorpay wants, let's talk."

---

### Recording checklist

- [ ] Fresh `docker compose down && up -d --build` before recording (clean boot shot)
- [ ] Pre-seed the bug-fix repo so eve's run takes ≤90 s on camera
- [ ] Terminal font size up; browser zoom ~110%
- [ ] Show workspace/state.png landing on host — nice "it's just files" moment
- [ ] Record at 1080p; upload to YouTube (unlisted) + link in README and form
