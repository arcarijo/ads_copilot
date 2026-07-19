import { NextRequest, NextResponse } from "next/server";
import { prisma, log } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { safeEqual } from "@/lib/crypto";

/**
 * Admin utility: enable Row Level Security on every public table, closing the
 * Supabase auto-generated Data API (PostgREST) as an unauthenticated second
 * door into the database. No policies are created: default-deny for the
 * anon/authenticated API roles, while this app's Prisma connection — which
 * runs as the table OWNER — bypasses RLS entirely (owners are only subject to
 * RLS under FORCE, which we deliberately never apply).
 *
 * Fail-safe design: refuses to enable unless the connected role provably
 * bypasses RLS (table owner or BYPASSRLS attribute); verifies row counts and
 * a live write afterwards and auto-rolls back on any mismatch.
 *
 * Auth: admin session, or "Authorization: Bearer <CREDS_SECRET>".
 * Body: {"action":"diagnose"} (default) or {"action":"enable"}.
 */

const TABLES = [
  "User",
  "Client",
  "MetaAudience",
  "PlatformConnection",
  "BusinessProfile",
  "ResearchRun",
  "Campaign",
  "AnalyticsSnapshot",
  "Log",
  "Alert",
  "UsageEvent",
] as const;

interface TableState {
  relname: string;
  owner: string;
  rls_on: boolean;
  forced: boolean;
}

async function diagnose() {
  const [{ current_user }] = await prisma.$queryRaw<{ current_user: string }[]>`SELECT current_user`;
  const [{ rolbypassrls }] = await prisma.$queryRaw<{ rolbypassrls: boolean }[]>`
    SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  const states = await prisma.$queryRaw<TableState[]>`
    SELECT c.relname, pg_get_userbyid(c.relowner) AS owner,
           c.relrowsecurity AS rls_on, c.relforcerowsecurity AS forced
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
    ORDER BY c.relname`;
  const relevant = states.filter((s) => (TABLES as readonly string[]).includes(s.relname));
  // The app keeps working under RLS iff the connected role is exempt for
  // every table: BYPASSRLS, or it owns the table (and FORCE is off).
  const unsafe = relevant.filter((s) => !rolbypassrls && (s.owner !== current_user || s.forced));
  return { currentUser: current_user, bypassRls: rolbypassrls, tables: relevant, unsafe };
}

async function appCounts() {
  return {
    users: await prisma.user.count(),
    clients: await prisma.client.count(),
    campaigns: await prisma.campaign.count(),
    connections: await prisma.platformConnection.count(),
    audiences: await prisma.metaAudience.count(),
    alerts: await prisma.alert.count(),
  };
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const bearer = req.headers.get("authorization");
  const secret = process.env.CREDS_SECRET;
  const authorized = session?.role === "admin" || (secret && safeEqual(bearer, `Bearer ${secret}`));
  if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = body.action === "enable" ? "enable" : "diagnose";

  const diag = await diagnose();
  if (action === "diagnose") {
    return NextResponse.json({ ok: true, action, ...diag });
  }

  // Hard gate: never enable RLS the app itself would be subject to.
  if (diag.unsafe.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "Refusing to enable: the connected role would NOT bypass RLS on some tables — enabling would break the app.",
        ...diag,
      },
      { status: 409 }
    );
  }

  const before = await appCounts();
  const enabled: string[] = [];
  const alreadyOn = new Set(diag.tables.filter((t) => t.rls_on).map((t) => t.relname));

  try {
    for (const t of TABLES) {
      if (alreadyOn.has(t)) continue;
      await prisma.$executeRawUnsafe(`ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY`);
      enabled.push(t);
    }

    // Prove the app still sees and writes everything it did before.
    const after = await appCounts();
    const mismatch = (Object.keys(before) as (keyof typeof before)[]).filter((k) => before[k] !== after[k]);
    if (mismatch.length > 0) {
      throw new Error(`Row visibility changed for: ${mismatch.join(", ")}`);
    }
    await log("UI", `RLS enabled on ${enabled.length} table(s); app visibility verified unchanged.`, {
      detail: { enabled, before, after },
    });

    const post = await diagnose();
    return NextResponse.json({ ok: true, action, enabled, counts: { before, after }, state: post.tables });
  } catch (err) {
    // Roll back everything this call turned on, then report.
    for (const t of enabled) {
      await prisma.$executeRawUnsafe(`ALTER TABLE public."${t}" DISABLE ROW LEVEL SECURITY`).catch(() => {});
    }
    return NextResponse.json(
      { ok: false, error: `Verification failed, rolled back ${enabled.length} table(s): ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
