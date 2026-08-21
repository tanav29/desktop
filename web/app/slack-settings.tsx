"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ExternalLink, Hash, Loader2, Trash2, X } from "lucide-react";

/**
 * Slack settings dialog — paste a bot token + signing secret and eve is
 * reachable from Slack without touching env vars. Credentials are validated
 * against `auth.test` before saving and apply immediately (the channel
 * re-reads them per call).
 */

interface SlackStatus {
  source: "saved" | "env" | "none";
  saved: { botTokenMasked: string | null; signingSecretSet: boolean };
  env: { botTokenSet: boolean; signingSecretSet: boolean };
  effective: { botTokenMasked: string | null; signingSecretSet: boolean };
}

const SOURCE_LABEL: Record<SlackStatus["source"], { text: string; dot: string }> = {
  saved: { text: "configured from this page", dot: "bg-emerald-400" },
  env: { text: "configured from environment", dot: "bg-sky-400" },
  none: { text: "not configured", dot: "bg-zinc-600" },
};

export function SlackSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<SlackStatus | null>(null);
  const [botToken, setBotToken] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Client-only: null during SSR/prerender, set once on mount.
  const [origin, setOrigin] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    setOrigin(`${window.location.protocol}//${window.location.host}`);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/slack", { cache: "no-store" });
      setStatus((await res.json()) as SlackStatus);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setMessage(null);
      void load();
    }
  }, [open, load]);

  if (!open) return null;

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken, signingSecret }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        tested?: boolean;
        team?: string | null;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setMessage({ kind: "err", text: data.error ?? "Save failed" });
      } else {
        setBotToken("");
        setSigningSecret("");
        setMessage({
          kind: "ok",
          text: data.team
            ? `Connected — workspace “${data.team}” verified`
            : "Saved (no token to verify yet)",
        });
        await load();
      }
    } catch (err) {
      setMessage({ kind: "err", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setSaving(true);
    try {
      await fetch("/api/settings/slack", { method: "DELETE" });
      setBotToken("");
      setSigningSecret("");
      setMessage({ kind: "ok", text: "Saved credentials removed" });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const source = status ? SOURCE_LABEL[status.source] : null;

  // Slack's Event API needs a public HTTPS URL — localhost won't do.
  const isLocal =
    origin === null ||
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
  const port = (() => {
    try {
      return (origin ? new URL(origin).port : "") || "3000";
    } catch {
      return "3000";
    }
  })();
  const webhookUrl = origin && !isLocal ? `${origin}/eve/v1/slack` : null;

  const copyWebhook = async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — user can select the text manually */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-11 items-center justify-between border-b border-zinc-800/80 px-4">
          <span className="flex items-center gap-2 font-mono text-[11px] text-zinc-400">
            <Hash className="size-3.5" />
            slack settings
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800/60 hover:text-zinc-200"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="max-h-[80vh] space-y-4 overflow-y-auto px-4 py-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            Connect your Slack app so you can @mention eve from any channel.
            Saved credentials override env vars and apply instantly. Full setup:
            <span className="text-zinc-300"> docs/slack-setup.md</span>.
          </p>

          <div className="space-y-1.5">
            <label className="font-mono text-[11px] text-zinc-500" htmlFor="slack-token">
              bot token <span className="text-zinc-600">(xoxb-…)</span>
            </label>
            <Input
              id="slack-token"
              type="password"
              autoComplete="off"
              placeholder={status?.effective.botTokenMasked ?? "xoxb-…"}
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              className="border-zinc-800 bg-zinc-900/40 font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <label className="font-mono text-[11px] text-zinc-500" htmlFor="slack-secret">
              signing secret
            </label>
            <Input
              id="slack-secret"
              type="password"
              autoComplete="off"
              placeholder={status?.effective.signingSecretSet ? "••••••••" : "from Basic Information"}
              value={signingSecret}
              onChange={(e) => setSigningSecret(e.target.value)}
              className="border-zinc-800 bg-zinc-900/40 font-mono text-xs"
            />
          </div>

          {/* ── where do I find these? ──────────────────────── */}
          <div className="overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-900/40">
            <button
              type="button"
              onClick={() => setHelpOpen((o) => !o)}
              className="flex w-full items-center justify-between px-3 py-2 text-left font-mono text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800/50"
            >
              where do I find these?
              <ChevronDown
                className={`size-3.5 shrink-0 text-zinc-500 transition-transform ${helpOpen ? "rotate-180" : ""}`}
              />
            </button>
            {helpOpen && (
              <ol className="space-y-3 border-t border-zinc-800/80 px-3 py-3 text-xs leading-relaxed text-zinc-400">
                <li className="flex gap-2.5">
                  <span className="font-mono text-[11px] text-amber-400">1</span>
                  <span>
                    <b className="text-zinc-200">Create the app.</b>{" "}
                    <a
                      href="https://api.slack.com/apps"
                      target="_blank"
                      rel="noreferrer"
                      className="inline items-center gap-0.5 text-amber-400 underline-offset-2 hover:underline"
                    >
                      api.slack.com/apps <ExternalLink className="inline size-3" />
                    </a>{" "}
                    → <i>Create New App</i> → <i>From scratch</i> → name it{" "}
                    <code className="rounded bg-zinc-800 px-1 font-mono text-[11px]">eve</code> and
                    pick your workspace.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="font-mono text-[11px] text-amber-400">2</span>
                  <span>
                    <b className="text-zinc-200">Get the bot token.</b> Left sidebar →{" "}
                    <i>OAuth &amp; Permissions</i> → <i>Bot Token Scopes</i> →{" "}
                    <i>Add an OAuth Scope</i>, add these four:
                    <span className="mt-1 flex flex-wrap gap-1">
                      {["app_mentions:read", "chat:write", "files:write", "im:history"].map((s) => (
                        <code
                          key={s}
                          className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[10px] text-zinc-300"
                        >
                          {s}
                        </code>
                      ))}
                    </span>
                    Then scroll to the top and hit <i>Install to Workspace</i> — copy the{" "}
                    <b className="text-zinc-200">Bot User OAuth Token</b> (
                    <code className="font-mono text-[11px]">xoxb-…</code>). That goes in the first
                    field.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="font-mono text-[11px] text-amber-400">3</span>
                  <span>
                    <b className="text-zinc-200">Get the signing secret.</b> Left sidebar →{" "}
                    <i>Basic Information</i> → <i>App Credentials</i> → copy the{" "}
                    <b className="text-zinc-200">Signing Secret</b>. That goes in the second field.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="font-mono text-[11px] text-amber-400">4</span>
                  <span>
                    <b className="text-zinc-200">Point Slack at eve.</b> Left sidebar →{" "}
                    <i>Event Subscriptions</i> → toggle on → paste the webhook URL as the{" "}
                    <i>Request URL</i> (on localhost? grab a tunnel first — see the amber note
                    below) → <i>Subscribe to bot events</i> → add{" "}
                    <code className="rounded bg-zinc-800 px-1 font-mono text-[10px] text-zinc-300">
                      app_mention
                    </code>{" "}
                    (and{" "}
                    <code className="rounded bg-zinc-800 px-1 font-mono text-[10px] text-zinc-300">
                      message.im
                    </code>{" "}
                    for DMs). Save, reinstall if prompted — then @mention eve in any channel.
                  </span>
                </li>
              </ol>
            )}
          </div>

          {message && (
            <div
              className={
                message.kind === "ok"
                  ? "rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300"
                  : "rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
              }
            >
              {message.text}
            </div>
          )}

          {source && (
            <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-500">
              <span className={`size-1.5 rounded-full ${source.dot}`} />
              {source.text}
              {status?.effective.botTokenMasked && (
                <span className="text-zinc-600">· token {status.effective.botTokenMasked}</span>
              )}
            </div>
          )}

          {isLocal ? (
            <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-500">
              <p>
                <span className="text-amber-400">app is on localhost</span> — Slack can&apos;t
                reach your machine directly. Expose it with a tunnel:
              </p>
              <div className="mt-1.5 space-y-1">
                <code className="block rounded bg-zinc-900 px-2 py-1 text-zinc-300">
                  ngrok http {port}
                </code>
                <code className="block rounded bg-zinc-900 px-2 py-1 text-zinc-300">
                  cloudflared tunnel --url http://localhost:{port}
                </code>
              </div>
              <p className="mt-1.5">
                then use{" "}
                <span className="text-amber-400">
                  https://&lt;tunnel-url&gt;/eve/v1/slack
                </span>{" "}
                as the Request URL in step 4.
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void copyWebhook()}
              title="click to copy"
              className="block w-full rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-2 text-left font-mono text-[11px] leading-relaxed text-zinc-500 transition-colors hover:border-zinc-700"
            >
              webhook URL for Slack Event Subscriptions:
              <br />
              <span className="text-amber-400">{webhookUrl}</span>
              <span className="text-zinc-600">{copied ? " — copied ✓" : " — click to copy"}</span>
            </button>
          )}

          <div className="flex items-center justify-between pt-1">
            {status?.source === "saved" ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void disconnect()}
                disabled={saving}
                className="text-zinc-500 hover:text-red-300"
              >
                <Trash2 data-icon="inline-start" className="size-3" />
                remove saved
              </Button>
            ) : (
              <span />
            )}
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={saving || (!botToken && !signingSecret)}
              className="bg-amber-400 text-zinc-950 hover:bg-amber-300"
            >
              {saving ? <Loader2 data-icon="inline-start" className="size-3 animate-spin" /> : null}
              save &amp; verify
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
