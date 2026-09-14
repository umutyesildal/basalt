import { cn } from "@/lib/utils";

export interface SpinnerProps {
  /** Box size classes for the ring. Default: "h-4 w-4" */
  sizeClassName?: string;
  /** Extra classes merged onto the visible ring. */
  className?: string;
  /**
   * Screen-reader announcement. Pass `null` when adjacent visible text
   * already describes the loading state.
   */
  label?: string | null;
}

/**
 * Shared loading spinner — the single source of `animate-spin` in the app.
 * Pure CSS ring (no icon dependency); freezes to its static track ring under
 * `prefers-reduced-motion`.
 */
export function Spinner({
  sizeClassName = "h-4 w-4",
  className,
  label = "Loading",
}: SpinnerProps) {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "inline-block shrink-0 animate-spin motion-reduce:animate-none rounded-full border-2 border-muted-foreground/30 border-t-foreground",
          sizeClassName,
          className
        )}
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </>
  );
}

Spinner.displayName = "Spinner";
