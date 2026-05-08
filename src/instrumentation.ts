export async function register() {
  if (
    process.env.NODE_ENV === "test" ||
    typeof (globalThis as Record<string, unknown>).EdgeRuntime !== "undefined"
  ) {
    return;
  }

  if (
    (process.env.ENABLE_FINANCE_SCHEDULER ?? "true").toLowerCase() === "true"
  ) {
    const { startMonthlyFinanceScheduler } =
      await import("@/lib/monthlyFinanceScheduler");
    startMonthlyFinanceScheduler();
  }

  if (
    (
      process.env.ENABLE_TIMESHEET_REMINDER_SCHEDULER ?? "true"
    ).toLowerCase() === "true"
  ) {
    const { startTimesheetReminderScheduler } =
      await import("@/lib/timesheetReminderScheduler");
    startTimesheetReminderScheduler();
  }

  if (
    (process.env.ENABLE_AUTOMATION_SCHEDULER ?? "true").toLowerCase() === "true"
  ) {
    const { startAutomationScheduler } =
      await import("@/lib/automationScheduler");
    startAutomationScheduler();
  }
}
