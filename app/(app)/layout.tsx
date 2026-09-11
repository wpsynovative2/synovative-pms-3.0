"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { SetupNotice } from "@/components/layout/setup-notice";
import { useStore } from "@/lib/store";

/** Auth gate for every signed-in surface. */
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const { ready, currentUser, configured } = useStore();
  const router = useRouter();

  useEffect(() => {
    if (configured && ready && !currentUser) router.replace("/login");
  }, [configured, ready, currentUser, router]);

  if (!configured) return <SetupNotice />;

  if (!ready || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand-bright" />
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
