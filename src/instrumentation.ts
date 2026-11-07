/**
 * Runs once when the Next.js server starts. Starts the automatic re-check scheduler.
 * Node.js only: the scheduler uses the SQLite database.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/scheduler");
    startScheduler();
  }
}
