import { generateMonthlyReportsForAllCompanies } from "@/lib/financeReports";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import cron from "node-cron";

const SAST_TIMEZONE = "Africa/Johannesburg";
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 30_000;

type GlobalState = {
  monthlyFinanceSchedulerStarted?: boolean;
};

function getSastDateParts(date: Date): {
  year: number;
  month: number;
  day: number;
} {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: SAST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(date);
  return {
    year: Number(parts.find((p) => p.type === "year")?.value ?? "0"),
    month: Number(parts.find((p) => p.type === "month")?.value ?? "0"),
    day: Number(parts.find((p) => p.type === "day")?.value ?? "0"),
  };
}

function isLastDayOfMonthSast(date: Date): boolean {
  const { year, month, day } = getSastDateParts(date);
  const daysInMonth = new Date(year, month, 0).getDate();
  return day === daysInMonth;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logSchedulerRun(
  status: "success" | "failed",
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: "system",
        actor: "scheduler",
        entityType: "monthly_finance_scheduler",
        entityId: new Date().toISOString().slice(0, 7),
        action: status,
        afterJson: details as unknown as Prisma.InputJsonValue,
      },
    });
  } catch {
    // Avoid crashing the scheduler if audit logging itself fails.
  }
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
      if (!isLastDayOfMonthSast(new Date())) {
        return;
      }

      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          if (attempt > 0) {
            console.warn(
              `Monthly finance scheduler retry ${attempt}/${MAX_RETRIES}`,
            );
            await sleep(RETRY_DELAY_MS);
          }

          const reports = await generateMonthlyReportsForAllCompanies(
            undefined,
            "scheduler",
          );

          console.info("Monthly finance scheduler completed", {
            reportsGenerated: reports.length,
          });

          await logSchedulerRun("success", {
            reportsGenerated: reports.length,
            attempt,
          });

          return;
        } catch (error) {
          lastError = error as Error;
          console.error(`Monthly finance scheduler attempt ${attempt} failed`, {
            message: lastError.message,
          });
        }
      }

      await logSchedulerRun("failed", {
        message: lastError?.message ?? "Unknown error",
        attempts: MAX_RETRIES + 1,
      });
    },
    {
      timezone: SAST_TIMEZONE,
    },
  );
}
