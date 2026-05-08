/**
 * Returns `true` when the application is running as the demo instance.
 *
 * Checks, in order:
 *  1. `process.env.DEMO_MODE` is explicitly set (any truthy value)
 *  2. `process.env.DATABASE_URL` points at `demo.db`
 *
 * The flag is set automatically by `start-demo-local.ps1` and can also
 * be set manually in `.env.local` or Docker Compose environment.
 */
export function isDemoInstance(): boolean {
  if (process.env.DEMO_MODE) {
    return true;
  }
  const dbUrl = process.env.DATABASE_URL ?? "";
  return dbUrl.includes("demo.db");
}
