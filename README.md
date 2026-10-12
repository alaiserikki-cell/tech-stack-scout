# FlakeGuard

[![CI](https://github.com/alaiserikki-cell/tech-stack-scout/actions/workflows/ci.yml/badge.svg)](https://github.com/alaiserikki-cell/tech-stack-scout/actions/workflows/ci.yml)


FlakeGuard is a tech-stack intelligence app for Nikhil, an enterprise account executive selling a developer productivity tool that finds and quarantines flaky tests. It keeps a dashboard of target companies current automatically and, for each one, builds a call-prep brief: how the company builds software, how actively, what changed recently, an outreach opener tied to a real signal, 3 discovery questions the evidence already answers and 2 it can't. Every Monday it ranks a "who to call this week" digest, downloadable as a ready-to-send email draft.

**Live:** https://tech-stack-scout-zeta.vercel.app

## For graders

- **URL:** https://tech-stack-scout-zeta.vercel.app
- **No passcode needed.** Every page and every action works straight from the URL. No daily quotas. Two guards stay: one refresh per company per 10 minutes (else the cached run is shown) and at most 40 active companies, so the daily refresh fits Vercel's 300 s function limit.
- **Three things to try**
  1. **Refresh a seeded company.** Open any company on the dashboard, press **Refresh now** and watch the live steps (Finding sources → Reading GitHub → Reading job posts → Reading blog → Writing brief). A company refreshed in the last 10 minutes returns the cached run.
  2. **Add a company by domain.** On the dashboard, type a domain (e.g. `razorpay.com`) and press **Build brief**. You land on its page while the brief builds (about a minute). Try a typo such as `ritzy.com.com` to see validation. Sources matched by name only appear under *Found, but not proven* with Confirm / Edit; nothing from them is shown or scored.
  3. **Download the digest.** Open **This week**, pick a week (or build it), open *Email draft* and press **Download email draft (.eml)**: it opens ready to send in Outlook, Apple Mail or Thunderbird. The .html download is the same email as a page (copy-paste into Gmail). Every link opens the brief or the source in a new tab.

Pages, in order of priority: **Landing** `/` (how it works, both scores, sources, and a live "Right now" strip with the top accounts) · **Dashboard** `/dashboard` (`/watchlist` redirects) · **This week** `/digests` (Monday ranking with a priority map) · **Targeting** `/settings` (what you sell, who you target, what matters most) · **Activity** `/activity` (every add, remove, refresh, review, digest and daily run). `npm run linkcheck <url>` crawls every page and checks every link.


## Two scores

| | Fit score | Info score |
|---|---|---|
| Question | Is this a good account for what I sell (FlakeGuard)? | How much verified information do we have on this company? |
| Depends on | Your targeting (Targeting page): target languages, CI systems, clouds, hiring themes, and the importance of each factor | The data only: same for every user |
| Made of | languages 20 · CI in code 20 · test suites 15 · many services 10 · monorepo 10 · hiring themes 15 · momentum 10 · target clouds 10 (only if set). Importance off/normal/high = ×0/×1/×2, rescaled to 0-100 | stack detail 30 (3 per technology/language) · source coverage 25 (5 per source type with data) · cross-checks 20 (techs seen in 2+ sources) · depth 10 (roles, hiring themes, posts and talks) · freshness 15. 70+ rich, 40-69 partial, below 40 sparse |
| Updates | Instantly when you change your targeting (computed at read time, no AI) | On every refresh, and when you confirm a source |

"FlakeGuard plugs in here" on a brief's stack map marks the layer the product works on (CI and tests).

**Verified sources only, everywhere.** One ownership rule (`src/lib/ownership.ts`) decides whether a GitHub org, blog feed or careers site belongs to the company. It must be (1) on the company's domain, (2) reached by a redirect from it (`tech.flipkart.com` → `blog.flipkart.tech`), (3) linked from the company's own pages (`flipkart.com` → `flipkartcareers.com`), or (4) on a domain carrying the brand that links back (`zerodha.tech` → `zerodha.com`). A source matched by name only is stored for audit but **nothing from it is shown, scored or sent to Gemini**. Confirm it on the company page and the brief is rebuilt with it immediately.

**Input validation (`src/lib/domain.ts`), two layers, each rejection with a code and a plain message.**
1. *Syntax*, using the Public Suffix List (`tldts`): empty, email address, spaces, IP, local/reserved names, malformed labels, unknown endings (`.something`), doubled endings (`ritzy.com.com` → "did you mean ritzy.com?"), shared hosting (`*.vercel.app`, `*.github.io`), email and link services (gmail.com, bit.ly). URLs and subdomains are normalised (`https://engineering.stripe.com/blog` → `stripe.com`, `shop.tata.co.in` → `tata.co.in`, international names → punycode).
2. *Network*: DNS must exist; the homepage must answer (2xx/3xx, or 401/403/429/503 from bot protection; a 404 homepage does not count); parked and for-sale pages and registrar redirects are rejected (`com.com` → `gen.xyz`); a redirect to the same brand elsewhere becomes the canonical domain (`apple.in` → `apple.com`, `notion.so` → `notion.com`); a redirect to an unrelated brand is rejected with a suggestion to add the destination instead.
Adding the same company twice (or at the same moment) returns the existing record. `npm run check-domains [-- --fix]` re-checks every tracked domain with the same rules.

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

Built in: bulk add (up to 10 domains at once), search the dashboard by technology (e.g. "Kubernetes"), CSV export of the dashboard, print / save a brief as PDF, conference-talk discovery, Workday and SmartRecruiters job boards, Activity log, weekly digest with a priority map.

## How it works

**Signals in code, writing in Gemini.** Facts are collected deterministically from public sources and stored as signals with a source URL and timestamp. Gemini Flash only (a) extracts tech mentions with verbatim quotes from blog posts and (b) writes prose from the signals, citing signal ids. Code validates every Gemini output: schema, every cited id exists, every technology named is in the input signals, opener ≤ 30 words, exactly 3 + 2 questions. One retry with the errors appended; otherwise the page shows signals without a brief. A fact not in the signals never appears.

```
trigger → discover sources → collectors (GitHub · Greenhouse/Lever/Ashby · blog RSS · Hacker News · DNS/HEAD)
        → computed fields + hash → unchanged? reuse brief : Gemini brief → validate → snapshot → page + Monday digest
```

| Collector | What it reads |
|---|---|
| `github` | Org repos by push date (no forks/archived). Language bytes of the 10 most recent; file trees (example apps, fixtures, vendored and docs folders ignored) + manifests (`package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `pom.xml`, `build.gradle`, …) and workflows of the 5 most recent. Activity, `sdk_heavy`, competitor detection. ETags + rate-limit headers. |
| `jobs` | Greenhouse, Lever, Ashby, SmartRecruiters and Workday public JSON; the board is found on the company's careers pages, following careers links one level deep (including careers sites on another domain the company links to), or by probing slugs (then unverified). Engineering roles only; technologies tagged *requirement* / *nice to have* from section headings; initiative sentences (migrations, monolith breakup, platform team, CI reliability, build times, test infra, developer productivity). |
| `blog` | RSS/Atom feed discovered on engineering/tech/blog subdomains and paths, blog links on the homepage (Medium included), and the GitHub org's website; falls back to common feed paths when a page hides its feed tag. The 5 newest posts from the last 12 months, Gemini extraction with verbatim-quote verification. |
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

- **+ Add company** (top of every page): *One company*, or *Several at once*: one website per line (commas or spaces also work), up to 10 per batch, each validated on its own. The dashboard holds up to 40 companies.
- **Remove:** press **Remove** on the company's row on the dashboard (confirm), or at the bottom of its page. History is kept; adding the domain again reactivates it.
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
| `npm run check-domains [-- --fix]` | Re-validates every tracked domain with the same rules as Add company |
| `npx tsx scripts/probe.ts acme.com Acme` | Dry-runs every collector for a domain (no database writes, no Gemini) and prints what each source found and how it was proven |
| `npm run refresh-all [ids]` | Runs the full pipeline for all active companies (same code as the cron) |
| `npx tsx scripts/send-digest.ts` | Builds this week's digest and emails it to `DIGEST_TO` |
| `npm run dictionary` | Regenerates `data/tech-dictionary.json` with sanity checks |

## Operations: what keeps it running, and its limits

Built to work whenever it is opened, without anyone looking after it.

| Risk | What happens |
|---|---|
| A source is down or rate-limited (GitHub, a job board, a blog) | Each collector fails on its own; that source keeps its facts from the last good refresh, so nothing disappears from a brief. |
| Gemini quota used up, model retired, or brief rejected by the validator | Falls back to a second model (`gemini-flash-latest`, separate quota). If no brief can be written, the **previous brief stays** and the daily job retries the next day. New companies show their facts with "summary pending" until then. |
| A refresh is cut off (300 s limit, a deploy) | Runs stuck for 15 minutes are marked timed out at the next run or daily job; the previous brief stays. |
| Database waking from sleep (Neon scales to zero after 5 idle minutes) | First request takes 1-2 s; queries retry 3 times over ~4 s. If a page still fails, a friendly "Try again" page shows instead of a crash. |
| Briefs going stale | The daily job (08:00 IST) refreshes every company older than 3 days, 3 at a time, pending briefs first, and stops starting work at 70% of the 300 s limit. With 19 companies everything stays under 3-4 days old. |
| Job posts closing | A closed posting's link can 404 until the next refresh (at most ~3 days); the board link stays valid. |
| Monitoring | `GET /api/health` checks the database, configuration (never values), the daily job, stuck refreshes and brief integrity (200 or 503). A GitHub Actions workflow runs it and the read-only smoke test every day. |

**Limits a tester may notice:** up to 40 companies on the dashboard; up to 10 per bulk add; one refresh per company per 10 minutes (a second press shows the running or cached run); briefs take about a minute; the Monday email goes to the team inbox (anyone can download the draft). The cleanup on the 1st of every other month only removes history older than 60 days and never touches current briefs.

**Neon free plan** (checked 2026-10-12): 1 GB storage per project (we use ~20 MB; the cleanup keeps it small), 100 CU-hours of compute per month (the database sleeps when idle; the daily job keeps it awake roughly 10 minutes a day, so normal testing uses a small fraction), 5 GB data transfer per month, 6 hours of restore history. If compute hours were ever used up, Neon pauses the database until the next month: pages would show the "Try again" page and `/api/health` would report it. HTTP connections mean there is no connection pool to exhaust. The data can always be rebuilt with `npm run seed` + `npm run refresh-all`.

**Other services:** Gemini free tier (no billing); GitHub token without expiry (5,000 requests/hour); Vercel Hobby (300 s functions, one cron run per day); Resend free (the Monday email to the team inbox).

See `DECISIONS.md` for every judgement call and `REPORT.md` for the verification log.
