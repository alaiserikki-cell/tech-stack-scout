import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { TOP_N, digestSubject, emlDraft, type RankedAccount } from "@/lib/digest";

/**
 * Download the digest email as a file: `?format=eml` is a ready-to-send draft that opens in Outlook, Apple Mail or
 * Thunderbird (add recipients and press Send); `?format=html` is the same email as a web page.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/digests/[id]/download">) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Unknown digest." }, { status: 404 });
  const [d] = await getDb().select().from(schema.digests).where(eq(schema.digests.id, id));
  if (!d) return Response.json({ error: "Unknown digest." }, { status: 404 });
  const format = new URL(req.url).searchParams.get("format") === "eml" ? "eml" : "html";
  const subject = digestSubject(Math.min(TOP_N, (d.rankedAccounts as RankedAccount[]).length), d.weekOf);
  const name = `flakeguard-digest-${d.weekOf}.${format}`;
  const body = format === "eml" ? emlDraft(subject, d.html) : d.html;
  return new Response(body, {
    headers: {
      "content-type": format === "eml" ? "message/rfc822" : "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
