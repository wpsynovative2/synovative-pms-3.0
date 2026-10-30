import type { Metadata } from "next";
import { Card } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Privacy policy" };

/*
 * Public, so Google's OAuth consent screen can link to it: publishing the
 * Drive connection (scripts/google-auth.mjs) needs a home page and a privacy
 * policy on the app's own domain. proxy.ts lets signed-out visitors through.
 */
export default function PrivacyPage() {
  return (
    <main className="flex min-h-screen justify-center px-4 py-10">
      <Card className="w-full max-w-2xl p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Privacy policy</h1>
        <p className="mt-1 text-xs text-ink-faint">Synovative PMS · Last updated 30 October 2026</p>

        <div className="mt-6 flex flex-col gap-5 text-[13px] leading-relaxed text-ink-muted">
          <section>
            <h2 className="mb-1 text-sm font-semibold text-ink">Who this is for</h2>
            <p>
              Synovative PMS is the in-house project management system of Synovative, a digital
              marketing agency in Mumbai. Only the agency&rsquo;s staff can sign in; it is not
              offered to the public.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-sm font-semibold text-ink">What we keep</h2>
            <p>
              Staff accounts (name, work email, role and department) and the work recorded in the
              system: projects, tasks, time logs, expenses, client and vendor details, and the
              comments and files attached to them. It is used only to run the agency&rsquo;s work.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-sm font-semibold text-ink">Google Drive</h2>
            <p>
              The system connects to the agency&rsquo;s own Google account to create project
              folders and to store files staff upload to them. It reads and writes only inside the
              agency&rsquo;s Drive and does not access anyone else&rsquo;s Google data. Synovative
              PMS&rsquo;s use of information received from Google APIs adheres to the{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                className="text-brand-ink underline underline-offset-2"
                target="_blank"
                rel="noreferrer"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-sm font-semibold text-ink">Sharing</h2>
            <p>
              Nothing is sold or shared with advertisers. Data is held with the services the system
              runs on (Supabase, Vercel and Google Drive) and is seen only by staff whose role
              allows it.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-sm font-semibold text-ink">Contact</h2>
            <p>
              Questions or requests to remove data:{" "}
              <a
                href="mailto:pms.synovative@gmail.com"
                className="text-brand-ink underline underline-offset-2"
              >
                pms.synovative@gmail.com
              </a>
            </p>
          </section>
        </div>
      </Card>
    </main>
  );
}
