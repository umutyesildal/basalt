"use client";

import { Progress } from "@base-ui/react/progress";
import { cn } from "@/lib/utils";
import { useLegendItem } from "./legend-context";

export interface LegendProgressProps {
  /** Track class name */
  trackClassName?: string;
  /** Indicator class name */
  indicatorClassName?: string;
  /** Track height. Default: "h-1.5" */
  height?: string;
}

export function LegendProgress({
  trackClassName = "",
  indicatorClassName = "",
  height = "h-1.5",
}: LegendProgressProps) {
  const { item } = useLegendItem();

  if (!item.maxValue) {
    return null;
  }

  // Note: item.color must remain inline style as it's dynamic data
  return (
    <Progress.Root max={item.maxValue} value={item.value}>
      <Progress.Track
        className={cn(
          // Chip-tier radius (rounded-md) per the unified radius scale — the
          // task spec pins legend-progress to the md token.
          "w-full overflow-hidden rounded-md bg-legend-track",
          height,
          trackClassName
        )}
      >
        <Progress.Indicator
          className={cn(
            // Indicator animates its inline width only (Base UI Progress);
            // 200ms stays within the ui-plan §0.4 motion budget (≤250ms).
            "h-full rounded-md transition-[width] duration-200 ease-out motion-reduce:transition-none",
            indicatorClassName
          )}
          style={{ backgroundColor: item.color }}
        />
      </Progress.Track>
    </Progress.Root>
  );
}

LegendProgress.displayName = "LegendProgress";
