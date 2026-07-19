import { defineConfig } from "vitest/config";

// Unit tests target the money- and security-critical pure logic (guardrails,
// crypto, session signing, SSRF guard, rate limiter) — the invariants that
// stand between the AI and real spend or data exposure. Node environment; no
// DB, no network. Env keys are set here so the crypto/session code under test
// has deterministic secrets.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: {
      CREDS_SECRET: "test-creds-secret-deterministic",
      SESSION_SECRET: "test-session-secret-deterministic",
      ADMIN_PASSWORD: "test-admin-password",
    },
  },
});
