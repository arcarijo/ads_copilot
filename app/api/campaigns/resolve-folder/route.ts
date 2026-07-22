import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { extractDriveFolderId, listDriveFolderImages } from "@/lib/drive";
import { aiRateLimited } from "@/lib/rateLimit";

/**
 * Preview a Google Drive folder link for a carousel: validate it's a folder,
 * list its images, and enforce the 2–10 bound — so the owner sees the count
 * before launch. Auth-required. Returns count + names only (file ids stay
 * server-side; the launcher re-resolves them at spend time).
 */
export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (auth.response) return auth.response;

  // Every call hits the shared Drive API key's quota, same as the AI-backed
  // routes hit the shared Cloudflare quota — throttle it the same way.
  if (aiRateLimited(auth.session, req.headers)) {
    return NextResponse.json({ ok: false, error: "Too many folder checks — please wait a moment and try again." }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { url?: unknown };
  const url = typeof body.url === "string" ? body.url : "";
  const folderId = extractDriveFolderId(url);
  if (!folderId) {
    return NextResponse.json({ ok: false, error: "That isn't a Google Drive folder link." }, { status: 400 });
  }

  try {
    const result = await listDriveFolderImages(folderId);
    return NextResponse.json({
      ok: result.ok,
      count: result.count,
      names: result.images.map((im) => im.name),
      error: result.error,
    });
  } catch (err) {
    // Missing key / Drive outage: log the real reason, keep the user message clean.
    console.error("[resolve-folder]", (err as Error).message);
    return NextResponse.json({ ok: false, error: "Couldn't check that folder right now — please contact your admin." }, { status: 502 });
  }
}
