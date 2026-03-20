import { startMonthlyFinanceScheduler } from "@/lib/monthlyFinanceScheduler";

export async function register() {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  if (
    (process.env.ENABLE_FINANCE_SCHEDULER ?? "true").toLowerCase() !== "true"
  ) {
    return;
  }

  startMonthlyFinanceScheduler();
}
