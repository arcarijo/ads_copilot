import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { listClerkUsers, currentClerkPrincipal } from "@/lib/clerk";
import { UsersManager } from "./UsersManager";

export const dynamic = "force-dynamic";

/** Admin-only (also gated in middleware): manage Clerk users + business access. */
export default async function UsersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/");

  const [users, clients, me] = await Promise.all([
    listClerkUsers(),
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, clerkUserId: true } }),
    currentClerkPrincipal(),
  ]);

  return (
    <UsersManager
      selfId={me?.userId ?? null}
      users={users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        banned: u.banned,
        lastSignInAt: u.lastSignInAt,
        clientIds: clients.filter((c) => c.clerkUserId === u.id).map((c) => c.id),
      }))}
      clients={clients}
    />
  );
}
