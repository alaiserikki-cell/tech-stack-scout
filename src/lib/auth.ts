import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const AUTH_COOKIE = "tss_pass";

function token(): string {
  const key = process.env.CRON_SECRET || "dev";
  return createHmac("sha256", key).update(`demo:${process.env.DEMO_PASSCODE ?? ""}`).digest("hex");
}

export function passcodeMatches(input: string): boolean {
  const expected = process.env.DEMO_PASSCODE ?? "";
  if (!expected) return false;
  const a = Buffer.from(input.trim().toLowerCase());
  const b = Buffer.from(expected.toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

export function authCookieValue(): string {
  return token();
}

export async function isAuthed(): Promise<boolean> {
  const v = (await cookies()).get(AUTH_COOKIE)?.value;
  if (!v) return false;
  const t = token();
  return v.length === t.length && timingSafeEqual(Buffer.from(v), Buffer.from(t));
}

export function unauthorized() {
  return Response.json({ error: "Enter the demo passcode to make changes." }, { status: 401 });
}
