import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { UsersManager } from "./UsersManager";

export const dynamic = "force-dynamic";

/** Admin-only (also gated in middleware): manage client logins. */
export default async function UsersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/");

  const [users, clients] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, email: true, createdAt: true, clients: { select: { id: true, name: true } } },
    }),
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, userId: true } }),
  ]);

  return (
    <UsersManager
      users={users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        createdAt: u.createdAt.toISOString().slice(0, 10),
        clientIds: u.clients.map((c) => c.id),
      }))}
      clients={clients}
    />
  );
}
