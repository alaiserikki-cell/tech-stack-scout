import type { Computed } from "./compute";
import type { ProductProfile } from "./types";

export interface EmailDraft {
  subject: string;
  body: string;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * First-touch email Nikhil sends to the company. The first line is the Gemini opener (validated against cited
 * signals); every other fact comes from verified, computed fields in code, so nothing in the email is invented.
 */
export function outreachEmail(args: { company: string; opener: string; computed: Computed; profile: ProductProfile; sender?: string }): EmailDraft {
  const { company, opener, computed: c, profile } = args;
  const sender = args.sender ?? "Nikhil";
  const ci = c.techs.filter((t) => t.category === "ci").map((t) => t.name).slice(0, 2);
  const tests = c.techs.filter((t) => t.category === "test_framework").map((t) => t.name).slice(0, 2);
  const langs = [...c.languages].sort((a, b) => b.pct - a.pct).map((l) => l.name).slice(0, 2);

  const facts: string[] = [];
  if (langs.length) facts.push(`builds mostly in ${list(langs)}`);
  if (ci.length) facts.push(`runs ${list(ci)}`);
  if (tests.length) facts.push(`tests with ${list(tests)}`);
  const factLine = facts.length ? `From what your team shares publicly, ${company} ${list(facts)}, which is exactly where ${profile.product_name} works.` : "";

  // "GitLab's GitLab CI pipeline" reads badly: drop the tool name when it repeats the company's
  const ciName = ci[0] && !ci[0].toLowerCase().includes(company.toLowerCase()) ? `${ci[0]} ` : "CI ";
  const topic = ci.length ? `${ciName}pipeline` : tests.length ? "test suite" : "engineering team";
  const subject = `${company}'s ${topic} and ${profile.product_name}`;
  const pitch = `${profile.product_name} ${lowerFirst(profile.one_line_pitch.trim())}`;
  const body = [
    "Hi there,",
    opener.trim(),
    pitch,
    factLine,
    `Would a 20-minute call next week be useful? I can show what ${profile.product_name} would flag in a pipeline like yours.`,
    `Best,\n${sender}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { subject, body };
}

export function gmailComposeUrl(d: EmailDraft): string {
  return `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;
}

export function mailtoUrl(d: EmailDraft): string {
  return `mailto:?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;
}
