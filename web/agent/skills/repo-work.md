---
description: Working on a git repository in /workspace — clone, explore, edit, verify, commit, and how to get a PR open without gh.
---

# Repo work

Everything here runs through `cmd`. There are no dedicated git tools; git is just
a program in the container.

## Clone

```
cmd  { command: "rm -rf /workspace/repo && git clone --depth 50 https://github.com/OWNER/NAME /workspace/repo" }
```

Add `--branch <name>` for a non-default branch. Clone shallow unless the task
needs history — a deep clone of a large repo is slow and buys nothing. If the
user didn't name a repo, `ask_question` rather than guessing.

## Explore

`ripgrep` is installed; use it instead of `grep -r`.

```
cmd  { command: "cd /workspace/repo && rg -n 'symbolName' --glob '!node_modules' | head -40" }
cmd  { command: "cd /workspace/repo && sed -n '1,80p' src/thing.ts" }
```

Always cap output (`| head -n`, `sed -n 'A,Bp'`). A dumped file is context spent
for the rest of the session.

## Edit

Heredocs for whole files, `python3` for surgical changes:

```
cmd  { command: "cat > /workspace/repo/src/new.ts <<'EOF'\n...\nEOF" }
```

Quote the heredoc marker (`<<'EOF'`) so the shell doesn't expand `$` or
backticks inside your code. For an in-place edit, prefer a python one-liner over
`sed` — it fails loudly instead of silently matching nothing:

```
cmd  { command: "cd /workspace/repo && python3 - <<'EOF'\nimport pathlib\np = pathlib.Path('src/thing.ts')\ns = p.read_text()\nassert 'old' in s, 'pattern not found'\np.write_text(s.replace('old', 'new'))\nEOF" }
```

## Verify

Run whatever the repo actually uses. Check first — `package.json` scripts,
`Makefile`, `Cargo.toml`, `pyproject.toml`:

```
cmd  { command: "cd /workspace/repo && cat package.json | head -40" }
```

Then run its tests. Report a failure as a failure; don't commit over it without
saying so.

## Commit

```
cmd  { command: "cd /workspace/repo && git checkout -b fix/short-slug && git add -A && git commit -m 'Fix the thing' && git rev-parse --short HEAD" }
```

If the branch already exists, `git checkout -b` fails — use
`git checkout -b B || git checkout B`. Set an identity once if git complains
about `user.email`:

```
cmd  { command: "cd /workspace/repo && git config user.email agent@localhost && git config user.name eve" }
```

## Pull request

The slim image has no `gh` CLI, by design. Push if the container has credentials:

```
cmd  { command: "cd /workspace/repo && git push -u origin HEAD" }
```

If push fails on auth, say so plainly and give the user the branch name and
commit — they can push or open the PR themselves. Don't try to work around
missing credentials.

## What to say at the end

Where the repo is (`/workspace/repo`), the branch, what changed, whether the
tests passed, and — if it isn't pushed — that the commit is local.
