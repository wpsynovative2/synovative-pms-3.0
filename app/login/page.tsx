"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import {
  Button,
  Card,
  Field,
  Input,
  PasswordInput,
} from "@/components/ui/primitives";
import { SetupNotice } from "@/components/layout/setup-notice";
import { useStore } from "@/lib/store";

/** Where to go after signing in: the page the proxy bounced us from, if safe. */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export default function LoginPage() {
  const { login, currentUser, ready, configured } = useStore();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && currentUser) router.replace(nextPath());
  }, [ready, currentUser, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await login(email, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not sign in.");
      return;
    }
    router.replace(nextPath());
  };

  if (!configured) return <SetupNotice />;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <ThemeToggle className="absolute top-4 right-4 z-10" />
      {/* Brand wash */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[32rem] w-[52rem] -translate-x-1/2 rounded-full opacity-25 blur-[120px]"
        style={{
          background:
            "radial-gradient(circle at 30% 40%, #5F3CA7, transparent 60%), radial-gradient(circle at 70% 60%, #7C55D6, transparent 55%)",
        }}
      />

      <div className="relative grid w-full max-w-4xl gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col justify-center gap-5 px-2 py-4">
          <span role="img" aria-label="Synovative" className="inline-flex">
            <Image
              src="/Synovative-logo-Violet.png"
              alt=""
              width={2730}
              height={560}
              className="h-9 w-auto dark:hidden"
              priority
            />
            <Image
              src="/Synovative-logo-yellow.png"
              alt=""
              width={499}
              height={104}
              className="hidden h-9 w-auto dark:block"
              priority
            />
          </span>

          <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance">
            Every project, task and rupee — in one place.
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-ink-muted">
            Plan projects, assign work by department, track time to the minute,
            review submissions and keep vendor spend under control. The app
            adapts to your role the moment you sign in.
          </p>
        </div>

        <Card className="p-6">
          <h2 className="text-base font-semibold tracking-tight text-ink">Sign in</h2>
          <p className="mt-0.5 mb-5 text-xs text-ink-muted">
            Use your work email address. Accounts are created by your administrator.
          </p>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Email" required htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@synovative.in"
                required
              />
            </Field>

            <Field label="Password" required htmlFor="password">
              <PasswordInput
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </Field>

            {error ? (
              <p className="rounded-lg border border-st-rejected/30 bg-st-rejected/10 px-3 py-2 text-[12px] text-st-rejected">
                {error}
              </p>
            ) : null}

            <Button type="submit" variant="primary" className="mt-1 w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="mt-5 border-t border-line-soft pt-4 text-[11px] leading-relaxed text-ink-faint">
            Forgot your password? Ask a Super Admin, Admin or HR Admin to reset it from
            the Users page.
          </p>
        </Card>
      </div>
    </main>
  );
}
