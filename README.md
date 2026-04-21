# PaceAI

AI running coach PWA for the Indian market. Coach Pace learns about you through conversation and builds a personalised weekly training plan.

## Stack

- **Frontend** — Vite + React (JSX), Tailwind CSS v4
- **Auth + Database** — Supabase (magic link auth, Postgres)
- **AI** — Claude claude-sonnet-4-6 via Anthropic API
- **Deployment** — Vercel (Edge Functions for API routes)

## Project structure

```
src/
  pages/
    Onboarding.jsx   # Conversational onboarding + profile extraction
    Home.jsx         # Daily session view + weekly plan strip
    Checkin.jsx      # Post-run check-in (scaffold)
  lib/
    supabase.js      # Supabase client (anon key, browser-safe)
    claude.js        # streamChat() + extractProfile() helpers
    generatePlan.js  # Calls /api/generate-plan, returns sessions
  components/        # (empty, ready for shared UI)
  hooks/             # (empty, ready for custom hooks)

api/
  chat.js            # Edge function — streams Coach Pace responses
  extract.js         # Edge function — extracts profile fields from chat
  generate-plan.js   # Edge function — generates 7-day plan, inserts to Supabase

public/
  manifest.json      # PWA manifest
  sw.js              # Service worker (network-first cache)
```

## Supabase schema

```sql
-- Users table (extends auth.users)
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  city text,
  fitness_level text check (fitness_level in ('beginner', 'mid', 'advanced')),
  goal text,
  health_notes text,
  sport_affinity text,
  days_per_week integer,
  updated_at timestamptz
);

alter table public.users enable row level security;
create policy "Users manage own row" on public.users
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- Sessions table
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  session_date date not null,
  session_type text,
  title text,
  description text,
  coach_message text,
  distance_km numeric,
  duration_min integer,
  status text default 'planned',
  created_at timestamptz default now()
);

alter table public.sessions enable row level security;
create policy "Users manage own sessions" on public.sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

## Environment variables

Create a `.env` file in the project root with:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_COACH_PACE_SYSTEM_PROMPT=
ANTHROPIC_API_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

`VITE_` prefixed vars are exposed to the browser. `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are server-only — never commit them.

## Local development

```bash
npm install
# create .env and fill in values
npm run dev            # starts Vite + API middleware on localhost:5173
```

The Vite dev plugin (`vite-api-plugin.js`) serves `/api/*` routes locally so you don't need `vercel dev`.

## Deploy

```bash
vercel deploy
```

Set all env vars in the Vercel project dashboard before deploying.
