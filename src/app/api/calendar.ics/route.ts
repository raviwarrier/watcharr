import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as schema from "@/db/schema";

function escapeIcal(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function formatIcalDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * GET /api/calendar.ics - iCal feed of upcoming audiobook releases.
 * Only books with a known audiobook release date from today on are included. Books with no
 * audiobook date (never released as one, or no date announced) and past dates are left out.
 */
export async function GET() {
  const today = new Date().toISOString().slice(0, 10);
  const books = (await db
    .select()
    .from(schema.books)
    .orderBy(schema.books.audiobookReleaseDate))
    .filter((b) => b.audiobookReleaseDate !== null && b.audiobookReleaseDate >= today);

  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Watcharr//watcharr//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Watcharr",
    "X-WR-TIMEZONE:UTC",
  ];

  for (const b of books) {
    if (!b.audiobookReleaseDate) continue;
    const start = formatIcalDate(b.audiobookReleaseDate);
    if (!start) continue;
    const end = new Date(new Date(b.audiobookReleaseDate).getTime() + 24 * 60 * 60 * 1000)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
    const uid = `book-${b.id}@book-release-tracker`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${start.slice(0, 8)}`,
      `DTEND;VALUE=DATE:${end.slice(0, 8)}`,
      `SUMMARY:${escapeIcal(b.title)}`,
      `DESCRIPTION:${escapeIcal(`${b.author}${b.series ? ` (${b.series} #${b.seriesPosition})` : ""}\\n${b.synopsis ?? ""}`)}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");

  return new NextResponse(lines.join("\r\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="watcharr.ics"',
    },
  });
}
