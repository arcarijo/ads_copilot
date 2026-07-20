import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import OnboardForm from "./OnboardForm";

export const dynamic = "force-dynamic";

export default async function OnboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <OnboardForm admin={session.role === "admin"} />;
}
