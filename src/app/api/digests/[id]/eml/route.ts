import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { TOP_N, digestSubject, digestText, type RankedAccount } from "@/lib/digest";

const CRLF = "\r\n";

/** The digest as an unsent email draft (.eml): opens ready to send in Outlook, Apple Mail or Thunderbird. */
export async function GET(_req: Request, ctx: RouteContext<"/api/digests/[id]/eml">) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Unknown digest." }, { status: 404 });
  const [d] = await getDb().select().from(schema.digests).where(eq(schema.digests.id, id));
  if (!d) return Response.json({ error: "Unknown digest." }, { status: 404 });
  const ranked = d.rankedAccounts as RankedAccount[];
  const subject = digestSubject(Math.min(TOP_N, ranked.length), d.weekOf);
  const b64 = (t: string) => Buffer.from(t, "utf-8").toString("base64");
  const wrap = (t: string) => (b64(t).match(/.{1,76}/g) ?? []).join(CRLF);
  const boundary = `tss-${id}-${Date.now()}`;
  const eml = [
    "X-Unsent: 1",
    "To: ",
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap(digestText(ranked, d.weekOf)),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap(d.html),
    `--${boundary}--`,
    "",
  ].join(CRLF);
  return new Response(eml, {
    headers: { "content-type": "message/rfc822", "content-disposition": `attachment; filename="digest-${d.weekOf}.eml"`, "cache-control": "no-store" },
  });
}
