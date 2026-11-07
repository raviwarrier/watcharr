import { NextResponse } from "next/server";
import { z } from "zod";
import { AbsError, listBookLibraries, loginAbs, probeAbs } from "@/lib/audiobookshelf";
import { checkServiceUrl } from "@/lib/safe-url";
import { setSetting } from "@/lib/db";
import { clearAbsIndex } from "@/lib/reconcile";

const bodySchema = z.object({
  url: z.string().trim().min(1).max(500),
  mode: z.enum(["apiKey", "login"]),
  apiKey: z.string().trim().max(1000).optional(),
  username: z.string().trim().max(200).optional(),
  password: z.string().max(1000).optional(),
  libraryId: z.string().trim().max(200).optional(),
});

/**
 * POST /api/reconcile/abs/connect
 * Checks the address is Audiobookshelf, checks the credentials, and saves the connection.
 * With username and password, the password is used once to get a token and is not stored.
 * If the account has more than one book library and none was chosen, returns the list to pick from.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Fill in the address and credentials." }, { status: 400 });
  const body = parsed.data;

  try {
    const base = checkServiceUrl(body.url);
    const server = await probeAbs(base);

    let token: string;
    if (body.mode === "apiKey") {
      if (!body.apiKey) return NextResponse.json({ error: "Enter the API key." }, { status: 400 });
      token = body.apiKey;
    } else {
      if (!body.username || !body.password) {
        return NextResponse.json({ error: "Enter the username and password." }, { status: 400 });
      }
      token = await loginAbs(base, body.username, body.password);
    }

    const libraries = await listBookLibraries(base, token);
    if (libraries.length === 0) {
      return NextResponse.json({ error: "No audiobook libraries were found for this account." }, { status: 400 });
    }

    let libraryId = body.libraryId;
    if (!libraryId && libraries.length === 1) libraryId = libraries[0].id;
    if (!libraryId) {
      return NextResponse.json({ needsLibrary: true, libraries, version: server.version });
    }
    if (!libraries.some((l) => l.id === libraryId)) {
      return NextResponse.json({ error: "That library isn't available for this account." }, { status: 400 });
    }

    await setSetting("absUrl", base);
    await setSetting("absAuthMode", body.mode === "login" ? "login" : "apiKey");
    await setSetting("absSecret", token);
    await setSetting("absLibraryId", libraryId);
    clearAbsIndex();

    return NextResponse.json({ ok: true, version: server.version, libraryId, libraries });
  } catch (err) {
    if (err instanceof AbsError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof Error && err.message.startsWith("That ")) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not connect to Audiobookshelf." }, { status: 500 });
  }
}
