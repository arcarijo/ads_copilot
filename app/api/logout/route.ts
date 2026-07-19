import { NextResponse } from "next/server";

/** Clear the session cookie. The signed token itself dies at its exp claim. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("adm", "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 0, path: "/" });
  return res;
}
