"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { useStore } from "@/lib/store";

/** Auth gate for every signed-in surface. */
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const { ready, currentUser } = useStore();
  const router = useRouter();

  useEffect(() => {
    if (ready && !currentUser) router.replace("/login");
  }, [ready, currentUser, router]);

  if (!ready || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand-bright" />
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
