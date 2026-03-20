import { cn } from "@/lib/utils";

export function SuccessBanner({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700",
        className,
      )}
    >
      {message}
    </div>
  );
}
