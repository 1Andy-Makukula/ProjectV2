import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

const badgeVariants = cva(
  [
    "inline-flex items-center justify-center gap-1 w-fit whitespace-nowrap shrink-0",
    "rounded-full border px-2 py-0.5",
    "text-[0.6875rem] font-medium tracking-[0.02em] uppercase",
    "[&>svg]:size-3 [&>svg]:pointer-events-none",
    "transition-colors duration-150 overflow-hidden",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        outline:
          "border-border text-foreground bg-transparent",
        success:
          "border-transparent bg-[var(--success)]/10 text-[var(--success)] border border-[var(--success)]/20",
        warning:
          "border-transparent bg-amber-50 text-amber-700 border border-amber-200",
        destructive:
          "border-transparent bg-destructive/10 text-destructive border border-destructive/20",
        tint:
          "border-transparent bg-primary-tint text-primary border border-primary-tint-mid",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
