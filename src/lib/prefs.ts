import { getSetting } from "@/lib/db";

/** Automatic re-check intervals. "Month" is 30 days and "3 months" is 90 days. */
export const RECHECK_INTERVALS = {
  daily: { label: "Every day", days: 1 },
  weekly: { label: "Every 7 days", days: 7 },
  monthly: { label: "Every month (30 days)", days: 30 },
  quarterly: { label: "Every 3 months (90 days)", days: 90 },
} as const;

export type RecheckInterval = keyof typeof RECHECK_INTERVALS;
export const DEFAULT_RECHECK_INTERVAL: RecheckInterval = "monthly";

export type AlertFlag = "alertEbook" | "alertAudiobook" | "alertScheduled";

/** Defaults: ebook and audiobook alerts on, scheduled summaries off. */
const FLAG_DEFAULTS: Record<AlertFlag, boolean> = {
  alertEbook: true,
  alertAudiobook: true,
  alertScheduled: false,
};

export async function getRecheckInterval(): Promise<RecheckInterval> {
  const value = await getSetting("recheckInterval");
  return value && value in RECHECK_INTERVALS ? (value as RecheckInterval) : DEFAULT_RECHECK_INTERVAL;
}

export type AuthorFlag = "authorIncludeTba" | "authorIncludeReleased";

/**
 * Author watch options. Date TBA books are added by default. Books that are already out when you
 * start watching an author are off by default; new releases are always added.
 */
const AUTHOR_FLAG_DEFAULTS: Record<AuthorFlag, boolean> = {
  authorIncludeTba: true,
  authorIncludeReleased: false,
};

export async function getAuthorFlag(flag: AuthorFlag): Promise<boolean> {
  const value = await getSetting(flag);
  if (value === null) return AUTHOR_FLAG_DEFAULTS[flag];
  return value === "true";
}

export async function getAlertFlag(flag: AlertFlag): Promise<boolean> {
  const value = await getSetting(flag);
  if (value === null) return FLAG_DEFAULTS[flag];
  return value === "true";
}
