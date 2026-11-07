import { NextResponse } from "next/server";
import { listJobs } from "@/lib/importer";

/** GET /api/import/jobs - recent import jobs with counts. */
export async function GET() {
  return NextResponse.json(listJobs(), { headers: { "Cache-Control": "no-store" } });
}
