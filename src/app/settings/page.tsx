"use client";

import { useEffect, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CautionZone } from "@/components/caution-zone";
import { cn } from "@/lib/utils";
import {
  Bell,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plug,
  RefreshCw,
  ShieldCheck,
  Trash2,
  type LucideProps,
} from "lucide-react";

type FieldDef = {
  key: "hardcoverApiKey" | "webhookUrl" | "gotifyUrl" | "gotifyToken";
  label: string;
  placeholder: string;
  help: string;
  /** Secrets are masked and can't be read back. Plain values (like a server URL) are shown. */
  secret?: boolean;
};

type ToggleDef = {
  key: "alertEbook" | "alertAudiobook" | "alertScheduled";
  label: string;
  help: string;
  defaultOn: boolean;
};

type SelectDef = {
  key: "recheckInterval";
  label: string;
  help: string;
  options: { value: string; label: string }[];
  defaultValue: string;
};

type Section = {
  id: string;
  title: string;
  description: string;
  icon: ComponentType<LucideProps>;
  fields?: FieldDef[];
  select?: SelectDef;
  toggles?: ToggleDef[];
  /** Adds a "Test" button that calls this endpoint. */
  test?: { endpoint: string; label: string };
};

const SECTIONS: Section[] = [
  {
    id: "hardcover",
    title: "Hardcover",
    description: "Powers book search, covers, release dates and the See details links.",
    icon: KeyRound,
    test: { endpoint: "/api/settings/test", label: "Test connection" },
    fields: [
      {
        key: "hardcoverApiKey",
        label: "API token",
        placeholder: "Paste your Hardcover token",
        help: "Create one in your Hardcover account's API settings.",
      },
    ],
  },
  {
    id: "recheck",
    title: "Automatic re-check",
    description: "Re-checks every linked book on a schedule, so you don't have to press Re-check.",
    icon: RefreshCw,
    select: {
      key: "recheckInterval",
      label: "How often",
      help: "Runs in the background while the app is running.",
      options: [
        { value: "daily", label: "Every day" },
        { value: "weekly", label: "Every 7 days" },
        { value: "monthly", label: "Every month (30 days)" },
        { value: "quarterly", label: "Every 3 months (90 days)" },
      ],
      defaultValue: "monthly",
    },
  },
  {
    id: "notifications",
    title: "Notifications",
    description: "Gotify push alerts for releases and scheduled re-checks.",
    icon: Bell,
    test: { endpoint: "/api/settings/test-gotify", label: "Send test" },
    toggles: [
      {
        key: "alertEbook",
        label: "Alert when an ebook becomes available",
        help: "Sent once per book, when Hardcover first lists an ebook for a released book.",
        defaultOn: true,
      },
      {
        key: "alertAudiobook",
        label: "Alert when an audiobook becomes available",
        help: "Sent once per book, when an audiobook is found on Hardcover or Apple Books.",
        defaultOn: true,
      },
      {
        key: "alertScheduled",
        label: "Send a summary after each scheduled re-check",
        help: "A short message with how many books were checked and what's new.",
        defaultOn: false,
      },
    ],
    fields: [
      {
        key: "gotifyUrl",
        label: "Gotify server URL",
        placeholder: "https://gotify.example.com",
        help: "Your Gotify server address. Stored encrypted.",
      },
      {
        key: "gotifyToken",
        label: "Gotify application token",
        placeholder: "Create an application in Gotify and paste its token",
        help: "Stored encrypted. Create it under Apps in the Gotify web UI.",
      },
      {
        key: "webhookUrl",
        label: "Webhook URL",
        placeholder: "https://ntfy.sh/your-topic or a Discord webhook",
        help: "Saved for the webhook endpoint. Not used for alerts yet. Stored encrypted because it often contains a token.",
      },
    ],
  },
];

type Status = { key: string; isSet: boolean; masked: string | null };
type TestResult = { ok: boolean; message: string };

