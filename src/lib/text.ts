const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  ndash: "-",
  mdash: "-",
  hellip: "...",
  bull: "*",
  middot: "*",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Normalise whitespace and typographic quotes so verbatim checks are robust to formatting only. */
export function normalizeText(s: string): string {
  return s
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface TextLine {
  text: string;
  heading: boolean;
}

/** Convert HTML to lines, flagging lines that look like section headings. */
export function htmlToLines(html: string): TextLine[] {
  let h = html;
  if (/&lt;\w/.test(h)) h = decodeEntities(h); // Greenhouse double-escapes content
  h = h
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  // mark headings
  h = h.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, t) => `\n@@H@@${t}\n`);
  h = h.replace(/<p[^>]*>\s*<(strong|b)[^>]*>([\s\S]*?)<\/\1>\s*(?::\s*)?<\/p>/gi, (_, __, t) => `\n@@H@@${t}\n`);
  h = h.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|ul|ol|tr|section|article|h[1-6])>/gi, "\n").replace(/<li[^>]*>/gi, "\n- ");
  h = h.replace(/<[^>]+>/g, " ");
  h = decodeEntities(h);
  const out: TextLine[] = [];
  for (const raw of h.split("\n")) {
    let heading = false;
    let t = raw;
    if (t.includes("@@H@@")) {
      heading = true;
      t = t.replace(/@@H@@/g, "");
    }
    t = normalizeText(t);
    if (!t) continue;
    if (!heading && t.length < 80 && /:$/.test(t) && !t.startsWith("- ")) heading = true;
    out.push({ text: t, heading });
  }
  return out;
}

export function htmlToText(html: string): string {
  return htmlToLines(html)
    .map((l) => l.text)
    .join("\n");
}

/** Extract the main readable text from an article page. */
export function articleText(html: string): string {
  const m = html.match(/<article[\s\S]*?<\/article>/i) ?? html.match(/<main[\s\S]*?<\/main>/i);
  const body = m ? m[0] : (html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html);
  return htmlToText(body);
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])|\n+/)
    .map((s) => s.replace(/^-\s*/, "").trim())
    .filter((s) => s.length > 3);
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary matcher that also works for aliases like "c#", "c++", ".net core". */
export function boundaryRegex(alias: string, flags = "i"): RegExp {
  return new RegExp(`(?<![a-z0-9_])${escapeRegex(alias)}(?![a-z0-9_]|\\+\\+|#)`, flags);
}

export function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function sameSite(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  const d = domain.toLowerCase().replace(/^www\./, "");
  return h === d || h.endsWith("." + d);
}
