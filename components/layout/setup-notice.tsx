import { IconWarning } from "@/components/ui/icons";
import { Card } from "@/components/ui/primitives";

/** Shown instead of the app when .env.local doesn't have the Supabase keys yet. */
export function SetupNotice() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="w-full max-w-lg p-6">
        <div className="flex items-center gap-2.5">
          <IconWarning size={18} className="text-st-submitted" />
          <h1 className="text-lg font-semibold text-ink">Connect Supabase to finish setup</h1>
        </div>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-[13px] leading-relaxed text-ink-muted">
          <li>
            Copy <code className="font-mono text-ink">.env.example</code> to{" "}
            <code className="font-mono text-ink">.env.local</code> and fill in your Supabase URL,
            anon key and service-role key.
          </li>
          <li>
            Run the SQL files in <code className="font-mono text-ink">supabase/migrations</code> in
            order (0001 → 0006).
          </li>
          <li>
            Create the first Super Admin:{" "}
            <code className="font-mono text-ink">npm run create-admin -- --email … --name …</code>
          </li>
          <li>Restart the server.</li>
        </ol>
        <p className="mt-4 text-[11px] text-ink-faint">Full steps are in the README.</p>
      </Card>
    </main>
  );
}
