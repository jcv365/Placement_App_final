import {
    ADMIN_SESSION_COOKIE,
    createAdminSessionTokenForTenant,
} from "@/lib/adminAuth";
import { prisma } from "@/lib/prisma";
import cron from "node-cron";

const CRON_EXPRESSION = "0 6 * * *"; // 06:00 UTC

type GlobalState = {
  automationSchedulerStarted?: boolean;
};

async function runAutomationForAllEnabledTenants(): Promise<void> {
  const appBaseUrl =
    process.env.APP_BASE_URL?.trim() ?? "http://localhost:3000";

  let ruleSets: { tenantId: string }[];
  try {
    ruleSets = await prisma.ruleSet.findMany({
      where: { isDefault: true },
      select: { tenantId: true, rulesJson: true },
    });
  } catch (err) {
    console.error("[AUTOMATION_SCHEDULER] Failed to load rule sets", err);
    return;
  }

  const enabled = (
    ruleSets as Array<{ tenantId: string; rulesJson: unknown }>
  ).filter((rs) => {
    const rj =
      rs.rulesJson != null &&
      typeof rs.rulesJson === "object" &&
      !Array.isArray(rs.rulesJson)
        ? (rs.rulesJson as Record<string, unknown>)
        : {};
    return rj.automation_enabled === true;
  });

  if (enabled.length === 0) return;

  for (const rs of enabled) {
    try {
      const token = createAdminSessionTokenForTenant(
        "automation-scheduler",
        rs.tenantId,
      );
      const cookieHeader = `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`;

      const res = await fetch(`${appBaseUrl}/api/automation/run`, {
        method: "POST",
        headers: { cookie: cookieHeader },
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "(no body)");
        console.error(
          `[AUTOMATION_SCHEDULER] Run failed for tenant ${rs.tenantId}: ${res.status} ${body}`,
        );
      } else {
        const data = (await res.json()) as { data?: { runId?: string } };
        console.log(
          `[AUTOMATION_SCHEDULER] Started run for tenant ${rs.tenantId}`,
          { runId: data?.data?.runId },
        );
      }
    } catch (err) {
      console.error(
        `[AUTOMATION_SCHEDULER] Error triggering run for tenant ${rs.tenantId}`,
        err,
      );
    }
  }
}

export function startAutomationScheduler(): void {
  const globalState = globalThis as typeof globalThis & GlobalState;
  if (globalState.automationSchedulerStarted) return;
  globalState.automationSchedulerStarted = true;

  cron.schedule(CRON_EXPRESSION, () => {
    void runAutomationForAllEnabledTenants();
  });

  console.log(
    `[AUTOMATION_SCHEDULER] Registered — runs daily at 06:00 UTC (${CRON_EXPRESSION})`,
  );
}
