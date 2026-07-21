import { NextResponse } from "next/server";
import { currentClerkPrincipal } from "@/lib/clerk";

/**
 * Who am I? Lets client components adapt to the session role. The Clerk user id
 * is returned so the client can namespace local draft storage per user (so a
 * shared browser never restores another user's in-progress form).
 */
export async function GET() {
  const p = await currentClerkPrincipal();
  if (!p) return NextResponse.json({ role: null }, { status: 401 });
  return NextResponse.json({ role: p.role === "admin" ? "admin" : "user", userId: p.userId });
}
