import { cn } from "@/lib/utils";

export function SuccessBanner({
  message,
  className,
  onDismiss,
}: {
  message: string;
  className?: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "flex items-start justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
        className,
      )}
    >
      <span>{message}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="ml-2 shrink-0 rounded p-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-900"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
