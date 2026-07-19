import { SignIn } from "@clerk/nextjs";

export const metadata = { title: "Sign in — Copilot" };

export default function Page() {
  return (
    <main
      className="grid min-h-screen place-items-center px-6 py-16"
      style={{ background: "var(--canvas)" }}
    >
      <SignIn signUpUrl="/sign-in" fallbackRedirectUrl="/" />
    </main>
  );
}
