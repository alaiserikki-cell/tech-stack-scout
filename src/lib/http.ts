export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status} for ${url}`);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchOpts extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  /** statuses that should not be retried and are returned to the caller (e.g. 404, 304) */
  passStatuses?: number[];
}

const UA = "FlakeGuard/1.0 (+https://tech-stack-scout-zeta.vercel.app)";

/** fetch with timeout, retries with exponential backoff on network errors, 429 and 5xx. */
export async function fetchRetry(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { timeoutMs = 15000, retries = 2, fetchImpl = fetch, passStatuses = [404, 304, 410, 403], ...init } = opts;
  const headers = new Headers(init.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", UA);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, headers, signal: ac.signal });
      clearTimeout(timer);
      if (res.ok || passStatuses.includes(res.status)) return res;
      if (res.status === 429 || res.status >= 500) {
        lastErr = new HttpError(res.status, url);
        const ra = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10000) : 500 * 2 ** attempt);
        continue;
      }
      throw new HttpError(res.status, url);
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof HttpError && !(e.status === 429 || e.status >= 500)) throw e;
      lastErr = e;
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<{ status: number; data: T | null; res: Response }> {
  const res = await fetchRetry(url, opts);
  if (!res.ok) return { status: res.status, data: null, res };
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) as T, res };
  } catch {
    return { status: res.status, data: null, res };
  }
}

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<{ status: number; text: string | null; finalUrl: string }> {
  const res = await fetchRetry(url, { redirect: "follow", ...opts });
  if (!res.ok) return { status: res.status, text: null, finalUrl: res.url || url };
  const text = await res.text();
  return { status: res.status, text: text.slice(0, 2_000_000), finalUrl: res.url || url };
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