function SecretField({
  field,
  status,
  onSaved,
}: {
  field: FieldDef;
  status: Status | undefined;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function save() {
    const value = draft.trim();
    if (!value) return;
    setBusy("save");
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: field.key, value }),
      });
      if (!res.ok) throw new Error();
      setDraft("");
      setReveal(false);
      setMessage({ tone: "ok", text: "Saved and encrypted." });
      onSaved();
    } catch {
      setMessage({ tone: "error", text: "Could not save. Try again." });
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    setBusy("clear");
    setMessage(null);
    try {
      await fetch(`/api/settings?key=${encodeURIComponent(field.key)}`, { method: "DELETE" });
      setMessage({ tone: "ok", text: "Cleared." });
      onSaved();
    } finally {
      setBusy(null);
    }
  }

  const isSet = !!status?.isSet;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={field.key} className="text-sm font-medium">
          {field.label}
        </label>
        {isSet ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-mono text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-3 w-3" />
            Saved {status?.masked}
          </span>
        ) : (
          <span className="rounded-full border border-dashed px-2.5 py-0.5 text-xs text-muted-foreground">
            Not set
          </span>
        )}
      </div>

      <div className="relative">
        <Input
          id={field.key}
          type={reveal || field.secret === false ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          placeholder={isSet ? "Enter a new value to replace the saved one" : field.placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
          className="pr-10"
        />
        {field.secret !== false && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={reveal ? "Hide value" : "Show value"}
          >
            {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-xs text-muted-foreground">{field.help}</p>
        {isSet && (
          <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)} disabled={busy !== null} className="gap-1.5 text-muted-foreground">
            {busy === "clear" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Clear
          </Button>
        )}
        <Button size="sm" onClick={save} disabled={busy !== null || !draft.trim()}>
          {busy === "save" ? "Saving…" : isSet ? "Replace" : "Save"}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={`Clear the saved ${field.label.toLowerCase()}?`}
        description="The value is removed from this machine. You can save a new one at any time."
        confirmLabel="Clear"
        busy={busy === "clear"}
        onConfirm={async () => {
          setConfirmClear(false);
          await clear();
        }}
      />

      {message && (
        <p className={cn("text-xs", message.tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
          {message.text}
        </p>
      )}
    </div>
  );
}

/** Saves one plain (non-secret) setting immediately, e.g. a toggle or a dropdown. */
async function saveSetting(key: string, value: string): Promise<boolean> {
  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  return res.ok;
}

function ToggleRow({
  def,
  on,
  onChange,
}: {
  def: ToggleDef;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-4">
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{def.label}</span>
        <span className="block text-xs text-muted-foreground">{def.help}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={(e) => {
          e.preventDefault();
          onChange(!on);
        }}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          on ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 rounded-full bg-background shadow transition-transform",
            on ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </button>
    </label>
  );
}

export default function SettingsPage() {
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [tests, setTests] = useState<Record<string, TestResult | "running" | undefined>>({});

  async function loadStatus() {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const rows: Status[] = await res.json();
      setStatus(Object.fromEntries(rows.map((r) => [r.key, r])));
    } catch {
      setStatus({});
    }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((rows: Status[]) => {
        if (active) setStatus(Object.fromEntries(rows.map((r) => [r.key, r])));
      })
      .catch(() => {
        if (active) setStatus({});
      });
    return () => {
      active = false;
    };
  }, []);

  async function runTest(sectionId: string, endpoint: string) {
    setTests((t) => ({ ...t, [sectionId]: "running" }));
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const body: TestResult = await res.json();
      setTests((t) => ({ ...t, [sectionId]: body }));
    } catch {
      setTests((t) => ({ ...t, [sectionId]: { ok: false, message: "Could not run the test." } }));
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Connections and keys for this tracker.</p>
      </div>

      <div className="flex items-start gap-3 rounded-xl border bg-card p-4 text-sm">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div className="space-y-0.5">
          <p className="font-medium">Stored on this machine only</p>
          <p className="text-muted-foreground">
            Secrets are encrypted in your local database. Once saved, they are never shown in full, and this page only
            ever gets a masked version. The <code className="font-mono text-xs">data/</code> folder also holds the key that
            decrypts them, so back it up as one unit.
          </p>
        </div>
      </div>

      {SECTIONS.map((section) => {
        const Icon = section.icon;
        return (
          <section key={section.id} className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <header className="flex items-start justify-between gap-4 border-b bg-muted/40 px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background shadow-sm ring-1 ring-border">
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="font-semibold">{section.title}</h2>
                  <p className="text-sm text-muted-foreground">{section.description}</p>
                </div>
              </div>
              {section.test && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => runTest(section.id, section.test!.endpoint)}
                  disabled={tests[section.id] === "running"}
                  className="shrink-0 gap-2"
                >
                  {tests[section.id] === "running" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plug className="h-3.5 w-3.5" />
                  )}
                  {section.test.label}
                </Button>
              )}
            </header>

            <div className="space-y-6 p-5">
              {(() => {
                const result = tests[section.id];
                if (!section.test || !result || result === "running") return null;
                return (
                  <div
                    role="status"
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                      result.ok
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {result.ok ? <CheckCircle2 className="h-4 w-4" /> : null}
                    {result.message}
                  </div>
                );
              })()}
              {section.select && (
                <div className="space-y-2">
                  <label htmlFor={section.select.key} className="text-sm font-medium">
                    {section.select.label}
                  </label>
                  <select
                    id={section.select.key}
                    value={status[section.select.key]?.masked ?? section.select.defaultValue}
                    onChange={async (e) => {
                      await saveSetting(section.select!.key, e.target.value);
                      await loadStatus();
                    }}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    {section.select.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {section.select.help}
                    {status.lastAutoCheckAt?.masked
                      ? ` Last run: ${new Date(status.lastAutoCheckAt.masked).toLocaleString()}.`
                      : " Not run yet."}
                  </p>
                </div>
              )}

              {section.toggles?.map((t) => {
                const current = status[t.key]?.masked;
                const on = current === undefined || current === null ? t.defaultOn : current === "true";
                return (
                  <ToggleRow
                    key={t.key}
                    def={t}
                    on={on}
                    onChange={async (next) => {
                      await saveSetting(t.key, next ? "true" : "false");
                      await loadStatus();
                    }}
                  />
                );
              })}

              {(section.fields ?? []).map((field) => (
                <SecretField
                  key={field.key}
                  field={field}
                  status={status[field.key]}
                  onSaved={loadStatus}
                />
              ))}
            </div>
          </section>
        );
      })}

      <CautionZone />
    </div>
  );
}
