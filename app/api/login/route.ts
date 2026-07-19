import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, createHash } from "crypto";
import { prisma, log } from "@/lib/db";
import { sha256Hex, signSession, sessionSecret, SESSION_MAX_AGE_SECONDS, Session } from "@/lib/session";
import { passcodeHashV2 } from "@/lib/crypto";
import { rateLimited, clientIp } from "@/lib/rateLimit";

/**
 * One login box, two kinds of people: the master admin (ADMIN_PASSWORD env
 * var) and client users (per-user passcodes managed by the admin at /users).
 * Hardened: per-IP rate limit, constant-time admin comparison, peppered (v2)
 * passcode hashes with transparent upgrade of legacy unsalted rows.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  // 10 attempts per 15 minutes per IP, wide 100/hour global backstop.
  if (rateLimited(`login:${ip}`, 10, 15 * 60 * 1000) || rateLimited("login:*", 100, 60 * 60 * 1000)) {
    await log("UI", `Login rate limit hit (ip ${ip}).`, { level: "WARN" });
    return NextResponse.json({ error: "Too many attempts — try again in a few minutes." }, { status: 429 });
  }

  const { password } = await req.json().catch(() => ({}));
  const adminPassword = process.env.ADMIN_PASSWORD;
  const secret = sessionSecret();
  if (!adminPassword || !secret || typeof password !== "string" || !password || password.length > 200) {
    return NextResponse.json({ error: "Wrong passcode" }, { status: 401 });
  }

  let session: Session | null = null;
  // Constant-time compare over fixed-length digests — no early-exit or
  // length leak on the admin password.
  const a = createHash("sha256").update(password, "utf8").digest();
  const b = createHash("sha256").update(adminPassword, "utf8").digest();
  if (timingSafeEqual(a, b)) {
    session = { role: "admin" };
  } else {
    // Peppered v2 hash first; fall back to the legacy unsalted sha256 and
    // upgrade the row in place on a successful match.
    const v2 = passcodeHashV2(password);
    let user = v2 ? await prisma.user.findUnique({ where: { passcodeHash: v2 } }) : null;
    if (!user) {
      const legacy = await sha256Hex(password);
      user = await prisma.user.findUnique({ where: { passcodeHash: legacy } });
      if (user && v2) {
        await prisma.user.update({ where: { id: user.id }, data: { passcodeHash: v2 } });
      }
    }
    if (user) session = { role: "user", userId: user.id };
  }
  if (!session) {
    await log("UI", `Failed login attempt (ip ${ip}).`, { level: "WARN" });
    return NextResponse.json({ error: "Wrong passcode" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, role: session.role });
  res.cookies.set("adm", await signSession(session, secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return res;
}
