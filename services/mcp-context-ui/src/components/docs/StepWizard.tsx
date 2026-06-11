/**
 * StepWizard — Multi-step form with progress indicator.
 * Manages step navigation and renders step content via render props.
 */
import { useState, useCallback, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

export interface WizardStep {
  id: string;
  title: string;
  description?: string;
}

interface StepWizardProps {
  steps: WizardStep[];
  children: (currentStep: number) => ReactNode;
  onComplete?: () => void;
  className?: string;
}

export function StepWizard({ steps, children, onComplete, className }: StepWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const goNext = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      onComplete?.();
    }
  }, [currentStep, steps.length, onComplete]);

  const goPrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep]);

  const isLastStep = currentStep === steps.length - 1;

  return (
    <div className={cn("space-y-6", className)}>
      {/* Progress indicator */}
      <nav aria-label="Wizard progress" className="flex items-center gap-2">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;

          return (
            <div key={step.id} className="flex items-center gap-2">
              <button
                onClick={() => index <= currentStep && setCurrentStep(index)}
                disabled={index > currentStep}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isCurrent && "bg-primary-50 text-primary-700 border border-primary-200",
                  isCompleted && "text-success-600 hover:bg-success-50 cursor-pointer",
                  !isCurrent && !isCompleted && "text-slate-400 cursor-not-allowed"
                )}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`Step ${index + 1}: ${step.title}${isCompleted ? " (completed)" : ""}`}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                    isCurrent && "bg-primary-600 text-white",
                    isCompleted && "bg-success-500 text-white",
                    !isCurrent && !isCompleted && "bg-slate-200 text-slate-500"
                  )}
                >
                  {isCompleted ? <Check className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <span className="hidden sm:inline">{step.title}</span>
              </button>
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "h-px w-6 sm:w-10",
                    index < currentStep ? "bg-success-500" : "bg-slate-200"
                  )}
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
      </nav>

      {/* Step description */}
      {steps[currentStep].description && (
        <p className="text-sm text-slate-600">{steps[currentStep].description}</p>
      )}

      {/* Step content */}
      <div className="min-h-[200px]">{children(currentStep)}</div>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between border-t border-slate-200 pt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={goPrev}
          disabled={currentStep === 0}
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <span className="text-xs text-slate-500">
          Step {currentStep + 1} of {steps.length}
        </span>
        <Button size="sm" onClick={goNext}>
          {isLastStep ? "Generate" : "Next"}
          {!isLastStep && <ChevronRight className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
