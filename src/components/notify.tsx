"use client";

import { toast } from "sonner";
import { ToastCard, type ToastTone } from "@/components/toast";

/**
 * Shows a message in the bottom-right corner. Success and warnings clear after a few seconds;
 * errors stay until the user dismisses them. Use this instead of inline status text.
 */
export function notify(tone: ToastTone, text: string): void {
  toast.custom(
    (id) => <ToastCard tone={tone} text={text} onDismiss={() => toast.dismiss(id)} />,
    { duration: tone === "error" ? Infinity : 6000 },
  );
}
