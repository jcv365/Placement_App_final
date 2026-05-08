"use client";

import DemoReadOnlyShield from "@/components/demo/DemoReadOnlyShield";
import DemoTourOverlay from "@/components/demo/DemoTourOverlay";
import {
    DemoTourProvider,
    useDemoTour,
} from "@/components/demo/DemoTourProvider";
import { demoJourneys } from "@/lib/demoTours";
import Link from "next/link";
import * as React from "react";

/**
 * Inner component that reads sessionStorage on mount and auto-starts a tour
 * if the user arrived from the /demo page with a journey selection.
 *
 * Also blocks text selection & copy across the demo surface and renders
 * a persistent "Back to Demo Hub" button.
 */
function TourAutoStart({ children }: { children: React.ReactNode }) {
  const { startJourney, journey } = useDemoTour();

  React.useEffect(() => {
    const storedId = sessionStorage.getItem("demoTourJourneyId");
    if (!storedId || journey) return;

    const found = demoJourneys.find((j) => j.id === storedId);
    if (found) {
      sessionStorage.removeItem("demoTourJourneyId");
      startJourney(found);
    }
  }, [startJourney, journey]);

  // Block copy / cut / context-menu across the demo
  React.useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    document.addEventListener("copy", block);
    document.addEventListener("cut", block);
    document.addEventListener("contextmenu", block);
    return () => {
      document.removeEventListener("copy", block);
      document.removeEventListener("cut", block);
      document.removeEventListener("contextmenu", block);
    };
  }, []);

  return (
    <div className="demo-nocopy relative select-none">
      <DemoReadOnlyShield />
      {children}
      <DemoTourOverlay />

      {/* Persistent "Back to Demo Hub" button */}
      <div className="pointer-events-auto fixed left-4 top-20 z-[55]">
        <Link
          href="/demo"
          className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 shadow-md transition-colors hover:bg-blue-100"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Demo Hub
        </Link>
      </div>
    </div>
  );
}

/**
 * Wraps dashboard children with the demo tour context + overlay.
 * Drop this into the dashboard layout to enable guided tours.
 */
export default function DemoTourWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DemoTourProvider>
      <TourAutoStart>{children}</TourAutoStart>
    </DemoTourProvider>
  );
}
