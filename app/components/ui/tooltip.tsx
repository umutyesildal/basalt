"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "@/lib/utils";

/**
 * Tooltip — hover/focus tooltip for quiet data affordances (truncated
 * addresses, fee math, source/as-of provenance). Chrome stays monochrome:
 * popover tokens only, never a chart hue.
 *
 * Under the hood: Base UI Tooltip (`@base-ui/react/tooltip`) — the project's
 * component primitive from the Radix team, already a dependency (button.tsx /
 * badge.tsx import its subpaths). No Radix package exists in package.json and
 * adding one is forbidden, so this wraps the in-house equivalent; the parts
 * API (Provider/Root/Trigger/Portal/Positioner/Popup) is deliberately Radix-
 * shaped.
 *
 * The trigger renders as a focusable inline <span> (not a button), so inline
 * text and icons stay clickable beneath it; keyboard users get the tooltip on
 * focus. Entrance/exit uses a 150ms ease-out opacity fade — the house motion
 * budget — and disables under prefers-reduced-motion.
 */

type TooltipSide = "top" | "bottom" | "left" | "right";
type TooltipAlign = "start" | "center" | "end";

export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  sideOffset = 6,
  /** Hover delay before opening, ms (Base UI default 600 feels laggy for data captions). */
  delay = 300,
  className,
  contentClassName,
}: {
  /** Tooltip body — keep it one short factual line (brand voice). */
  content: React.ReactNode;
  /** The wrapped element; stays interactive, gains aria-describedby. */
  children: React.ReactNode;
  side?: TooltipSide;
  align?: TooltipAlign;
  /** Gap between trigger and popup, px. */
  sideOffset?: number;
  delay?: number;
  /** Classes for the focusable trigger wrapper. */
  className?: string;
  /** Classes for the popup surface (e.g. max-w tighter, text alignment). */
  contentClassName?: string;
}) {
  return (
    <TooltipPrimitive.Provider delay={delay}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger
          render={<span />}
          tabIndex={0}
          className={cn(
            "inline-flex max-w-full items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            className,
          )}
        >
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Positioner
            side={side}
            align={align}
            sideOffset={sideOffset}
            className="z-50 max-w-64"
          >
            <TooltipPrimitive.Popup
              className={cn(
                "rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs leading-4 text-popover-foreground shadow-md transition-opacity duration-150 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none",
                contentClassName,
              )}
            >
              {content}
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
