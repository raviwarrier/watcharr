import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { CALIBRE_DIR, MAX_CALIBRE_BYTES, looksLikeCalibre, saveCalibreCopy } from "@/lib/calibre";
import { setSetting } from "@/lib/db";

/** POST /api/reconcile/calibre/upload (multipart: file = metadata.db). Stores a read-only copy. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose the metadata.db file from your Calibre library folder." }, { status: 400 });
  }
  if (file.size > MAX_CALIBRE_BYTES) {
    return NextResponse.json({ error: "That file is larger than 300 MB. Check you chose metadata.db." }, { status: 413 });
  }

  fs.mkdirSync(CALIBRE_DIR, { recursive: true });
  const tmp = path.join(CALIBRE_DIR, `upload-${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, Buffer.from(await file.arrayBuffer()));
    if (!looksLikeCalibre(tmp)) {
      return NextResponse.json({ error: "That isn't a Calibre library file. Choose metadata.db from the Calibre library folder." }, { status: 400 });
    }
    saveCalibreCopy(tmp);
    await setSetting("calibreUploadedAt", new Date().toISOString());
    return NextResponse.json({ ok: true });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
