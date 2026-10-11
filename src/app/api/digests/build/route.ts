import { isAuthed, unauthorized } from "@/lib/auth";
import { buildDigest } from "@/lib/digest";
import { hit } from "@/lib/ratelimit";

/** Rebuild this week's digest from current snapshots (does not send email). */
export async function POST() {
  if (!(await isAuthed())) return unauthorized();
  if (!(await hit("digest_build", 60_000, 3))) return Response.json({ error: "Please wait a minute before rebuilding." }, { status: 429 });
  const d = await buildDigest();
  return Response.json({ id: d.id });
}
