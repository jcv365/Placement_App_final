import { cn } from "@/lib/utils";

export function ErrorBanner({
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
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className={cn(
        "flex items-start justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
        className,
      )}
    >
      <span>{message}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="ml-2 shrink-0 rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
