# Tech Stack Scout

[![CI](https://github.com/alaiserikki-cell/tech-stack-scout/actions/workflows/ci.yml/badge.svg)](https://github.com/alaiserikki-cell/tech-stack-scout/actions/workflows/ci.yml)


A watchlist of target companies that stays current automatically. For each company it builds a call-prep brief for Nikhil, an enterprise AE selling **FlakeGuard** (a fictional flaky-test tool): how the company builds software, how actively, what changed recently, an outreach opener tied to a real signal, 3 discovery questions the evidence already answers and 2 it can't. Every Monday it emails a ranked "who to call this week" digest.

**Live:** https://tech-stack-scout-zeta.vercel.app

## For graders

- **URL:** https://tech-stack-scout-zeta.vercel.app
- **No passcode needed.** Every page and every action works straight from the URL. Rate limits protect the free tiers: one refresh per company per 10 minutes (else the cached run is shown), 10 new companies per day, 40 active companies max, digest email max 3 per address and 20 in total per day.
- **Three things to try**
  1. **Refresh a seeded company.** Open any company on the watchlist, press **Refresh now** and watch the live steps (Finding sources → Reading GitHub → Reading job posts → Reading blog → Writing brief). A company refreshed in the last 10 minutes returns the cached run.
  2. **Add a company by domain.** On the watchlist, type a domain (e.g. `posthog.com`) and press **Add company**. You land on its page while the brief builds (about a minute). Auto-discovered sources show as *Unverified* with Confirm / Edit.
  3. **Email yourself the digest.** Open **Digests**, pick the current week (or build it), enter your email under *Email me this digest*. Max 3 per address per day; the address is never stored or shown. Note: the demo sends through a Resend account without a verified domain, so delivery only succeeds to the project owner's inbox. The digest page shows the exact email, and other addresses get an explanation (see BLOCKED.md).

Other pages: **System** (cron schedule, run history, collector errors), **Costs** (Gemini tokens and an estimate at paid rates; actual spend is zero), **How it works** (components by actor), **Settings** (product profile, entries waiting for verification).

## How it works

**Signals in code, writing in Gemini.** Facts are collected deterministically from public sources and stored as signals with a source URL and timestamp. Gemini Flash only (a) extracts tech mentions with verbatim quotes from blog posts and (b) writes prose from the signals, citing signal ids. Code validates every Gemini output: schema, every cited id exists, every technology named is in the input signals, opener ≤ 30 words, exactly 3 + 2 questions. One retry with the errors appended; otherwise the page shows signals without a brief. A fact not in the signals never appears.

```
trigger → discover sources → collectors (GitHub · Greenhouse/Lever/Ashby · blog RSS · Hacker News · DNS/HEAD)
        → computed fields + hash → unchanged? reuse brief : Gemini brief → validate → snapshot → page + Monday digest
```

| Collector | What it reads |
|---|---|
| `github` | Org repos by push date (no forks/archived). Language bytes of the 10 most recent; file trees + manifests (`package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `pom.xml`, `build.gradle`, …) and workflows of the 5 most recent. Activity, `sdk_heavy`, competitor detection. ETags + rate-limit headers. |
| `jobs` | Greenhouse, Lever, Ashby public JSON. Engineering roles only; technologies tagged *requirement* / *nice to have* from section headings; initiative sentences (migrations, monolith breakup, platform team, CI reliability, build times, test infra, developer productivity). |
| `blog` | RSS/Atom feed (auto-discovered), posts from the last 90 days, max 5 new per run, Gemini extraction with verbatim-quote verification. |
| `hn` | Algolia HN stories from the last 12 months linking to the company or blog domain. |
| `talks` | Developer conference talks (YouTube, Vimeo, InfoQ, SpeakerDeck…) from the last 3 years, found key-free via Hacker News, kept only when the company owns the talk ("at Stripe", "Vercel's…") or it pairs the company with a technology and an engineering topic. |
| `hosting` | DNS-over-HTTPS (CNAME/A) + one HEAD request → *public-facing hosting* only. |

Computed in code (`src/lib/compute.ts`, weights and thresholds documented inline): language share, CI/infra/cloud/test lists, confidence (high: 2+ sources or 3+ recent job posts), adopted/dropped (`tech_state`), competitor presence, fit score 0–100 with reasons, activity label, contradictions (GitHub vs job-post language), change events, coverage, and a hash of the normalised signal set (unchanged ⇒ `skipped_unchanged`, no Gemini call).

## Stack

Next.js 16 App Router (TypeScript, Tailwind, Cache Components with Suspense skeletons) · Neon Postgres via `@neondatabase/serverless` + Drizzle ORM and migrations · Google Gen AI SDK (`@google/genai`) with `gemini-3.8-flash` · Resend (Nodemailer + Gmail SMTP fallback) · Vercel Hobby + Vercel Cron.

## Setup

```bash
npm install
cp .env.example .env        # then fill it in (see below)
npm run db:migrate          # apply Drizzle migrations to Neon
npm run seed                # product profile, tech dictionary, seed companies
npm run dev
```

### Environment variables

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string |
| `GITHUB_TOKEN` | GitHub token (`gh auth token`), read-only public access is enough |
| `GEMINI_API_KEY` | Google AI Studio key. **Do not enable billing** on its project; the free tier is used |
| `GEMINI_MODEL` | `gemini-3.8-flash` |
| `GEMINI_INPUT_COST_PER_1M`, `GEMINI_OUTPUT_COST_PER_1M` | Paid-tier rates, for the /costs estimate only |
| `RESEND_API_KEY`, `RESEND_FROM` | Resend email (used when set; `RESEND_FROM` defaults to `onboarding@resend.dev`) |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Gmail SMTP fallback (2-Step Verification on, then an app password) |
| `DIGEST_TO` | Where the Monday digest goes |
| `CRON_SECRET` | Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` |
| `REQUIRE_PASSCODE` | `true` to require `DEMO_PASSCODE` for write actions (off by default) |
| `DEMO_PASSCODE` | Passcode for write actions when `REQUIRE_PASSCODE=true` (stored as an httpOnly cookie) |
| `APP_URL` | Production URL, used for links in the email |

## Adding companies (for Nikhil)

- **Dashboard:** enter the domain on the watchlist and press Add company. The brief builds immediately.
- **Remove:** press **Remove** on the company's row in the watchlist (confirm), or at the bottom of its page. History is kept; adding the domain again reactivates it.
- **Neon console:** insert a row; the next daily cron picks it up because `last_refreshed_at` is null. (The problem statement mentions Supabase; this build uses Neon, which is also hosted Postgres; the same rows can be added or removed in Neon's table editor without touching code.)

```sql
insert into watchlist (company_name, domain) values ('Acme', 'acme.com');
-- optional, if you already know the sources:
--   github_org, ats_provider ('greenhouse'|'lever'|'ashby'|'none'), ats_slug, blog_feed_url ('none' to skip)
```

Remove a company with the link at the bottom of its page (or `update watchlist set active = false where domain = '…'`). History is kept.

## Scripts

| Command | What it does |
|---|---|
| `npm test` | Unit tests (Vitest): aggregation, detection, sdk_heavy, job matching, initiatives, confidence, adopted/dropped, competitors, fit, change events, hash skip, blog quotes, brief validator |
| `npm run replay` | Replays recorded fixtures through the real collectors and validators: rich company, sdk_heavy, no GitHub, no job board, invented blog mention, invalid Gemini JSON, GitHub 403, Gemini 429. Prints expected vs actual; exits 1 on any failure |
| `npm run smoke [url] [--writes]` | End-to-end smoke test of a deployed instance (pages, API, auth guards; `--writes` also logs in) |
| `npm run verify-seed` | Checks seed candidates against live GitHub / job boards / feeds and writes `data/seed-companies.json` |
| `npm run refresh-all [ids]` | Runs the full pipeline for all active companies (same code as the cron) |
| `npx tsx scripts/send-digest.ts` | Builds this week's digest and emails it to `DIGEST_TO` |
| `npm run dictionary` | Regenerates `data/tech-dictionary.json` with sanity checks |

## Free-tier notes

- **Gemini:** free tier only. Never link a billing account to the Gemini API project; /costs shows what the same usage *would* cost at paid rates. Calls are sequential with backoff on 429; when the daily quota runs out the page shows signals with "Summary pending, will retry on next refresh".
- **Vercel Hobby:** functions max 300 s; cron at most once a day with ±59 min precision. The daily job refreshes companies older than 7 days, oldest first, and stops starting work at 70% of 300 s. 40 active companies max.
- **Neon free plan:** pooled HTTP connection, one retry on cold start.
- **GitHub:** 5,000 requests/hour with a token; ETag revalidations (304) are free.

See `DECISIONS.md` for every judgement call and `REPORT.md` for the verification log.
