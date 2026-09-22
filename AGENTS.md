<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Synovative PMS

An in-house project management system for a digital marketing agency serving
real-estate developers in Mumbai. Next.js 16 + Supabase; every read and write
from the browser runs as the signed-in user and is bounded by Row Level
Security.

**Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing anything.** It covers
the domain model, the three-layer permission system, the optimistic store, the
migration rules and the traps that are easy to fall into. The short version:

- Permissions live in **both** `lib/permissions.ts` (what the UI shows) and
  `supabase/migrations/*.sql` (what is actually allowed). Changing one without
  the other is the most common mistake here.
- Migrations are append-only. Add the next number; never edit a shipped file.
- All browser writes go through `commit()` in `lib/store.tsx`, which is
  optimistic, ordered and self-healing on failure.
- Dates that a person delivers on use working-day maths from `lib/calendar.ts`,
  not raw date arithmetic.
- Colours are Tailwind v4 tokens from `app/globals.css`. Never hard-code one.
- `Doc.md` is the PRD; comments cite it as `§7`, `§12.2`, and so on.

Run `npm run build` and `npm run lint` before calling work done — the
`react-hooks` rules are enforced as errors.

