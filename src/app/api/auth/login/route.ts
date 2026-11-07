import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  accessKeyHash,
  isConfigured,
  isValidAccessKey,
  sessionValueFor,
} from "@/lib/auth";

// Failed attempts are counted across the app. This is a single-user app, so one shared counter is enough.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const state = globalThis as unknown as { loginFailures?: { count: number; since: number } };

function tooManyFailures(): boolean {
  const f = state.loginFailures;
  if (!f) return false;
  if (Date.now() - f.since > WINDOW_MS) {
    state.loginFailures = undefined;
    return false;
  }
  return f.count >= MAX_FAILURES;
}

function recordFailure() {
  const f = state.loginFailures;
  if (!f || Date.now() - f.since > WINDOW_MS) {
    state.loginFailures = { count: 1, since: Date.now() };
  } else {
    f.count++;
  }
}

/** POST /api/auth/login  { key } - sets the session cookie on success. */
export async function POST(req: Request) {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: "No access key is set. Run the install script to create one." },
      { status: 503 },
    );
  }
  if (tooManyFailures()) {
    return NextResponse.json({ error: "Too many attempts. Wait 15 minutes and try again." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (!isValidAccessKey(key)) {
    recordFailure();
    return NextResponse.json({ error: "That access key isn't right." }, { status: 401 });
  }

  state.loginFailures = undefined;
  const response = NextResponse.json({ ok: true });
  // Mark the cookie Secure when the request came in over HTTPS (directly or through a proxy).
  const https = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  response.cookies.set(SESSION_COOKIE, sessionValueFor(accessKeyHash()!), {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    secure: https,
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return response;
}
