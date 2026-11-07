import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isValidCalendarToken, isValidSession } from "@/lib/auth";

/**
 * Access gate. Runs before every page and API route (except static files).
 *  - Pages redirect to /login when there is no valid session.
 *  - API routes return 401 JSON when there is no valid session.
 *  - The calendar feed also accepts ?token=, so calendar apps can subscribe without signing in.
 *  - /login and /api/auth/* stay open, so people can sign in.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname === "/login" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  const signedIn = isValidSession(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/api/calendar.ics") {
    if (signedIn || isValidCalendarToken(request.nextUrl.searchParams.get("token"))) {
      return NextResponse.next();
    }
    return new NextResponse("Unauthorized. Add your calendar token: ?token=...", {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (signedIn) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next.js's own static assets so the login page can load its styles and scripts.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
