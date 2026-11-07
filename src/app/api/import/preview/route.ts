import { NextResponse } from "next/server";
import {
  createJob,
  detectMapping,
  discardAwaitingJobs,
  MAX_CSV_BYTES,
  rowsFromCsv,
  tagValueCounts,
  type Mapping,
} from "@/lib/importer";
import { readCsvObjects } from "@/lib/csv";

/**
 * POST /api/import/preview (multipart: file, optional mapping as JSON).
 * Steps, each answered by the same endpoint:
 *  1. No mapping: Goodreads files are recognized and get their mapping. Any other file returns its
 *     column headers, so the user can choose the title, author, ISBN and tag columns.
 *  2. Tag column chosen but no tag values: returns the distinct values with counts to pick from.
 *  3. Mapping complete: creates a job waiting to be started.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a CSV file to upload." }, { status: 400 });
  }
  if (file.size > MAX_CSV_BYTES) {
    return NextResponse.json({ error: "That file is larger than 5 MB." }, { status: 413 });
  }

  const text = await file.text();
  const { headers, rows } = readCsvObjects(text);
  if (headers.length === 0 || rows.length === 0) {
    return NextResponse.json({ error: "The file has no rows to import." }, { status: 400 });
  }

  let mapping: Mapping | null = null;
  const rawMapping = form?.get("mapping");
  if (typeof rawMapping === "string" && rawMapping.trim()) {
    try {
      mapping = JSON.parse(rawMapping) as Mapping;
    } catch {
      return NextResponse.json({ error: "The column mapping isn't valid." }, { status: 400 });
    }
  } else {
    mapping = detectMapping(headers);
  }

  if (!mapping || !headers.includes(mapping.title)) {
    return NextResponse.json({ needsMapping: true, headers, sample: rows.slice(0, 3) });
  }

  if (mapping.tag && !headers.includes(mapping.tag)) {
    return NextResponse.json({ error: "The tag column isn't in this file." }, { status: 400 });
  }

  // Tag column chosen, but no values picked yet: offer the values in that column.
  if (mapping.tag && !(mapping.tagValues && mapping.tagValues.length > 0)) {
    return NextResponse.json({ needsTagValues: true, values: tagValueCounts(text, mapping.tag), mapping });
  }

  const isGoodreads = !!detectMapping(headers);
  const prepared = rowsFromCsv(text, mapping);
  if (prepared.rows.length === 0) {
    return NextResponse.json(
      { error: "No rows matched. Check the title column and the tag values you picked." },
      { status: 400 },
    );
  }

  discardAwaitingJobs();
  const jobId = createJob(
    isGoodreads ? "Goodreads export" : "CSV import",
    file.name,
    prepared.rows.map((r) => ({ title: r.title, author: r.author, isbn: r.isbn })),
  );

  return NextResponse.json({
    jobId,
    total: prepared.rows.length,
    totalRows: prepared.totalRows,
    noTitle: prepared.noTitle,
    mapping,
  });
}
