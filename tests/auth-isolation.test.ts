import { describe, it, expect, vi, beforeEach } from "vitest";

// Inject Clerk identities by mocking auth(). currentClerkPrincipal() reads
// { userId, sessionClaims } off of it.
const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
  clerkClient: vi.fn(),
}));

// Mock the DB layer used by canAccess*.
vi.mock("../lib/db", () => ({
  prisma: {
    client: { findUnique: vi.fn() },
    campaign: { findUnique: vi.fn() },
  },
}));

import { prisma } from "../lib/db";
import {
  getSession,
  canAccessClient,
  canAccessCampaign,
  clientScope,
  campaignScope,
} from "../lib/auth";

beforeEach(() => vi.clearAllMocks());

describe("getSession", () => {
  it("returns admin when the role claim is admin", async () => {
    authMock.mockResolvedValue({ userId: "user_admin", sessionClaims: { metadata: { role: "admin" } } });
    expect(await getSession()).toEqual({ role: "admin" });
  });
  it("returns a scoped user otherwise", async () => {
    authMock.mockResolvedValue({ userId: "user_A", sessionClaims: { metadata: {} } });
    expect(await getSession()).toEqual({ role: "user", userId: "user_A" });
  });
  it("returns null when unauthenticated", async () => {
    authMock.mockResolvedValue({ userId: null, sessionClaims: null });
    expect(await getSession()).toBeNull();
  });
});

describe("tenant isolation", () => {
  it("owner A CANNOT access owner B's client", async () => {
    (prisma.client.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ clerkUserId: "user_B" });
    expect(await canAccessClient({ role: "user", userId: "user_A" }, "c1")).toBe(false);
  });
  it("owner A CAN access their own client", async () => {
    (prisma.client.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ clerkUserId: "user_A" });
    expect(await canAccessClient({ role: "user", userId: "user_A" }, "c1")).toBe(true);
  });
  it("admin can access any client", async () => {
    expect(await canAccessClient({ role: "admin" }, "c1")).toBe(true);
  });
  it("owner A CANNOT access owner B's campaign", async () => {
    (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ client: { clerkUserId: "user_B" } });
    expect(await canAccessCampaign({ role: "user", userId: "user_A" }, "camp1")).toBe(false);
  });
  it("owner A CAN access their own campaign", async () => {
    (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ client: { clerkUserId: "user_A" } });
    expect(await canAccessCampaign({ role: "user", userId: "user_A" }, "camp1")).toBe(true);
  });
  it("scopes restrict users to their own id and admins to all", () => {
    expect(clientScope({ role: "user", userId: "user_A" })).toEqual({ clerkUserId: "user_A" });
    expect(clientScope({ role: "admin" })).toEqual({});
    expect(campaignScope({ role: "user", userId: "user_A" })).toEqual({ client: { clerkUserId: "user_A" } });
    expect(campaignScope({ role: "admin" })).toEqual({});
  });
});
