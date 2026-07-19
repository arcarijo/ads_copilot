import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Clerk owns the session; this gate decides route access. Public routes need no
 * session (sign-in + the Bearer-secured operational endpoints, which enforce
 * their own auth). Everything else requires a signed-in Clerk user. Admin
 * surfaces additionally require the "admin" role claim — checked here at the
 * edge and again server-side in requireSession("admin") for defense in depth.
 */
const isPublic = createRouteMatcher([
  "/login", // public marketing landing (the storefront)
  "/sign-in(.*)",
  "/api/cron",
  "/api/admin/encrypt",
  "/api/admin/rls",
]);
const isAdminOnly = createRouteMatcher(["/users(.*)", "/api/users(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublic(req)) return;

  const { userId, sessionClaims } = await auth();
  if (!userId) {
    // Signed-out: APIs get 401; pages go to the /login storefront, whose
    // "Sign in" CTA hands off to Clerk's /sign-in.
    return req.nextUrl.pathname.startsWith("/api/")
      ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", req.url));
  }

  if (isAdminOnly(req)) {
    const role = (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role;
    if (role !== "admin") {
      return req.nextUrl.pathname.startsWith("/api/")
        ? NextResponse.json({ error: "Admin only" }, { status: 403 })
        : NextResponse.redirect(new URL("/", req.url));
    }
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files, run on everything else.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
