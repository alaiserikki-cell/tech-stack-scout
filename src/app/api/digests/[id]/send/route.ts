import { isAuthed, unauthorized } from "@/lib/auth";
import { hashRecipient, sendDigest } from "@/lib/digest";
import { emailConfigured, isEmail } from "@/lib/email";
import { LIMITS, dayMs, hit } from "@/lib/ratelimit";
import { logActivity } from "@/lib/activity";

/** Email this digest (only the digest template can be sent). Recipient addresses are never stored or shown in clear. */
export async function POST(req: Request, ctx: RouteContext<"/api/digests/[id]/send">) {
  if (!(await isAuthed())) return unauthorized();
  if (!emailConfigured()) return Response.json({ error: "Email is not configured on this deployment yet." }, { status: 503 });
  const id = Number((await ctx.params).id);
  const b = await req.json().catch(() => ({}));
  const email = String(b.email ?? "").trim();
  if (!isEmail(email)) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  if (!(await hit(`digest_to:${hashRecipient(email)}`, dayMs, LIMITS.digestPerRecipientPerDay)))
    return Response.json({ error: `That address already received ${LIMITS.digestPerRecipientPerDay} digests today.` }, { status: 429 });
  if (!(await hit("digest_total", dayMs, LIMITS.digestTotalPerDay))) return Response.json({ error: "Daily email limit for the demo reached. Try tomorrow." }, { status: 429 });
  const status = await sendDigest(id, email);
  await logActivity("digest_sent", status === "sent" ? "Emailed the digest (address hidden)" : `Digest email not delivered (${status === "restricted" ? "demo sender restriction" : "send failed"})`, { detail: { digestId: id, status } });
  if (status === "restricted")
    return Response.json(
      { error: "This demo sends through a Resend account without a verified domain, so it can only deliver to the project owner's inbox. The preview above shows exactly the email the Monday digest sends." },
      { status: 422 },
    );
  if (status !== "sent") return Response.json({ error: "Sending failed. Please try again later." }, { status: 502 });
  return Response.json({ ok: true });
}
