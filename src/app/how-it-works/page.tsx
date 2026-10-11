import type { Metadata } from "next";
import { Card, H2, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "How it works" };

const ROWS: { part: string; nikhil: string; system: string; ai: string }[] = [
  {
    part: "Trigger",
    nikhil: "Adds a company on the dashboard or as a row in the Neon console; presses Refresh now.",
    system: "Add and Refresh start a run immediately (post-response with after()). A daily Vercel Cron refreshes anything older than 7 days and, on Mondays (IST), builds and emails the digest.",
    ai: "None.",
  },
  {
    part: "Input",
    nikhil: "A company domain and optional name.",
    system: "Discovers the GitHub org, job board (Greenhouse, Lever, Ashby) and blog feed, saving each as unverified until confirmed.",
    ai: "None.",
  },
  {
    part: "Context",
    nikhil: "Edits the FlakeGuard product profile and verifies dictionary or competitor entries in Settings.",
    system: "Product profile, a 241-entry technology dictionary, previous snapshot, technology state (first/last seen) and the last input hash.",
    ai: "Receives the product profile, numbered signals, computed fields, contradictions and change events.",
  },
  {
    part: "Processing",
    nikhil: "None.",
    system:
      "Collectors gather signals with source URL and timestamp. Code computes language share, CI/infra/cloud/test lists, confidence, adopted/dropped, competitor matches, fit score, activity, contradictions, change events, coverage and a hash. Unchanged hash = no Gemini call.",
    ai: "None.",
  },
  {
    part: "AI",
    nikhil: "None.",
    system: "Validates every response: schema, cited ids exist, every technology named is in the signals, opener ≤ 30 words, exactly 3 + 2 questions. One retry with the errors; otherwise signals are shown without a brief.",
    ai: "Gemini Flash (a) extracts tech mentions with verbatim quotes from blog posts and (b) writes the brief prose from signals, citing signal ids.",
  },
  {
    part: "Output",
    nikhil: "Reads the brief on his phone before a call; marks the opener Used, Edited or Rejected; gets the Monday email.",
    system: "Company brief page, watchlist, digest archive, system and cost pages, Monday email via Gmail SMTP.",
    ai: "Opener, two paragraphs, 3 already-answered and 2 still-unknown questions, caveats.",
  },
];

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageTitle title="How it works" sub="Signals in code, writing in Gemini. A fact that is not in the signals never appears in a brief." />
      <Card className="bg-accent-soft">
        <H2>The flow in one line</H2>
        <p className="font-mono text-sm leading-relaxed">
          trigger → discover sources → collect signals (GitHub · jobs · blog · HN · DNS) → compute fields + hash → unchanged? reuse brief : Gemini writes brief → validate → snapshot → page + Monday digest
        </p>
      </Card>

      <Card>
        <H2>Components by actor</H2>
        <div className="hidden md:block">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th scope="col" className="w-28 py-2 pr-3 font-medium">Component</th>
                <th scope="col" className="py-2 pr-3 font-medium">Nikhil</th>
                <th scope="col" className="py-2 pr-3 font-medium">System (code)</th>
                <th scope="col" className="py-2 font-medium">AI (Gemini Flash)</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.part} className="border-b border-line align-top last:border-0">
                  <th scope="row" className="py-3 pr-3 font-medium">{r.part}</th>
                  <td className="py-3 pr-3 text-muted">{r.nikhil}</td>
                  <td className="py-3 pr-3 text-muted">{r.system}</td>
                  <td className="py-3 text-muted">{r.ai}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="space-y-4 md:hidden">
          {ROWS.map((r) => (
            <div key={r.part}>
              <dt className="font-medium">{r.part}</dt>
              <dd className="mt-1 space-y-1 text-sm text-muted">
                <p>
                  <span className="text-ink">Nikhil:</span> {r.nikhil}
                </p>
                <p>
                  <span className="text-ink">System:</span> {r.system}
                </p>
                <p>
                  <span className="text-ink">AI:</span> {r.ai}
                </p>
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <H2>Sources</H2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>GitHub REST API: languages of the 10 most recently pushed repos, file trees and manifests of the top 5, repo activity. ETags keep repeat calls free.</li>
            <li>Greenhouse, Lever and Ashby public job-board JSON: engineering roles, technologies tagged requirement or nice to have, initiative sentences.</li>
            <li>Company blog RSS/Atom: posts from the last 90 days, at most 5 new per run.</li>
            <li>Hacker News (Algolia): stories linking to the company in the last 12 months.</li>
            <li>DNS-over-HTTPS and one HEAD request: public-facing hosting only.</li>
          </ul>
        </Card>
        <Card>
          <H2>Why job posts outrank GitHub</H2>
          <p className="text-sm text-muted">
            Public repositories are often SDKs, client libraries and open-source tools written for customers. Job posts describe the systems engineers will work on. When the dominant languages disagree, the brief says so and
            treats job posts as the stronger evidence of the internal stack.
          </p>
        </Card>
      </div>
    </div>
  );
}
