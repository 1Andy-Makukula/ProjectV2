import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { motion } from "motion/react";

import { cn } from "./utils";

const buttonVariants = cva(
  // Base — always present
  [
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap",
    "text-[0.8125rem] font-medium tracking-[-0.01em]",
    "transition-colors duration-150",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-[0.9em] shrink-0 [&_svg]:shrink-0",
    "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
    "aria-invalid:ring-destructive/30 aria-invalid:border-destructive",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "rounded-lg bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(0,0,0,0.15)] hover:bg-primary/92 active:bg-primary/85",
        destructive:
          "rounded-lg bg-destructive text-destructive-foreground shadow-[0_1px_2px_rgba(0,0,0,0.15)] hover:bg-destructive/90",
        outline:
          "rounded-lg border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
        secondary:
          "rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost:
          "rounded-md text-foreground hover:bg-accent hover:text-accent-foreground",
        link:
          "rounded-none text-primary underline-offset-4 hover:underline px-0 h-auto",
      },
      size: {
        default: "h-8 px-3.5 py-0",
        sm:      "h-7 px-2.5 text-xs rounded-md",
        lg:      "h-10 px-5 text-sm",
        icon:    "size-8 rounded-md",
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
