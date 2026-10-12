import type { Computed } from "./compute";
import type { ProductProfile } from "./types";

export interface EmailDraft {
  subject: string;
  body: string;
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A hedged sentence says where its claim comes from (job posts, public repos, a talk or post). */
const HEDGE = /\b(job (posts?|listings?|openings?|descriptions?)|openings?|hiring|public (github|repos?|repositories|code|codebase)|open[- ]source|github (shows?|reflects?|repositories)|according to|appears?|suggests?|indicates?|visible|talk|blog|post)\b/i;
const PUBLIC_REPOS = /\bpublic (github|repos?|repositories|code|codebase)\b|\bopen[- ]source\b/i;

/** Brief prose is about the company in the third person; the email speaks to them. */
function toSecondPerson(s: string, company: string): string {
  return s
    .replace(new RegExp(`\\b${esc(company)}'s\\b`, "g"), "your")
    .replace(/\bTheir\b/g, "Your")
    .replace(/\btheir\b/g, "your")
    .replace(/\bThey\b/g, "You")
    .replace(/\bthey\b/g, "you")
    .replace(/\bthem\b/g, "you");
}

export function splitSentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
}

/**
 * First-touch email Nikhil sends to the company, built only from the brief's hedged sentences:
 * - the first line is the Gemini opener (validated against cited signals)
 * - a sentence is used only if it names its source, and a tool is never stated as how the company builds
 *   internally unless a job post mentions it (GitHub alone shows what is public, not what runs inside)
 * - when the public GitHub is mostly SDKs (sdk_heavy), GitHub-only tools are phrased "your public repos use X"
 */
export function outreachEmail(args: {
  company: string;
  brief: { opener: string; paragraph_1: string; paragraph_2: string };
  computed: Pick<Computed, "techs" | "languages" | "jobLanguages" | "sdkHeavy">;
  profile: ProductProfile;
  sender?: string;
}): EmailDraft {
  const { company, brief, computed: c, profile } = args;
  const sender = args.sender ?? "Nikhil";
  const jobBacked = new Set([...c.techs.filter((t) => t.sources.includes("jobs")).map((t) => t.name), ...c.jobLanguages.map((l) => l.name)]);
  const tools = [...new Set([...c.techs.filter((t) => t.category !== "pattern").map((t) => t.name), ...c.languages.map((l) => l.name)])];
  const githubOnly = tools.filter((t) => !jobBacked.has(t));
  const mentions = (s: string, names: string[]) => names.filter((n) => new RegExp(`(^|[^\\w])${esc(n)}([^\\w]|$)`, "i").test(s));

  const productRe = new RegExp(`\\b${esc(profile.product_name)}\\b`, "i");
  const picked: string[] = [];
  for (const s of [...splitSentences(brief.paragraph_1), ...splitSentences(brief.paragraph_2)]) {
    if (picked.length >= 2) break;
    if (!HEDGE.test(s) || productRe.test(s)) continue;
    const unbacked = mentions(s, githubOnly);
    // a GitHub-only tool may appear only in a sentence that says it is from public repos, and never for SDK-heavy orgs
    if (unbacked.length && (c.sdkHeavy || !PUBLIC_REPOS.test(s))) continue;
    picked.push(toSecondPerson(s, company));
  }

  let publicLine = "";
  if (c.sdkHeavy) {
    const pub = c.techs.filter((t) => ["ci", "test_framework"].includes(t.category) && !jobBacked.has(t.name)).map((t) => t.name).slice(0, 3);
    if (pub.length) publicLine = `Your public repos use ${list(pub)}.`;
  }

  const ciBacked = c.techs.find((t) => t.category === "ci" && jobBacked.has(t.name));
  const topic = ciBacked ? `${ciBacked.name} pipeline` : c.techs.some((t) => t.category === "ci") ? "CI pipeline" : c.techs.some((t) => t.category === "test_framework") ? "test suite" : "engineering team";
  const subject = `${company}'s ${topic.replace(new RegExp(`^${esc(company)}\\s+`, "i"), "")} and ${profile.product_name}`;

  const body = [
    "Hi there,",
    brief.opener.trim(),
    picked.join(" "),
    publicLine,
    `${profile.product_name} ${lowerFirst(profile.one_line_pitch.trim())}`,
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
