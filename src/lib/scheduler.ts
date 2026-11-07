import { getSetting, setSetting } from "@/lib/db";
import { getAlertFlag, getRecheckInterval, RECHECK_INTERVALS } from "@/lib/prefs";
import { recheckAllLinked } from "@/lib/recheck";
import { sendGotify } from "@/lib/gotify";
import { importTick, IMPORT_TICK_MS } from "@/lib/importer";

const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 10 * 60 * 1000; // how often we check whether a run is due

const state = globalThis as unknown as {
  schedulerStarted?: boolean;
  schedulerRunning?: boolean;
  schedulerStartedAt?: number;
};

/** Starts the background timer once per server process. Called from instrumentation.ts. */
export function startScheduler() {
  if (state.schedulerStarted) return;
  state.schedulerStarted = true;
  state.schedulerStartedAt = Date.now();
  setInterval(() => {
    maybeRunScheduledRecheck().catch((err) => console.error("[scheduler] re-check failed:", err));
  }, TICK_MS);
  // Library import worker: one book at a time, paced (see importer.ts).
  setInterval(() => {
    importTick().catch((err) => console.error("[import] step failed:", err));
  }, IMPORT_TICK_MS);
}

/**
 * Runs a full re-check when the configured interval has passed.
 * The clock starts at the last real run, or at server start if there hasn't been one yet.
 */
export async function maybeRunScheduledRecheck(now = Date.now()): Promise<"busy" | "not-due" | "ran"> {
  if (state.schedulerRunning) return "busy";

  const intervalMs = RECHECK_INTERVALS[await getRecheckInterval()].days * DAY_MS;
  const last = await getSetting("lastAutoCheckAt");
  const baseline = last ? Date.parse(last) : (state.schedulerStartedAt ?? now);
  if (now - baseline < intervalMs) return "not-due";

  state.schedulerRunning = true;
  try {
    // Record the start first, so a slow run can't trigger a second one.
    await setSetting("lastAutoCheckAt", new Date(now).toISOString());
    const summary = await recheckAllLinked();

    if (await getAlertFlag("alertScheduled")) {
      try {
        await sendGotify({
          title: "Scheduled re-check finished",
          message:
            `Checked ${summary.checked} books` +
            (summary.failed ? `, ${summary.failed} failed` : "") +
            `. New ebooks: ${summary.newEbooks}. New audiobooks: ${summary.newAudiobooks}.`,
          priority: 3,
        });
      } catch (err) {
        console.error("[scheduler] summary alert failed:", err);
      }
    }
    return "ran";
  } finally {
    state.schedulerRunning = false;
  }
}
