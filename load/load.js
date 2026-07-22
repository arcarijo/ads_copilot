// k6 load test — ramps concurrent virtual users against the preview storefront
// to find latency/error thresholds under stress. Public surface only (no auth),
// so it's safe to hammer staging without seeding sessions.
//
//   docker run --rm -e TARGET=$URL -e BYPASS=$SECRET -i grafana/k6 run - < load/load.js
import http from "k6/http";
import { check } from "k6";

const TARGET = __ENV.TARGET;
const BYPASS = __ENV.BYPASS || "";
const params = { headers: BYPASS ? { "x-vercel-protection-bypass": BYPASS } : {} };

export const options = {
  stages: [
    { duration: "20s", target: 10 }, // ramp up
    { duration: "30s", target: 20 }, // sustain
    { duration: "10s", target: 0 }, // ramp down
  ],
  thresholds: {
    http_req_failed: ["rate<0.02"], // <2% errors under load
    http_req_duration: ["p(95)<2000"], // p95 under 2s under load
  },
};

export default function () {
  const res = http.get(`${TARGET}/login`, params);
  check(res, { "storefront 200": (r) => r.status === 200 });
}
