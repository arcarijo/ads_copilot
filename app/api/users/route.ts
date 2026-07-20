import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { log } from "@/lib/db";
import { listClerkUsers, inviteClerkUser } from "@/lib/clerk";
import { cleanText, isEmail } from "@/lib/sanitize";

/**
 * Admin only (also enforced in middleware). GET lists Clerk users for the
 * management UI; POST emails an invitation. Lifecycle otherwise lives in Clerk.
 */
export async function GET() {
  const auth = await requireSession("admin");
  if (auth.response) return auth.response;
  const users = await listClerkUsers();
  return NextResponse.json({ users });
}

/** Invite a new user by email. */
export async function POST(req: NextRequest) {
  const auth = await requireSession("admin");
  if (auth.response) return auth.response;
  const b = await req.json().catch(() => ({}));
  const email = cleanText(b.email, 254).toLowerCase();
  if (!email || !isEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 422 });
  }
  try {
    await inviteClerkUser(email);
  } catch {
    return NextResponse.json(
      { error: "Couldn't send the invite — they may already be invited or a member." },
      { status: 400 },
    );
  }
  await log("UI", `Invited ${email} to the app.`);
  return NextResponse.json({ ok: true });
}
