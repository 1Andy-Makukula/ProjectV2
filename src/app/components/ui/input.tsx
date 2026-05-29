import * as React from "react";

import { cn } from "./utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Layout
        "flex h-9 w-full min-w-0",
        // Visual — clean, no tinted bg, just a subtle border
        "rounded-lg border border-border bg-transparent px-3 py-0",
        // Typography
        "text-sm font-normal text-foreground placeholder:text-muted-foreground",
        // Focus — orange ring
        "transition-[border-color,box-shadow] duration-150 outline-none",
        "focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring",
        // States
        "disabled:cursor-not-allowed disabled:opacity-40",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        // File input
        "file:text-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
