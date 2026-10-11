import nodemailer from "nodemailer";

export function emailConfigured(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  if (!emailConfigured()) throw new Error("Gmail SMTP is not configured");
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  await transport.sendMail({ from: `Tech Stack Scout <${process.env.GMAIL_USER}>`, to, subject, html });
}

export function isEmail(s: string): boolean {
  return /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(s.trim()) && s.length < 200;
}
