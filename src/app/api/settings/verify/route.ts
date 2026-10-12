import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { logActivity } from "@/lib/activity";
import { isAuthed, unauthorized } from "@/lib/auth";

/** Mark a verify:true dictionary entry as verified so it is used in matching. */
export async function POST(req: Request) {
  if (!(await isAuthed())) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "");
  const db = getDb();
  if (b.type === "dictionary") {
    await db.update(schema.techDictionary).set({ verify: false }).where(eq(schema.techDictionary.canonicalName, name));
  } else return Response.json({ error: "Unknown type" }, { status: 400 });
  await logActivity("entry_verified", `Marked ${name} (${b.type}) as verified`);
  return Response.json({ ok: true });
}
