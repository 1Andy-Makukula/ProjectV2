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
          "border-transparent bg-warn-50 text-warn-700 border border-warn-200",
        destructive:
          "border-transparent bg-destructive/10 text-destructive border border-destructive/20",
        tint:
          "border-transparent bg-primary-tint text-primary border border-primary-tint-mid",

        // ── The fact block ────────────────────────────────────────────────
        // Round presses, square informs. Every other variant here is a pill
        // at 999px, which in this design language means "you can tap this".
        // A `block` is the opposite statement: 5px corners, hard edges, and
        // it is telling you something rather than offering you something.
        //
        // Ink is the default ground because most facts are neutral ones
        // (Featured, Draft, a merchant name, an item count). The coloured
        // facts override it at the call site -- `className="bg-brass
        // text-ink"` for escrow, `bg-destructive` for low stock, `bg-sage`
        // for collected or in stock -- which twMerge resolves cleanly since
        // `cn` runs over the joined string.
        //
        // This is the ONLY variant the charter adds. Anything that wants a
        // different colour overrides the ground; nothing needs a new name.
        block:
          "rounded-[var(--radius-block)] border-transparent bg-ink text-on-ink " +
          "font-bold tracking-[0.06em]",
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
