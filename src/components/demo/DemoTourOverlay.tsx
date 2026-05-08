"use client";

import { useDemoTour } from "@/components/demo/DemoTourProvider";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

/**
 * Floating overlay that displays the current tour step and navigation controls.
 * Rendered inside the dashboard layout so it's available on every page.
 */
export default function DemoTourOverlay() {
  const { journey, stepIndex, currentStep, nextStep, prevStep, endTour } =
    useDemoTour();
  const router = useRouter();
  const pathname = usePathname();

  // Navigate to the step's route when it changes
  React.useEffect(() => {
    if (currentStep && currentStep.route !== pathname) {
      router.push(currentStep.route);
    }
    // Only react to step changes, not all pathname changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep?.route, stepIndex]);

  if (!journey || !currentStep) {
    return null;
  }

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === journey.steps.length - 1;
  const progress = ((stepIndex + 1) / journey.steps.length) * 100;

  function handleFinish() {
    endTour();
    router.push("/demo");
  }

  function handleClose() {
    endTour();
    router.push("/demo");
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl">
        {/* Progress bar */}
        <div className="h-1 rounded-t-xl bg-slate-100">
          <div
            className="h-1 rounded-tl-xl bg-blue-600 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">
                {journey.title} — Step {stepIndex + 1} of {journey.steps.length}
              </p>
              <h3 className="mt-1 text-base font-semibold text-slate-900">
                {currentStep.title}
              </h3>
            </div>
            <button
              onClick={handleClose}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close tour"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            {currentStep.body}
          </p>

          {/* Navigation */}
          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={prevStep}
              disabled={isFirst}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Previous
            </button>

            <div className="flex gap-1">
              {journey.steps.map((_, i) => (
                <span
                  key={i}
                  className={`block h-1.5 w-1.5 rounded-full ${
                    i === stepIndex ? "bg-blue-600" : "bg-slate-200"
                  }`}
                />
              ))}
            </div>

            <button
              onClick={isLast ? handleFinish : nextStep}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              {isLast ? "Finish ✓" : "Next →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
