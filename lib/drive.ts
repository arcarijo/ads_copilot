// Normalize a creative media source into a URL Meta can fetch. We never store
// the file: Google Drive holds it until launch, then Meta pulls it (video via
// /advideos file_url → video_id; image via link_data.picture). Accepts a Drive
// share link (any common shape) or a plain public https URL.

export interface NormalizedMedia {
  url: string;
  isDrive: boolean;
}

/** Extract a Drive file id from the common share-link shapes. */
function driveFileId(v: string): string | null {
  if (!/^https?:\/\/(drive|docs)\.google\.com\//i.test(v)) return null;
  const m =
    v.match(/\/file\/d\/([A-Za-z0-9_-]{10,100})/) ||
    v.match(/[?&]id=([A-Za-z0-9_-]{10,100})/) ||
    v.match(/\/d\/([A-Za-z0-9_-]{10,100})/);
  return m ? m[1] : null;
}

/**
 * Returns a Meta-fetchable https URL, or null if the input isn't a usable
 * Drive link / public https URL. Drive links become a direct-download URL.
 * (The Drive file must be shared "anyone with the link".)
 */
export function normalizeMediaUrl(raw: string): NormalizedMedia | null {
  const v = (raw ?? "").trim();
  if (!v) return null;

  const id = driveFileId(v);
  if (id) return { url: `https://drive.google.com/uc?export=download&id=${id}`, isDrive: true };

  // Otherwise accept only a plain public https URL (Meta fetches it directly).
  try {
    const u = new URL(v);
    if (u.protocol !== "https:") return null;
    return { url: u.toString(), isDrive: false };
  } catch {
    return null;
  }
}

/** True if a stored value still needs resolving (a link), vs an already-uploaded Meta id. */
export function looksLikeUrl(v: string): boolean {
  return /^https?:\/\//i.test((v ?? "").trim());
}

// --------------------------------------------------------------------------
// Google Drive FOLDER support (carousels only). A shared folder link expands
// into the images inside it, so owners can drop a folder instead of pasting
// each link. Security model: read-only Drive API key, server-only; the only
// user input is a regex-validated folder id embedded in a fixed googleapis.com
// call (no SSRF, no query injection); we never fetch or store the bytes — Meta
// pulls each resolved image URL, exactly as with individual links.
// --------------------------------------------------------------------------

export const CAROUSEL_MIN = 2;
export const CAROUSEL_MAX = 10;

/** Extract a Drive folder id from a share link. Only the explicit `/folders/`
 * shape counts (the `?id=` form is ambiguous with files). */
export function extractDriveFolderId(v: string): string | null {
  const s = (v ?? "").trim();
  if (!/^https?:\/\/(drive|docs)\.google\.com\//i.test(s)) return null;
  const m = s.match(/\/folders\/([A-Za-z0-9_-]{10,100})/);
  return m ? m[1] : null;
}

interface DriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
}

export interface FolderImages {
  ok: boolean;
  count: number; // images actually found (may exceed CAROUSEL_MAX)
  images: { id: string; name: string }[]; // populated (2..MAX) only when ok
  error?: string;
}

/**
 * Pure: turn a Drive file listing into a validated carousel image set. Kept
 * separate from the network call so the filter + bounds logic is unit-testable.
 */
export function interpretFolderListing(files: DriveFile[], min = CAROUSEL_MIN, max = CAROUSEL_MAX): FolderImages {
  const images = files
    .filter((f) => typeof f.id === "string" && typeof f.mimeType === "string" && f.mimeType.startsWith("image/"))
    .map((f) => ({ id: f.id as string, name: (f.name as string) || "image" }));
  const count = images.length;
  if (count === 0) {
    return { ok: false, count, images: [], error: 'No images found in that folder — check it contains image files and is shared "Anyone with the link".' };
  }
  if (count < min) return { ok: false, count, images, error: `Only ${count} image in that folder — a carousel needs at least ${min}.` };
  if (count > max) {
    return { ok: false, count, images: [], error: `That folder has ${count} images — carousels allow up to ${max}. Move the extras out (or into a subfolder) and try again.` };
  }
  return { ok: true, count, images };
}

/**
 * List the images in a public Drive folder via the read-only Drive API key.
 * Throws if the key isn't configured; returns a validated FolderImages otherwise.
 */
export async function listDriveFolderImages(folderId: string, min = CAROUSEL_MIN, max = CAROUSEL_MAX): Promise<FolderImages> {
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(folderId)) {
    return { ok: false, count: 0, images: [], error: "That doesn't look like a valid Drive folder link." };
  }
  const key = process.env.GOOGLE_DRIVE_API_KEY;
  if (!key) throw new Error("Google Drive folder support isn't configured — please contact your admin.");

  // folderId is regex-validated above (no quotes/spaces), so it can't break out
  // of the q-string; the host is a fixed Google endpoint (no SSRF surface).
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`);
  url.searchParams.set("key", key);
  url.searchParams.set("fields", "files(id,name,mimeType)");
  url.searchParams.set("orderBy", "name");
  url.searchParams.set("pageSize", "50");

  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) {
    if (res.status === 403 || res.status === 404) {
      return { ok: false, count: 0, images: [], error: 'Couldn’t read that folder — make sure it’s a folder link shared "Anyone with the link".' };
    }
    throw new Error(`Google Drive returned HTTP ${res.status}.`);
  }
  const json = (await res.json().catch(() => ({}))) as { files?: unknown };
  const files = Array.isArray(json.files) ? (json.files as DriveFile[]) : [];
  return interpretFolderListing(files, min, max);
}
