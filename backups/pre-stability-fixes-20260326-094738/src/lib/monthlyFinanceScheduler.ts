import { generateMonthlyReportsForAllCompanies } from "@/lib/financeReports";
import cron from "node-cron";

const SAST_TIMEZONE = "Africa/Johannesburg";

type GlobalState = {
  monthlyFinanceSchedulerStarted?: boolean;
};

function getZonedDate(date: Date): Date {
  const zoned = date.toLocaleString("en-US", { timeZone: SAST_TIMEZONE });
  return new Date(zoned);
}

function isLastDayOfMonthSast(date: Date): boolean {
  const zonedNow = getZonedDate(date);
  const zonedTomorrow = new Date(zonedNow);
  zonedTomorrow.setDate(zonedTomorrow.getDate() + 1);
  return zonedTomorrow.getDate() === 1;
}

export function startMonthlyFinanceScheduler() {
  const globalState = globalThis as typeof globalThis & GlobalState;
  if (globalState.monthlyFinanceSchedulerStarted) {
    return;
  }

  globalState.monthlyFinanceSchedulerStarted = true;

  cron.schedule(
    "0 0 * * *",
    async () => {
      try {
        if (!isLastDayOfMonthSast(new Date())) {
          return;
        }

        await generateMonthlyReportsForAllCompanies("scheduler");
      } catch (error) {
        console.error("Monthly finance scheduler failed", {
          message: (error as Error).message,
        });
      }
    },
    {
      timezone: SAST_TIMEZONE,
    },
  );
}
