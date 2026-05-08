"use client";

import * as React from "react";

/**
 * Transparent overlay that sits above the page content in demo mode.
 * It blocks pointer interactions (clicks, inputs, drag) and prevents
 * text selection / copying so the demo is strictly view-only.
 *
 * A small toast appears when the user attempts to interact.
 */
export default function DemoReadOnlyShield() {
  const [showToast, setShowToast] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = React.useCallback(() => {
    setShowToast(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShowToast(false), 2200);
  }, []);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <>
      {/* Full-page transparent blocker */}
      <div
        className="pointer-events-auto absolute inset-0 z-40 cursor-default"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          flash();
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        aria-hidden="true"
      />

      {/* Toast notification */}
      {showToast && (
        <div className="pointer-events-none fixed left-1/2 top-6 z-[60] -translate-x-1/2 animate-[fadeSlide_2.2s_ease-out]">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-3 shadow-lg">
            <p className="text-sm font-medium text-amber-800">
              🔒 This is a read-only demo. Interactions are disabled.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
