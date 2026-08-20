import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface StepperProps {
  steps: { key: string; label: string }[];
  currentIndex: number;
}

// A numbered-circle + connecting-line progress indicator — replaces a plain
// "1. Foo  2. Bar" text row with something that actually reads as progress:
// completed steps get a filled circle + checkmark, the current one an
// outlined circle in the brand color, upcoming ones stay muted.
export function Stepper({ steps, currentIndex }: StepperProps) {
  return (
    <ol className="flex items-start" data-testid="stepper">
      {steps.map((step, i) => (
        <li key={step.key} className="flex flex-1 flex-col items-center last:flex-none">
          <div className="flex w-full items-center">
            <div className={cn("h-0.5 flex-1", i === 0 && "invisible", i <= currentIndex ? "bg-primary" : "bg-muted")} />
            <div
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors",
                i < currentIndex && "border-primary bg-primary text-primary-foreground",
                i === currentIndex && "border-primary text-primary",
                i > currentIndex && "border-muted-foreground/30 text-muted-foreground",
              )}
              data-testid={`stepper-circle-${step.key}`}
              data-state={i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming"}
            >
              {i < currentIndex ? <Check className="size-4" aria-hidden /> : i + 1}
            </div>
            <div
              className={cn(
                "h-0.5 flex-1",
                i === steps.length - 1 && "invisible",
                i < currentIndex ? "bg-primary" : "bg-muted",
              )}
            />
          </div>
          <span
            className={cn(
              "mt-1.5 text-center text-xs font-medium",
              i === currentIndex ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
