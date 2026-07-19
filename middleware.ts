import { NextRequest, NextResponse } from "next/server";
import { sessionSecret, verifySession } from "./lib/session";

/**
 * Site-wide auth gate. The app is publicly reachable but every page and API
 * (except /login and the Bearer-secured /api/cron) requires a valid signed
 * session cookie — either the master admin or a client user. Admin-only
 * surfaces (/users) are additionally role-checked here at the edge; data
 * scoping happens server-side in each page/route via lib/auth.ts.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    pathname === "/login" ||
    pathname === "/api/login" ||
    pathname === "/api/cron" ||
    pathname === "/api/admin/encrypt" || // enforces its own admin/Bearer auth
    pathname === "/api/admin/rls" || // enforces its own admin/Bearer auth

    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const secret = sessionSecret();
  if (!secret) {
    return new NextResponse("Auth secret is not configured — refusing to serve.", { status: 503 });
  }

  const session = await verifySession(req.cookies.get("adm")?.value, secret);
  if (session) {
    const adminOnly = pathname === "/users" || pathname.startsWith("/users/") || pathname.startsWith("/api/users");
    if (adminOnly && session.role !== "admin") {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Admin only" }, { status: 403 });
      }
      const url = req.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
