# Command Center

A personal dashboard built to host multiple AI-powered agents. The first
agent is the **Investment Agent**: a manual portfolio tracker with
Claude-generated diversification and concentration-risk insights.

Not financial advice — the Investment Agent is informational only.

## Stack

- [Next.js](https://nextjs.org) (App Router) + TypeScript + Tailwind CSS
- [Prisma](https://prisma.io) + PostgreSQL
- [NextAuth](https://next-auth.js.org) — single-user credentials login
- [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) — powers the Investment Agent's AI insights

## Architecture: the agent registry

Every agent is listed once, in [`lib/agents/registry.ts`](./lib/agents/registry.ts).
The home page and sidebar render their agent list only from that file — they
never hardcode an agent's name. To add a new agent later:

1. Create `app/(dashboard)/agents/<id>/page.tsx` for its UI.
2. Create `lib/agents/<id>/` for its logic (types, any AI-calling code).
3. Add one entry to `lib/agents/registry.ts`.

No existing agent's files need to change.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in the values (see comments in
   that file for where to get each one — a database URL, a NextAuth secret,
   an Anthropic API key, and the email/password for your one login).

   ```bash
   cp .env.example .env
   ```

3. Push the schema to your database and generate the Prisma client:

   ```bash
   npx prisma migrate dev --name init
   ```

4. Seed your single user account from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`:

   ```bash
   npm run db:seed
   ```

5. Start the dev server:

   ```bash
   npm run dev
   ```

   Visit [http://localhost:3000](http://localhost:3000) and log in with the
   credentials you seeded.

## Deploying to Vercel

1. Create a Postgres database — [Neon](https://neon.com) has a free tier
   that pairs well with Vercel. Copy its connection string.
2. Push this repo to GitHub and import it into Vercel.
3. In the Vercel project's Environment Variables, set everything from
   `.env.example`: `DATABASE_URL`, `NEXTAUTH_SECRET` (generate with
   `openssl rand -base64 32`), `NEXTAUTH_URL` (your production URL),
   `ANTHROPIC_API_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
4. Deploy. Then run the migration and seed once against the production
   database (e.g. `npx prisma migrate deploy` and `npm run db:seed` locally,
   pointed at the production `DATABASE_URL`, or via Vercel's CLI/shell).

## Notes

- Holdings are tracked at **cost basis** (what you paid), not live market
  value — there is no live price feed connected in v1.
- Route access is enforced in `proxy.ts` (Next.js 16 renamed the
  `middleware.ts` convention to `proxy.ts`); every route except `/login`
  requires a signed-in session.
