# Deploying to Vercel (free domain)

## Executive Summary
The app deploys to a free `*.vercel.app` domain in ~10 minutes. SQLite does not persist on Vercel's serverless filesystem, so production requires the Supabase Postgres **Session Pooler** URL (the direct `db.*.supabase.co` host is IPv6-only and unreachable from Vercel). A custom company domain can be attached later in one click.

## One-Time Steps

1. **Get the pooled DB URL** — Supabase Dashboard → your project → **Connect** → **Session pooler**. It looks like
   `postgresql://postgres.ovdpfhexljhotzhrfhrg:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres`
   (Your original URL had a stray space after `postgres:` — the password is `bk6jQnaGbk6jQna` unless you rotated it. Rotate it anyway; it was pasted in plaintext.)

2. **Switch Prisma to Postgres** — in `prisma/schema.prisma` change `provider = "sqlite"` to `provider = "postgresql"`, then run locally:
   ```
   $env:DATABASE_URL='<pooler url>'; npx prisma db push
   ```

3. **Login + deploy** (run `! vercel login` in Claude Code to authenticate interactively):
   ```
   npm i -g vercel
   vercel login
   vercel --prod
   ```

4. **Set environment variables** (Vercel → Project → Settings → Environment Variables), copying values from `.env.local`:
   | Variable | Purpose |
   |---|---|
   | `DATABASE_URL` | Supabase **pooler** URL |
   | `ADMIN_PASSWORD` | Site-wide login gate |
   | `CRON_SECRET` | Protects `/api/cron` (Vercel injects the Bearer header automatically for cron invocations) |
   | `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_AUTH_TOKEN` | Workers AI |
   | `NOTIFY_EMAIL` | Fallback for budget-approval emails |

   Client Meta tokens live in the database, not env vars.

5. **Redeploy** after setting env vars: `vercel --prod`.

The daily cron (`vercel.json`, 09:00 UTC) works on the free Hobby tier (1 daily cron allowed). Custom domain later: Project → Settings → Domains → add and point DNS.

## Security Notes
- Every page/API is behind the `ADMIN_PASSWORD` cookie gate except `/login` and the Bearer-secured `/api/cron`.
- Client Meta tokens are stored plaintext in Postgres — enable Supabase RLS off-app access controls, and consider column encryption before scaling.
- Rotate any credential that has been shared in chat or email.
