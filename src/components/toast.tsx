"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastTone = "ok" | "warn" | "error";

/** The card shown for one message. Colours and text are the same as the old inline messages. */
export function ToastCard({ tone, text, onDismiss }: { tone: ToastTone; text: string; onDismiss: () => void }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={cn(
        "flex w-[min(24rem,calc(100vw-2rem))] items-start justify-between gap-4 rounded-lg border bg-background px-4 py-3 text-sm shadow-lg",
        tone === "ok" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
        tone === "warn" && "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
        tone === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      <span>{text}</span>
      <button onClick={onDismiss} className="shrink-0 opacity-70 hover:opacity-100" aria-label="Dismiss">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
