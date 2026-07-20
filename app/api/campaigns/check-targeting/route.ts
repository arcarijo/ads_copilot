import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { aiRateLimited } from "@/lib/rateLimit";
import { cleanText } from "@/lib/sanitize";
import { validateTargeting } from "@/lib/targeting";
import { checkAudience } from "@/lib/audienceCheck";

/**
 * Advisory audience/targeting gap-check. Any signed-in user; rate-limited
 * because it runs a 70B inference. Never persists anything, never blocks launch.
 */
export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  if (aiRateLimited(auth.session, req.headers)) {
    return NextResponse.json({ error: "Slow down — too many checks in a row. Try again shortly." }, { status: 429 });
  }
  const b = await req.json().catch(() => ({}));
  const tv = validateTargeting(b.targeting);
  const targeting = "values" in tv ? tv.values : undefined;
  try {
    const result = await checkAudience({
      goal: cleanText(b.goal ?? "", 200),
      targetAudience: cleanText(b.targetAudience ?? "", 4000),
      targeting,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 422 });
  }
}
