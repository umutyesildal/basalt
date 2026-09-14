import { cn } from "@/lib/utils";

export interface CreateStep {
  key: string;
  label: string;
  /** Short reason shown while the step is invalid ("Need 2-20 constituents"). */
  hint?: string;
}

/**
 * Six-step wizard stepper: a slim horizontal track of numbered circles
 * (01–06, mono — NEON FOUNDRY) joined by thin line segments that
 * fill as steps are reached. Current = filled (primary/yellow) circle with a
 * medium-weight label; done = primary-outlined circle (clickable to jump back,
 * never past validation); upcoming = muted. Labels hide below sm so mobile
 * shows the number track only.
 *
 * Dalga 2 polish: a quiet mono meta row ("STEP 02 / 06", the current label on
 * mobile where circle labels are hidden) above the track and a hairline
 * progress bar below it — the track/hairline language, nothing boxed.
 */

/** Zero-padded mono step numerals 01–06, NEON FOUNDRY (indexes 0-5 → 01-06). */
const STEP_NUMERALS = ["01", "02", "03", "04", "05", "06"] as const;

function paddedNumeral(value: number): string {
  return String(value).padStart(2, "0");
}

export function Stepper({
  steps,
  current,
  validThrough,
  onSelect,
  className,
}: {
  steps: CreateStep[];
  current: number;
  /** Highest step index whose validation passed (clickable targets). */
  validThrough: number;
  onSelect: (index: number) => void;
  className?: string;
}) {
  return (
    <nav aria-label="Create wizard steps" className={className}>
      <div className="flex items-baseline justify-between gap-3" aria-hidden="true">
        <span className="section-label">
          Step {paddedNumeral(current + 1)} / {paddedNumeral(steps.length)}
        </span>
        {/* Circle labels are hidden below sm — repeat the current one here. */}
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground sm:hidden">
          {steps[current]?.label}
        </span>
      </div>
      <ol className="mt-2 flex w-full items-center gap-x-1 sm:gap-x-1.5">
        {steps.map((step, index) => {
          const isCurrent = index === current;
          const isDone = index < current;
          const isClickable = index <= validThrough && !isCurrent;
          const label = (
            <span
              className={cn(
                "hidden min-w-0 truncate text-xs sm:block",
                isCurrent
                  ? "font-medium text-primary-text"
                  : isDone
                    ? "text-muted-foreground group-hover/step:text-primary-text"
                    : "text-muted-foreground/60",
              )}
            >
              {step.label}
            </span>
          );
          return (
            <li key={step.key} className="flex min-w-0 items-center" aria-current={isCurrent ? "step" : undefined}>
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-px w-3 shrink-0 transition-colors sm:w-5",
                    index <= current ? "bg-primary/50" : "bg-border",
                  )}
                />
              )}
              {isClickable ? (
                <button
                  type="button"
                  onClick={() => onSelect(index)}
                  title={step.label}
                  className="group/step flex items-center gap-1.5 rounded-sm p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <StepNumber index={index} state="done" />
                  {label}
                </button>
              ) : (
                <span className="flex items-center gap-1.5 p-1" title={step.label}>
                  <StepNumber
                    index={index}
                    state={isCurrent ? "current" : isDone ? "done" : "upcoming"}
                  />
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <div aria-hidden="true" className="mt-2 h-px w-full bg-border">
        <div
          className="h-px bg-primary/60 transition-[width] duration-200 ease-out motion-reduce:transition-none"
          style={{ width: `${((current + 1) / steps.length) * 100}%` }}
        />
      </div>
    </nav>
  );
}

function StepNumber({
  index,
  state,
}: {
  index: number;
  state: "current" | "done" | "upcoming";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] tabular-nums transition-colors",
        state === "current" && "bg-primary text-primary-foreground",
        state === "done" && "border border-primary/60 text-primary-text",
        state === "upcoming" && "border border-border/60 text-muted-foreground/60",
      )}
    >
      {STEP_NUMERALS[index]}
    </span>
  );
}
