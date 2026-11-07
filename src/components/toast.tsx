"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type ToastTone = "ok" | "warn" | "error";

/**
 * A small message in the bottom-right corner of the view. It floats above the page, so showing or
 * hiding it never moves the content. Success and warning messages clear themselves after a few seconds;
 * errors stay until dismissed.
 */
export function Toast({
  tone,
  text,
  onDismiss,
  autoDismissMs = 6000,
}: {
  tone: ToastTone;
  text: string;
  onDismiss: () => void;
  autoDismissMs?: number;
}) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (tone === "error") return;
    const timer = setTimeout(() => dismissRef.current(), autoDismissMs);
    return () => clearTimeout(timer);
  }, [tone, text, autoDismissMs]);

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-lg bg-background shadow-lg">
      <div
        role={tone === "error" ? "alert" : "status"}
        aria-live={tone === "error" ? "assertive" : "polite"}
        className={cn(
          "flex items-start justify-between gap-4 rounded-lg border px-4 py-3 text-sm",
          tone === "ok" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
          tone === "warn" && "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
          tone === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
        )}
      >
        <span>{text}</span>
        <button onClick={onDismiss} className="shrink-0 opacity-70 hover:opacity-100" aria-label="Dismiss">
          ✕
        </button>
      </div>
    </div>
  );
}
