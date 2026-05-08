"use client";

import type { DemoJourney, TourStep } from "@/lib/demoTours";
import * as React from "react";

type TourState = {
  /** Currently active journey, or null when idle */
  journey: DemoJourney | null;
  /** Current step index within the journey */
  stepIndex: number;
  /** Convenience accessor for the current step */
  currentStep: TourStep | null;
  /** Start a journey */
  startJourney: (journey: DemoJourney) => void;
  /** Move to the next step (or finish) */
  nextStep: () => void;
  /** Move to the previous step */
  prevStep: () => void;
  /** End the tour immediately */
  endTour: () => void;
};

const DemoTourContext = React.createContext<TourState | null>(null);

export function useDemoTour(): TourState {
  const ctx = React.useContext(DemoTourContext);
  if (!ctx) {
    throw new Error("useDemoTour must be used within <DemoTourProvider>");
  }
  return ctx;
}

export function DemoTourProvider({ children }: { children: React.ReactNode }) {
  const [journey, setJourney] = React.useState<DemoJourney | null>(null);
  const [stepIndex, setStepIndex] = React.useState(0);

  const currentStep = journey ? (journey.steps[stepIndex] ?? null) : null;

  const startJourney = React.useCallback((j: DemoJourney) => {
    setJourney(j);
    setStepIndex(0);
  }, []);

  const nextStep = React.useCallback(() => {
    setStepIndex((prev) => {
      if (!journey) return prev;
      if (prev + 1 >= journey.steps.length) {
        // Journey complete
        setJourney(null);
        return 0;
      }
      return prev + 1;
    });
  }, [journey]);

  const prevStep = React.useCallback(() => {
    setStepIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const endTour = React.useCallback(() => {
    setJourney(null);
    setStepIndex(0);
  }, []);

  const value = React.useMemo<TourState>(
    () => ({
      journey,
      stepIndex,
      currentStep,
      startJourney,
      nextStep,
      prevStep,
      endTour,
    }),
    [
      journey,
      stepIndex,
      currentStep,
      startJourney,
      nextStep,
      prevStep,
      endTour,
    ],
  );

  return (
    <DemoTourContext.Provider value={value}>
      {children}
    </DemoTourContext.Provider>
  );
}
