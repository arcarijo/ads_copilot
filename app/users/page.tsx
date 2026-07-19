import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { listClerkUsers } from "@/lib/clerk";
import { UsersManager } from "./UsersManager";

export const dynamic = "force-dynamic";

/** Admin-only (also gated in middleware): assign Clerk users to businesses. */
export default async function UsersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/");

  const [users, clients] = await Promise.all([
    listClerkUsers(),
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, clerkUserId: true } }),
  ]);

  return (
    <UsersManager
      users={users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        clientIds: clients.filter((c) => c.clerkUserId === u.id).map((c) => c.id),
      }))}
      clients={clients}
    />
  );
}
