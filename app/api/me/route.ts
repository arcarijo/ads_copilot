import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

/** Who am I? Lets client components adapt to the session role. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ role: null }, { status: 401 });
  return NextResponse.json({ role: session.role });
}
