// k6 smoke test — a quick "does it stand up" pass against the preview.
// Hits the public storefront + sign-in surface (no auth needed). The Vercel
// protection-bypass header clears Deployment Protection.
//
//   docker run --rm -e TARGET=$URL -e BYPASS=$SECRET -i grafana/k6 run - < load/smoke.js
import http from "k6/http";
import { check, sleep } from "k6";

const TARGET = __ENV.TARGET;
const BYPASS = __ENV.BYPASS || "";
const params = { headers: BYPASS ? { "x-vercel-protection-bypass": BYPASS } : {} };

export const options = {
  vus: 1,
  iterations: 10,
  thresholds: {
    http_req_failed: ["rate<0.01"], // <1% errors
    http_req_duration: ["p(95)<1500"], // p95 under 1.5s (cold-start tolerant)
  },
};

export default function () {
  const paths = ["/login", "/sign-in"];
  for (const p of paths) {
    const res = http.get(`${TARGET}${p}`, params);
    check(res, { [`${p} is 200`]: (r) => r.status === 200 });
  }
  sleep(1);
}
