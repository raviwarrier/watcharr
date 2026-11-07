"use client";

import { useState } from "react";
import { notify } from "@/components/notify";
import { AlertTriangle, Check, Copy, KeyRound, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";

/** Shows a new secret once, with a copy button. Closing it is the only way out. */
function ShowOnce({
  open,
  title,
  description,
  value,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  value: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the text is selectable.
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-md border bg-muted px-3 py-2 font-mono text-xs select-all">
            {value}
          </code>
          <Button variant="outline" size="sm" onClick={copy} className="shrink-0 gap-1.5">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>I&apos;ve saved it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CautionZone() {
  const [busy, setBusy] = useState<"calendar" | "access" | null>(null);
  const [confirm, setConfirm] = useState<"calendar" | "access" | null>(null);
  // Messages appear as toasts in the bottom-right corner.
  const setMessage = (m: { tone: "ok" | "error"; text: string } | null) => {
    if (m) notify(m.tone, m.text);
  };
  const [newCalendarUrl, setNewCalendarUrl] = useState<string | null>(null);
  const [newAccessKey, setNewAccessKey] = useState<string | null>(null);

  async function rotateCalendar() {
    setBusy("calendar");
    setMessage(null);
    try {
      const res = await fetch("/api/security/rotate-calendar-token", { method: "POST" });
      if (!res.ok) throw new Error("Could not rotate the calendar token.");
      const body = await res.json();
      setNewCalendarUrl(`${window.location.origin}/api/calendar.ics?token=${body.token}`);
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Failed." });
    } finally {
      setBusy(null);
    }
  }

  async function rotateAccess() {
    setBusy("access");
    setMessage(null);
    try {
      const res = await fetch("/api/security/rotate-access-key", { method: "POST" });
      if (!res.ok) throw new Error("Could not rotate the access key.");
      const body = await res.json();
      setNewAccessKey(body.key);
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Failed." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border-2 border-[#7f1d1d]/60 bg-card">
      <header className="flex items-start gap-3 border-b border-[#7f1d1d]/40 bg-[#7f1d1d]/5 px-5 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#7f1d1d] text-white">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div>
          <h2 className="font-semibold">Caution zone</h2>
          <p className="text-sm text-muted-foreground">These actions change how you sign in and what others can see. Read each one before you confirm.</p>
        </div>
      </header>

      <div className="space-y-4 p-5">
        <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <p className="flex items-center gap-2 font-medium">
              <Link2 className="h-4 w-4" />
              Rotate calendar token
            </p>
            <p className="text-sm text-muted-foreground">
              The current subscription link stops working. Calendar apps need the new link. Use this if the link was shared with someone you no longer trust.
            </p>
          </div>
          <Button variant="outline" className="shrink-0" onClick={() => setConfirm("calendar")} disabled={busy !== null}>
            Rotate calendar token
          </Button>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <p className="flex items-center gap-2 font-medium">
              <KeyRound className="h-4 w-4" />
              Rotate access key
            </p>
            <p className="text-sm text-muted-foreground">
              Signs out every other browser. Your current browser stays signed in. The new key is shown once, so save it before you close the dialog.
            </p>
          </div>
          <Button variant="outline" className="shrink-0" onClick={() => setConfirm("access")} disabled={busy !== null}>
            Rotate access key
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "calendar"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Rotate the calendar token?"
        description="The current subscription link will stop working. You'll get a new link to paste into your calendar app."
        confirmLabel="Rotate token"
        busy={busy === "calendar"}
        onConfirm={async () => {
          setConfirm(null);
          await rotateCalendar();
        }}
      />

      <ConfirmDialog
        open={confirm === "access"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Rotate the access key?"
        description="Every other browser will be signed out, and the old key stops working. You'll get a new key to save."
        confirmLabel="Rotate key"
        busy={busy === "access"}
        onConfirm={async () => {
          setConfirm(null);
          await rotateAccess();
        }}
      />

      {newCalendarUrl && (
        <ShowOnce
          open
          title="New calendar subscription link"
          description="Paste this into your calendar app. The old link no longer works."
          value={newCalendarUrl}
          onClose={() => setNewCalendarUrl(null)}
        />
      )}

      {newAccessKey && (
        <ShowOnce
          open
          title="New access key"
          description="Save this key now. You'll need it to sign in on other browsers, and it won't be shown again."
          value={newAccessKey}
          onClose={() => setNewAccessKey(null)}
        />
      )}
    </section>
  );
}
