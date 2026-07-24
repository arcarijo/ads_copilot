import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";

const LEVELS = ["ERROR", "WARN", "INFO"] as const;

/** Admin-only: clear diagnostics log entries, optionally scoped to one level. */
export async function DELETE(req: NextRequest) {
  const auth = await requireSession("admin");
  if (auth.response) return auth.response;

  const level = req.nextUrl.searchParams.get("level");
  if (level && !LEVELS.includes(level as (typeof LEVELS)[number])) {
    return NextResponse.json({ error: "Invalid level" }, { status: 400 });
  }

  const { count } = await prisma.log.deleteMany({ where: level ? { level } : undefined });
  return NextResponse.json({ ok: true, count });
}
