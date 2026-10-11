import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { isAuthed, unauthorized } from "@/lib/auth";
import { loadProfile } from "@/lib/repo";

/** Mark a verify:true dictionary or competitor entry as verified so it is used in matching. */
export async function POST(req: Request) {
  if (!(await isAuthed())) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "");
  const db = getDb();
  if (b.type === "dictionary") {
    await db.update(schema.techDictionary).set({ verify: false }).where(eq(schema.techDictionary.canonicalName, name));
  } else if (b.type === "competitor") {
    const p = await loadProfile();
    const c = p.competitors_and_adjacent.find((x) => x.name === name);
    if (!c) return Response.json({ error: "Not found" }, { status: 404 });
    c.verify = false;
    await db.insert(schema.productProfile).values({ data: p });
  } else return Response.json({ error: "Unknown type" }, { status: 400 });
  return Response.json({ ok: true });
}
