import nodemailer from "nodemailer";

/** Thrown when the provider only allows the account owner as recipient (Resend without a verified domain). */
export class RecipientRestrictedError extends Error {}

/**
 * Email transport. Resend (HTTP API) is used when RESEND_API_KEY is set; Gmail SMTP via Nodemailer
 * is the fallback when GMAIL_USER / GMAIL_APP_PASSWORD are set.
 */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY || (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD));
}

export function emailProvider(): "resend" | "gmail" | null {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) return "gmail";
  return null;
}

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const provider = emailProvider();
  if (provider === "resend") {
    const from = process.env.RESEND_FROM || "FlakeGuard <onboarding@resend.dev>";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (res.status === 403) throw new RecipientRestrictedError("Resend: recipient not allowed without a verified domain");
    if (!res.ok) throw new Error(`Resend returned HTTP ${res.status}`);
    return;
  }
  if (provider === "gmail") {
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
    await transport.sendMail({ from: `FlakeGuard <${process.env.GMAIL_USER}>`, to, subject, html });
    return;
  }
  throw new Error("Email is not configured");
}

export function isEmail(s: string): boolean {
  const t = s.trim();
  if (t.length > 254) return false;
  const m = /^([A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64})@([A-Za-z0-9.-]+)$/.exec(t);
  if (!m) return false;
  const [, local, domain] = m;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  const labels = domain.split(".");
  if (labels.length < 2 || !/^[A-Za-z]{2,}$/.test(labels[labels.length - 1])) return false;
  return labels.every((l) => l.length > 0 && l.length <= 63 && !l.startsWith("-") && !l.endsWith("-"));
}
