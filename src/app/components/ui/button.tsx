import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { motion } from "motion/react";

import { cn } from "./utils";

/**
 * Every button is a pill.
 *
 * The shape is not decoration: one radius across the app means a button, a
 * badge and a round icon control read as the same family, and the gradient rim
 * (`kl-rim`) needs a shape it can follow. The rim and the halo come from
 * theme.css rather than being spelled out here, so there is a single place to
 * tune how the whole UI catches light.
 */
const buttonVariants = cva(
  // Base — always present
  [
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap",
    "text-[0.8125rem] font-medium tracking-[-0.01em]",
    "rounded-[var(--radius-pill)]",
    "transition-[color,background-color,box-shadow,border-color] duration-200",
    "disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none",
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-[0.9em] shrink-0 [&_svg]:shrink-0",
    "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
    "aria-invalid:ring-destructive/30 aria-invalid:border-destructive",
  ].join(" "),
  {
    variants: {
      variant: {
        // The one action on a screen that glows.
        default:
          "kl-rim kl-rim--strong kl-glow bg-primary text-primary-foreground hover:bg-primary/92 active:bg-primary/85",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[var(--shadow-float)] hover:bg-destructive/90",
        outline:
          "kl-rim bg-background text-foreground shadow-[var(--shadow-float)] hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        // Ghost stays flat on purpose — it is the one that must disappear.
        ghost:
          "text-foreground hover:bg-accent hover:text-accent-foreground",
        link:
          "rounded-none text-primary underline-offset-4 hover:underline px-0 h-auto",
      },
      // Chubbier than before: a pill needs height to read as one, and a
      // 32px control with 14px of padding reads as a chip.
      size: {
        default: "h-9 px-4 py-0",
        sm:      "h-8 px-3.5 text-xs",
        lg:      "h-11 px-6 text-sm",
        icon:    "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : motion.button;

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...(!asChild
        ? {
            whileHover: { scale: 1.015 },
            whileTap:   { scale: 0.97 },
            transition: { duration: 0.12 },
          }
        : {})}
      {...(props as any)}
    />
  );
}

export { Button, buttonVariants };
