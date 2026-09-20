import { cn } from "./utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // On --surface-paper rather than --accent: a loading shape is a quiet
      // surface, and the charter asks for skeletons in the final layout's own
      // shape and radii -- never a spinner where a shape is knowable. Callers
      // override the radius to match whatever is arriving.
      className={cn("animate-pulse rounded-md bg-surface-paper", className)}
      {...props}
    />
  );
}

export { Skeleton };
