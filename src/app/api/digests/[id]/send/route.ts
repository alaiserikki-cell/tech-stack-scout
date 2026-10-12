import { isAuthed, unauthorized } from "@/lib/auth";
import { sendDigest } from "@/lib/digest";
import { emailConfigured, isEmail } from "@/lib/email";
import { logActivity } from "@/lib/activity";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";

/** Email this digest (only the digest template can be sent). Recipient addresses are never stored or shown in clear. */
export async function POST(req: Request, ctx: RouteContext<"/api/digests/[id]/send">) {
  if (!(await isAuthed())) return unauthorized();
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Unknown digest." }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  const email = String(b.email ?? "").trim();
  if (!email) return Response.json({ error: "Enter an email address." }, { status: 400 });
  if (!isEmail(email)) return Response.json({ error: "That isn't a valid email address. Check it and try again, e.g. name@company.com." }, { status: 400 });
  const [d] = await getDb().select({ id: schema.digests.id }).from(schema.digests).where(eq(schema.digests.id, id));
  if (!d) return Response.json({ error: "Unknown digest." }, { status: 404 });
  if (!emailConfigured()) return Response.json({ error: "Email is not configured on this deployment yet." }, { status: 503 });
  const status = await sendDigest(id, email);
  await logActivity("digest_sent", status === "sent" ? "Emailed the digest (address hidden)" : `Digest email not delivered (${status === "restricted" ? "sender can only reach the owner's inbox" : status === "invalid" ? "address rejected" : "send failed"})`, { detail: { digestId: id, status } });
  if (status === "restricted")
    return Response.json(
      { error: "Not sent: this deployment's email account (Resend, free tier, no verified domain) can only deliver to the project owner's inbox. The preview above is exactly what the email contains." },
      { status: 422 },
    );
  if (status === "invalid") return Response.json({ error: "That address can't receive email. Check it and try again." }, { status: 400 });
  if (status !== "sent") return Response.json({ error: "Sending failed. Please try again later." }, { status: 502 });
  return Response.json({ ok: true });
}
