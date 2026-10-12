# FlakeGuard

[![CI](https://github.com/alaiserikki-cell/tech-stack-scout/actions/workflows/ci.yml/badge.svg)](https://github.com/alaiserikki-cell/tech-stack-scout/actions/workflows/ci.yml)


FlakeGuard is a tech-stack intelligence app for Nikhil, an enterprise account executive selling a developer productivity tool that finds and quarantines flaky tests. It keeps a watchlist of target companies current automatically and, for each one, builds a call-prep brief: how the company builds software, how actively, what changed recently, an outreach opener tied to a real signal, 3 discovery questions the evidence already answers and 2 it can't. Every Monday it emails a ranked "who to call this week" digest.

**Live:** https://tech-stack-scout-zeta.vercel.app

## For graders

- **URL:** https://tech-stack-scout-zeta.vercel.app
- **No passcode needed.** Every page and every action works straight from the URL. No daily quotas on adding companies or emailing digests. Two guards stay, for the free tiers: one refresh per company per 10 minutes (else the cached run is shown) and at most 40 active companies, so the daily refresh fits Vercel Hobby's 300 s limit.
- **Three things to try**
  1. **Refresh a seeded company.** Open any company on the watchlist, press **Refresh now** and watch the live steps (Finding sources → Reading GitHub → Reading job posts → Reading blog → Writing brief). A company refreshed in the last 10 minutes returns the cached run.
  2. **Add a company by domain.** On the watchlist, type a domain (e.g. `posthog.com`) and press **Add company**. You land on its page while the brief builds (about a minute). Auto-discovered sources show as *Unverified* with Confirm / Edit.
  3. **Email yourself the digest.** Open **Digests**, pick the current week (or build it), enter your email under *Email me this digest*. The address is validated first (a clear message for typos such as `a@b` or `name@@x.com`) and is never stored or shown. Note: the demo sends through a Resend account without a verified domain, so delivery only succeeds to the project owner's inbox. The digest page shows the exact email, and other addresses get an explanation (see BLOCKED.md).

Pages, in order of priority: **Landing** `/` (how it works, both scores, sources, and a live "Right now" strip with the top accounts) · **Watchlist** `/watchlist` · **This week** `/digests` (Monday ranking with a priority map) · **Targeting** `/settings` (what you sell, who you target, what matters most) · **Activity** `/activity` (every add, remove, refresh, review, digest and daily run). `npm run linkcheck <url>` crawls every page and checks every link.


## Two scores

| | Fit score | Evidence score |
|---|---|---|
| Question | Is this a good account for what I sell? | How sure are we about this company's stack? |
| Depends on | Your targeting (Targeting page): target languages, CI systems, clouds, hiring themes, and the importance of each factor | The data only: same for every user |
| Made of | languages 20 · CI in code 20 · test suites 15 · many services 10 · monorepo 10 · hiring themes 15 · momentum 10 · target clouds 10 (only if set). Importance off/normal/high = ×0/×1/×2, rescaled to 0-100 | verified sources 40 (GitHub 15, job board 15, blog 10) · corroboration 25 (techs seen in 2+ sources) · freshness 20 · breadth 15 |
| Updates | Instantly when you change your targeting (computed at read time, no AI) | On every refresh, and when you confirm a source |

**Verified sources only.** A source is verified automatically only with proof: the GitHub org's own website is the company's domain; the job board is linked from the company's careers page; the blog feed is hosted on the company's domain. Anything matched by name only stays *unverified*, earns no evidence points, and is **not sent to Gemini**, so it can never appear in an opener or summary until you confirm it. **Both scores follow the same rule**: Fit and the corroboration, recency and breadth parts of Evidence are computed only from verified sources; confirming a source re-includes it immediately.

**Input validation and one record per company.** Adding a company rejects empty input, email addresses, IPs, local names, malformed domains, shared services (gmail.com, vercel.app, …) and domains with no DNS records, each with a specific message. Subdomains and URLs are normalised (`https://engineering.stripe.com/blog` → `stripe.com`). If a domain's website redirects to another company domain, the company is stored once under the destination: `apple.in` → `apple.com`, `notion.so` → `notion.com`. GitHub org proof follows redirects the same way (Goldman Sachs' org lists `gs.com`, which redirects to `goldmansachs.com`). `npm run check-domains [-- --fix]` re-checks every tracked domain.

## Database cleanup (every 2 months)

A second Vercel cron (`30 3 1 */2 *`: 09:00 IST on the 1st of Jan, Mar, May, Jul, Sep, Nov) calls `/api/cron/cleanup` with `CRON_SECRET`. It deletes only what nothing uses any more, keeping 60 days of history:

| Data | Rule |
|---|---|
| Facts (signals) | from runs older than 60 days, **except** the run behind each company's current brief, so every brief keeps all its source links |
| Snapshots | older than 60 days, always keeping each company's latest 6 ("What changed") and any with opener feedback |
| Refresh runs | older than 60 days and no longer referenced |
| GitHub cache / Gemini usage log | older than 60 days |
| Rate-limit counters | older than 2 days |
| Activity log | older than 6 months |

Never deleted: companies, digests, opener feedback, tech history, dictionary, profile. Each run is logged on the Activity page. Run it by hand with `npm run cleanup` (or `npm run cleanup -- --dry` to see what would go).

## Free-of-cost features

Everything runs on free tiers. Built in: bulk add (up to 10 domains at once), search the watchlist by technology (e.g. "Kubernetes"), CSV export of the watchlist, print / save a brief as PDF, conference-talk discovery, Workday and SmartRecruiters job boards, Activity log, weekly digest with a priority map.

## How it works

**Signals in code, writing in Gemini.** Facts are collected deterministically from public sources and stored as signals with a source URL and timestamp. Gemini Flash only (a) extracts tech mentions with verbatim quotes from blog posts and (b) writes prose from the signals, citing signal ids. Code validates every Gemini output: schema, every cited id exists, every technology named is in the input signals, opener ≤ 30 words, exactly 3 + 2 questions. One retry with the errors appended; otherwise the page shows signals without a brief. A fact not in the signals never appears.

```
trigger → discover sources → collectors (GitHub · Greenhouse/Lever/Ashby · blog RSS · Hacker News · DNS/HEAD)
        → computed fields + hash → unchanged? reuse brief : Gemini brief → validate → snapshot → page + Monday digest
```

| Collector | What it reads |
|---|---|
| `github` | Org repos by push date (no forks/archived). Language bytes of the 10 most recent; file trees + manifests (`package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `pom.xml`, `build.gradle`, …) and workflows of the 5 most recent. Activity, `sdk_heavy`, competitor detection. ETags + rate-limit headers. |
| `jobs` | Greenhouse, Lever, Ashby, SmartRecruiters and Workday public JSON; the board is found by reading the company's careers page or probing slugs. Engineering roles only; technologies tagged *requirement* / *nice to have* from section headings; initiative sentences (migrations, monolith breakup, platform team, CI reliability, build times, test infra, developer productivity). |
| `blog` | RSS/Atom feed (auto-discovered), posts from the last 90 days, max 5 new per run, Gemini extraction with verbatim-quote verification. |
| `hn` | Algolia HN stories from the last 12 months linking to the company or blog domain. |
| `talks` | Developer conference talks (YouTube, Vimeo, InfoQ, SpeakerDeck…) from the last 3 years, found key-free via Hacker News, kept only when the company owns the talk ("at Stripe", "Vercel's…") or it pairs the company with a technology and an engineering topic. |
| `hosting` | DNS-over-HTTPS (CNAME/A) + one HEAD request → *public-facing hosting* only (CDNs, Vercel, Netlify, Heroku, Shopify, …). |

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
