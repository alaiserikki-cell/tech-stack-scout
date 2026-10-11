import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { Card, H2, Mint, PageTitle, SkeletonPage } from "@/components/ui";

export const metadata: Metadata = { title: "Costs" };

export default function CostsPage() {
  return (
    <>
      <PageTitle eyebrow="Costs" title={<>Gemini usage, <Mint>zero actual spend.</Mint></>} sub="Gemini usage by task and day, with an estimate at paid-tier rates. Actual spend is zero on the free tier." />
      <Suspense fallback={<SkeletonPage rows={6} />}>
        <CostData />
      </Suspense>
    </>
  );
}

async function CostData() {
  await connection();
  const db = getDb();
  const inRate = Number(process.env.GEMINI_INPUT_COST_PER_1M ?? 0);
  const outRate = Number(process.env.GEMINI_OUTPUT_COST_PER_1M ?? 0);
  const model = process.env.GEMINI_MODEL ?? "";
  const [byTask, byDay] = await Promise.all([
    db.execute(sql`select task,
        count(*) filter (where status <> 'skipped_unchanged') as calls,
        count(*) filter (where status = 'skipped_unchanged') as skipped,
        count(*) filter (where status = 'invalid') as invalid,
        count(*) filter (where status in ('quota','error')) as failed,
        coalesce(sum(input_tokens),0) as input_tokens, coalesce(sum(output_tokens),0) as output_tokens
      from llm_calls group by task order by task`),
    db.execute(sql`select to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day, task,
        count(*) filter (where status <> 'skipped_unchanged') as calls,
        count(*) filter (where status = 'skipped_unchanged') as skipped,
        coalesce(sum(input_tokens),0) as input_tokens, coalesce(sum(output_tokens),0) as output_tokens
      from llm_calls where created_at > now() - interval '30 days' group by 1,2 order by 1 desc, 2`),
  ]);
  type Row = Record<string, string>;
  const tasks = (byTask.rows ?? []) as Row[];
  const days = (byDay.rows ?? []) as Row[];
  const cost = (i: number, o: number) => (i / 1e6) * inRate + (o / 1e6) * outRate;
  const totIn = tasks.reduce((a, r) => a + Number(r.input_tokens), 0);
  const totOut = tasks.reduce((a, r) => a + Number(r.output_tokens), 0);
  const totCalls = tasks.reduce((a, r) => a + Number(r.calls), 0);
  const totSkipped = tasks.reduce((a, r) => a + Number(r.skipped), 0);
  const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
  const tile = (k: string, v: string) => (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-xs text-faint">{k}</p>
      <p className="font-mono text-xl tabular-nums">{v}</p>
    </div>
  );
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tile("Gemini calls", String(totCalls))}
        {tile("Skipped (unchanged)", String(totSkipped))}
        {tile("Input tokens", totIn.toLocaleString("en-US"))}
        {tile("Output tokens", totOut.toLocaleString("en-US"))}
        {tile("At paid rates", usd(cost(totIn, totOut)))}
      </div>
      <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
        <span className="font-medium">Actual spend is zero on the free tier.</span>{" "}
        <span className="text-muted">
          Estimate uses {model} paid rates of ${inRate} per 1M input and ${outRate} per 1M output tokens (output includes thinking tokens). Billing is never enabled on the Gemini project.
        </span>
      </p>
      <Card>
        <H2>By task</H2>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                {["Task", "Calls", "Skipped", "Invalid", "Failed", "Input", "Output", "Est. cost"].map((h) => (
                  <th key={h} scope="col" className="py-2 pr-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {tasks.map((r) => (
                <tr key={r.task} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3 font-sans">{r.task === "brief" ? "Brief writing" : "Blog extraction"}</td>
                  <td className="py-2 pr-3">{r.calls}</td>
                  <td className="py-2 pr-3">{r.skipped}</td>
                  <td className="py-2 pr-3">{r.invalid}</td>
                  <td className="py-2 pr-3">{r.failed}</td>
                  <td className="py-2 pr-3">{Number(r.input_tokens).toLocaleString("en-US")}</td>
                  <td className="py-2 pr-3">{Number(r.output_tokens).toLocaleString("en-US")}</td>
                  <td className="py-2">{usd(cost(Number(r.input_tokens), Number(r.output_tokens)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!tasks.length && <p className="py-2 text-sm text-muted">No Gemini calls yet.</p>}
        </div>
      </Card>
      <Card>
        <H2>By day (last 30 days, IST)</H2>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                {["Day", "Task", "Calls", "Skipped", "Input", "Output", "Est. cost"].map((h) => (
                  <th key={h} scope="col" className="py-2 pr-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {days.map((r) => (
                <tr key={r.day + r.task} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3">{r.day}</td>
                  <td className="py-2 pr-3 font-sans">{r.task === "brief" ? "Brief" : "Blog"}</td>
                  <td className="py-2 pr-3">{r.calls}</td>
                  <td className="py-2 pr-3">{r.skipped}</td>
                  <td className="py-2 pr-3">{Number(r.input_tokens).toLocaleString("en-US")}</td>
                  <td className="py-2 pr-3">{Number(r.output_tokens).toLocaleString("en-US")}</td>
                  <td className="py-2">{usd(cost(Number(r.input_tokens), Number(r.output_tokens)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
