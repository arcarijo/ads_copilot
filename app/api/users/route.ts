import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { listClerkUsers } from "@/lib/clerk";

/**
 * Admin only (also enforced in middleware): the Clerk users, for the client
 * assignment UI. User identity/lifecycle lives in Clerk — there is no create
 * here anymore.
 */
export async function GET() {
  const auth = await requireSession("admin");
  if (auth.response) return auth.response;
  const users = await listClerkUsers();
  return NextResponse.json({ users });
}
