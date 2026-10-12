import type { Metadata } from "next";
import { Card, Mint, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "How it works" };

const FLOW = [
  "Company domain",
  "validate (DNS, website, redirects)",
  "prove sources belong to the company",
  "collect signals (GitHub, job boards, blog RSS, Hacker News, DNS)",
  "compute fields and fit in code",
  "Gemini Flash writes the brief",
  "validator checks every citation",
  "snapshot in Neon",
  "dashboard, brief, outreach email draft, Monday call list",
];

type Row = { actor: string; trigger: string; input: string; context: string; processing: string; ai: string; output: string };

const ROWS: Row[] = [
  {
    actor: "Nikhil",
    trigger: "Opens the app, adds or removes a company, edits Targeting",
    input: "Company domain; what he sells and who he targets",
    context: "His product (FlakeGuard), target languages, CI systems, clouds, hiring themes",
    processing: "Domain and targeting validated before anything is saved",
    ai: "None",
    output: "Tracked company; every account re-ranked",
  },
  {
    actor: "Neon DB",
    trigger: "Every read and write",
    input: "Companies, signals, snapshots, targeting, activity",
    context: "Only verified sources are used; history kept 60 days",
    processing: "Stores everything; cleanup every 2 months never touches current briefs",
    ai: "None",
    output: "Data for every page and the Monday call list",
  },
  {
    actor: "Vercel Cron",
    trigger: "Daily 08:00 IST; cleanup on the 1st of every other month",
    input: "Companies older than 3 days, briefs still pending",
    context: "300-second function limit",
    processing: "Refreshes 3 companies at a time; builds the Monday call list (never sends email)",
    ai: "None",
    output: "Fresh snapshots and the weekly digest",
  },
  {
    actor: "Vercel app",
    trigger: "A page visit or a button press",
    input: "The request and the latest snapshots",
    context: "Current targeting profile",
    processing: "Renders pages, computes fit at read time, serves the APIs and downloads",
    ai: "None",
    output: "Dashboard, briefs, email drafts, health check",
  },
  {
    actor: "GitHub API",
    trigger: "Each refresh",
    input: "The company's GitHub org",
    context: "Org must be proven to belong to the company; example and vendored code ignored",
    processing: "Languages, CI and infrastructure files, manifests, push activity, sdk_heavy flag",
    ai: "None",
    output: "Signals with a link to each file",
  },
  {
    actor: "Job boards",
    trigger: "Each refresh",
    input: "Greenhouse, Lever, Ashby, SmartRecruiters or Workday board found from the careers pages",
    context: "Engineering roles only; analyst, intern, finance-type titles not counted for languages",
    processing: "Tools required vs nice to have; initiatives such as migrations or platform teams",
    ai: "None",
    output: "Signals with a link to each job post",
  },
  {
    actor: "Blog RSS",
    trigger: "Each refresh",
    input: "Engineering blog feed proven to belong to the company",
    context: "Newest 5 posts from the last 12 months",
    processing: "Fetches each post; keeps a mention only if its quote appears word for word",
    ai: "Gemini Flash names the technologies mentioned and says whether the post is about engineering",
    output: "Blog signals with links",
  },
  {
    actor: "Hacker News",
    trigger: "Each refresh",
    input: "Company and blog domains, company name",
    context: "Stories from 12 months; conference talks from 3 years",
    processing: "Stories linking to the company; talks the company gave",
    ai: "None",
    output: "Story and talk signals with links",
  },
  {
    actor: "DNS",
    trigger: "Adding a company and each refresh",
    input: "The domain",
    context: "DNS over HTTPS",
    processing: "Checks the domain exists; detects public-facing hosting and CDN",
    ai: "None",
    output: "Validation result; hosting signal",
  },
  {
    actor: "Gemini Flash",
    trigger: "A refresh whose verified facts changed",
    input: "Verified signals, computed fields, fit reasons",
    context: "What Nikhil sells and his buying signals",
    processing: "Structured JSON output",
    ai: "Writes the two-paragraph summary, the outreach first line and discovery questions, citing signal ids",
    output: "Draft brief",
  },
  {
    actor: "Validator",
    trigger: "Every Gemini response",
    input: "Draft brief and the signals it cites",
    context: "Every claim must cite a real signal",
    processing: "Checks citations, lengths and quotes; one retry, otherwise the previous brief stays",
    ai: "None",
    output: "Accepted brief",
  },
  {
    actor: "Dashboard",
    trigger: "Nikhil opens it",
    input: "Latest snapshots and the targeting profile",
    context: "Verified sources only",
    processing: "Ranks by fit; search, CSV export, bulk add",
    ai: "None",
    output: "Ranked accounts, briefs, outreach email drafts, Monday call list",
  },
];

const COLS: { key: keyof Row; label: string }[] = [
  { key: "trigger", label: "Trigger" },
  { key: "input", label: "Input" },
  { key: "context", label: "Context" },
  { key: "processing", label: "Processing" },
  { key: "ai", label: "AI" },
  { key: "output", label: "Output" },
];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageTitle eyebrow="How it works" title={<>Components <Mint>map.</Mint></>} sub="Who does what, with which input, and where AI is used." />

      <Card>
        <h2 className="mb-2 font-display text-[15px] font-semibold text-ink">The flow in one line</h2>
        <p className="text-sm leading-relaxed text-ink">{FLOW.join(" → ")}</p>
      </Card>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
        <table className="w-full min-w-[960px] text-left text-sm">
          <caption className="sr-only">Components map: actors by trigger, input, context, processing, AI and output</caption>
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th scope="col" className="px-3 py-2.5 font-semibold">
                Actor
              </th>
              {COLS.map((c) => (
                <th key={c.key} scope="col" className="px-3 py-2.5 font-semibold">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.actor} className="border-t border-line align-top">
                <th scope="row" className="px-3 py-3 font-semibold text-ink">
                  {r.actor}
                </th>
                {COLS.map((c) => (
                  <td key={c.key} className={"px-3 py-3 " + (c.key === "ai" && r.ai !== "None" ? "font-medium text-accent-ink" : "text-muted")}>
                    {r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
