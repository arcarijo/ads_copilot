// Tier 2: SSRF hardening of the research crawler. The crawler fetches
// user-supplied URLs (website / socials / GMB / extraUrls) and is gated by
// lib/urlSafety.isSafePublicUrl on every hop. Rather than trigger an expensive
// live research run (real scraping + AI), we validate the guard directly
// against a payload set — every one of these MUST be rejected. Integer-encoded
// loopback addresses (decimal/hex/octal) are the classic guard bypass, since
// OS resolvers expand them to 127.0.0.1 but they don't match a dotted-quad.

import { isSafePublicUrl } from "../../../lib/urlSafety";
import type { Check, Finding } from "../types";
import { worst } from "../types";

// Each must be REJECTED (isSafePublicUrl === false) for the guard to be sound.
const MUST_REJECT: string[] = [
  "http://localhost/",
  "http://127.0.0.1/",
  "http://0.0.0.0/",
  "http://169.254.169.254/latest/meta-data/", // cloud metadata
  "http://[::1]/",
  "http://[fd00::1]/",
  "http://10.0.0.5/",
  "http://192.168.1.1/",
  "http://172.16.0.1/",
  "http://foo.internal/",
  "http://metadata.google.internal/",
  "http://service.local/",
  "http://app.localhost/",
  "file:///etc/passwd",
  "gopher://127.0.0.1:6379/",
  "http://user:pass@127.0.0.1/",
  // Integer-encoded loopback — the encoding bypasses a dotted-quad-only filter:
  "http://2130706433/", // decimal 127.0.0.1
  "http://0x7f000001/", // hex 127.0.0.1
  "http://017700000001/", // octal 127.0.0.1
];

export const ssrfCheck: Check = async () => {
  const start = Date.now();
  const findings: Finding[] = [];

  const allowed = MUST_REJECT.filter((u) => isSafePublicUrl(u));
  if (allowed.length === 0) {
    findings.push({ status: "PASS", title: `SSRF guard rejects all ${MUST_REJECT.length} payloads` });
  } else {
    findings.push({
      status: "FAIL",
      title: `SSRF guard ALLOWS ${allowed.length} internal/metadata target(s)`,
      detail: `Should be rejected but passed isSafePublicUrl():\n${allowed.join("\n")}`,
    });
  }

  // A couple of legitimately-public URLs must still be allowed (no false-deny).
  const mustAllow = ["https://example.com/", "https://facebook.com/acme"];
  const denied = mustAllow.filter((u) => !isSafePublicUrl(u));
  findings.push(
    denied.length === 0
      ? { status: "PASS", title: "SSRF guard still allows legitimate public URLs" }
      : { status: "WARN", title: "SSRF guard over-blocks", detail: denied.join("\n") },
  );

  return { name: "ssrf", status: worst(findings), findings, durationMs: Date.now() - start };
};
