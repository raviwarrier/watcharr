"use client";

import { Toaster, toast as SonnerToast } from "sonner";

export function Toast() {
  return <Toaster richColors position="bottom-right" />;
}

export { SonnerToast, Toaster };
