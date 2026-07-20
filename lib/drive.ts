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
    v.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/) ||
    v.match(/[?&]id=([A-Za-z0-9_-]{10,})/) ||
    v.match(/\/d\/([A-Za-z0-9_-]{10,})/);
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
