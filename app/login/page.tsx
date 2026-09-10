"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { IconSparkle } from "@/components/ui/icons";
import { Button, Card, Field, Input } from "@/components/ui/primitives";
import { DEMO_LOGINS } from "@/lib/seed";
import { useStore } from "@/lib/store";
import { ROLE_LABEL } from "@/lib/types";

export default function LoginPage() {
  const { login, currentUser, ready, db } = useStore();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && currentUser) router.replace("/dashboard");
  }, [ready, currentUser, router]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = login(email, password);
    if (!result.ok) {
      setError(result.error ?? "Could not sign in.");
      return;
    }
    setError(null);
    router.replace("/dashboard");
  };

  const quickFill = (e: string, p: string) => {
    setEmail(e);
    setPassword(p);
    setError(null);
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
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
          <div className="inline-flex items-center gap-2.5">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-white">
              <IconSparkle size={20} />
            </span>
            <div>
              <div className="text-lg font-semibold tracking-tight">Synovative PMS</div>
              <div className="text-[11px] text-ink-faint">Agency project management</div>
            </div>
          </div>

          <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance">
            Every project, task and rupee — in one place.
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-ink-muted">
            Plan projects, assign work by department, track time to the minute,
            review submissions and keep vendor spend under control. The app
            adapts to your role the moment you sign in.
          </p>

          <dl className="grid grid-cols-3 gap-3 pt-1">
            {[
              { k: db.projects.length, v: "Projects" },
              { k: db.tasks.length, v: "Tasks" },
              { k: db.users.length, v: "People" },
            ].map((s) => (
              <div key={s.v} className="rounded-xl border border-line bg-surface/60 px-3 py-2.5">
                <dt className="text-lg font-semibold text-ink">{s.k}</dt>
                <dd className="text-[11px] text-ink-faint">{s.v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <Card className="p-6">
          <h2 className="text-base font-semibold tracking-tight">Sign in</h2>
          <p className="mt-0.5 mb-5 text-xs text-ink-muted">
            Use your work email address.
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
              <Input
                id="password"
                type="password"
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

            <Button type="submit" variant="primary" className="mt-1 w-full">
              Sign in
            </Button>
          </form>

          <div className="mt-6 border-t border-line-soft pt-4">
            <p className="mb-2.5 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
              Demo accounts — tap to fill
            </p>
            <div className="flex flex-wrap gap-1.5">
              {DEMO_LOGINS.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => quickFill(d.email, d.password)}
                  className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px] text-ink-muted transition-colors hover:border-brand-bright/50 hover:text-ink"
                >
                  {d.label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
              Each account demonstrates a different slice of the permission
              matrix — menus, buttons and data all change with the role.
              {" "}
              {ROLE_LABEL.super_admin} sees everything.
            </p>
          </div>
        </Card>
      </div>
    </main>
  );
}
