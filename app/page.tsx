"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { SetupNotice } from "@/components/layout/setup-notice";
import { useStore } from "@/lib/store";

/** Entry point — send signed-in users to their dashboard, everyone else to login. */
export default function Home() {
  const { ready, currentUser, configured } = useStore();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    router.replace(currentUser ? "/dashboard" : "/login");
  }, [ready, currentUser, router]);

  if (!configured) return <SetupNotice />;

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand-bright" />
        <p className="text-xs text-ink-faint">Loading Synovative PMS…</p>
      </div>
    </main>
  );
}
