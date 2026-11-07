"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Input, type InputProps } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** A text input with an X button that clears it. The X appears only when there is text. */
export function ClearableInput({
  value,
  onChange,
  className,
  wrapperClassName,
  ...props
}: Omit<InputProps, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  wrapperClassName?: string;
}) {
  return (
    <div className={cn("relative", wrapperClassName)}>
      <Input
        {...props}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(value !== "" && "pr-9", className)}
      />
      {value !== "" && (
        <button
          type="button"
          aria-label="Clear"
          title="Clear"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
