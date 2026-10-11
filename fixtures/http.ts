// Recorded-shape HTTP fixtures for the replay script. Response bodies mirror the real
// GitHub, Greenhouse, Lever, Ashby, RSS, Algolia and DoH payload shapes (fields trimmed).
export interface FixtureResponse {
  status: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
}
export type Route = [RegExp, FixtureResponse | ((url: string) => FixtureResponse)];

const b64 = (s: string) => Buffer.from(s).toString("base64");
const iso = (daysAgo: number) => new Date(Date.parse("2026-10-11T00:00:00Z") - daysAgo * 86_400_000).toISOString();

export function repo(org: string, name: string, pushedDaysAgo: number, createdDaysAgo = 400) {
  return {
    name,
    full_name: `${org}/${name}`,
    html_url: `https://github.com/${org}/${name}`,
    fork: false,
    archived: false,
    pushed_at: iso(pushedDaysAgo),
    created_at: iso(createdDaysAgo),
    default_branch: "main",
    language: null,
  };
}

const NOT_FOUND: FixtureResponse = { status: 404, body: { message: "Not Found" } };
const RL = { "x-ratelimit-remaining": "4900", etag: 'W/"abc"' };

// ---------- rich company: "acme.dev" ----------
export const richRoutes: Route[] = [
  [/api\.github\.com\/orgs\/acme$/, { status: 200, body: { login: "acme", public_repos: 42, blog: "https://acme.dev" }, headers: RL }],
  [
    /api\.github\.com\/orgs\/acme\/repos\?.*page=1/,
    {
      status: 200,
      headers: RL,
      body: [
        repo("acme", "platform", 1),
        repo("acme", "web", 2),
        repo("acme", "billing-service", 3),
        repo("acme", "infra", 5),
        repo("acme", "mobile", 9, 30),
        repo("acme", "docs", 20),
        repo("acme", "design-system", 40),
        repo("acme", "data-pipelines", 60),
        repo("acme", "cli", 70),
        repo("acme", "acme-python", 100),
        { ...repo("acme", "old-fork", 1), fork: true },
      ],
    },
  ],
  [/api\.github\.com\/repos\/acme\/(platform|billing-service)\/languages/, { status: 200, headers: RL, body: { Go: 800_000, Shell: 20_000 } }],
  [/api\.github\.com\/repos\/acme\/web\/languages/, { status: 200, headers: RL, body: { TypeScript: 500_000, CSS: 30_000 } }],
  [/api\.github\.com\/repos\/acme\/infra\/languages/, { status: 200, headers: RL, body: { HCL: 120_000 } }],
  [/api\.github\.com\/repos\/acme\/[^/]+\/languages/, { status: 200, headers: RL, body: { Python: 50_000 } }],
  [
    /api\.github\.com\/repos\/acme\/platform\/git\/trees/,
    {
      status: 200,
      headers: RL,
      body: {
        truncated: false,
        tree: ["go.mod", ".github/workflows/ci.yml", "Dockerfile", "deploy/chart/Chart.yaml", "BUILD.bazel", "services/api/main.go"].map((path) => ({ path, type: "blob" })),
      },
    },
  ],
  [/api\.github\.com\/repos\/acme\/web\/git\/trees/, { status: 200, headers: RL, body: { truncated: false, tree: ["package.json", "playwright.config.ts", ".circleci/config.yml", "nx.json"].map((path) => ({ path, type: "blob" })) } }],
  [/api\.github\.com\/repos\/acme\/infra\/git\/trees/, { status: 200, headers: RL, body: { truncated: false, tree: ["main.tf", "modules/eks/main.tf"].map((path) => ({ path, type: "blob" })) } }],
  [/api\.github\.com\/repos\/acme\/[^/]+\/git\/trees/, { status: 200, headers: RL, body: { truncated: false, tree: [{ path: "README.md", type: "blob" }] } }],
  [/contents\/go\.mod/, { status: 200, headers: RL, body: { encoding: "base64", content: b64("module github.com/acme/platform\nrequire (\n\tgithub.com/stretchr/testify v1.9.0\n\tgithub.com/aws/aws-sdk-go-v2 v1.30.0\n)\n") } }],
  [/contents\/package\.json/, { status: 200, headers: RL, body: { encoding: "base64", content: b64(JSON.stringify({ dependencies: { next: "15" }, devDependencies: { "@playwright/test": "1", jest: "29" } })) } }],
  [/contents\/\.github\/workflows\/ci\.yml/, { status: 200, headers: RL, body: { encoding: "base64", content: b64("jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n      - uses: trunk-io/analytics-uploader@v1\n") } }],
  // jobs (greenhouse)
  [
    /boards-api\.greenhouse\.io\/v1\/boards\/acme\/jobs/,
    {
      status: 200,
      body: {
        jobs: [
          {
            id: 1,
            title: "Senior Platform Engineer",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
            first_published: iso(5),
            location: { name: "Remote" },
            departments: [{ name: "Engineering" }],
            content: "&lt;p&gt;We are migrating from Jenkins to GitHub Actions and want to reduce build times.&lt;/p&gt;&lt;h3&gt;Requirements&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;Golang and Kubernetes&lt;/li&gt;&lt;/ul&gt;&lt;h3&gt;Nice to have&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;Terraform&lt;/li&gt;&lt;/ul&gt;",
          },
          { id: 2, title: "Backend Engineer, Payments", absolute_url: "https://boards.greenhouse.io/acme/jobs/2", first_published: iso(12), location: { name: "Bengaluru" }, departments: [{ name: "Engineering" }], content: "&lt;p&gt;You will write Golang services on AWS with PostgreSQL.&lt;/p&gt;" },
          { id: 3, title: "SDET", absolute_url: "https://boards.greenhouse.io/acme/jobs/3", first_published: iso(20), location: { name: "Remote" }, departments: [{ name: "QA" }], content: "&lt;p&gt;Own our test infrastructure. Golang and Playwright.&lt;/p&gt;" },
          { id: 4, title: "Account Executive", absolute_url: "https://boards.greenhouse.io/acme/jobs/4", first_published: iso(3), location: { name: "NYC" }, departments: [{ name: "Sales" }], content: "&lt;p&gt;Sell.&lt;/p&gt;" },
        ],
      },
    },
  ],
  // blog
  [/acme\.dev\/?$/, { status: 200, headers: { "x-vercel-id": "bom1::abc" }, text: '<html><head><link rel="alternate" type="application/rss+xml" href="/blog/rss.xml"></head></html>' }],
  [
    /acme\.dev\/blog\/rss\.xml/,
    {
      status: 200,
      text: `<rss><channel>
      <item><title>How we cut CI time in half with Bazel</title><link>https://acme.dev/blog/bazel</link><pubDate>${new Date(iso(6)).toUTCString()}</pubDate></item>
      <item><title>Old post</title><link>https://acme.dev/blog/old</link><pubDate>${new Date(iso(200)).toUTCString()}</pubDate></item>
      </channel></rss>`,
    },
  ],
  [/acme\.dev\/blog\/bazel/, { status: 200, text: "<html><body><article><h1>How we cut CI time in half</h1><p>Last quarter we moved our monorepo build to Bazel.</p><p>Tests now run on Buildkite agents.</p></article></body></html>" }],
  // HN
  [/hn\.algolia\.com/, { status: 200, body: { hits: [{ objectID: "41", title: "How we cut CI time in half with Bazel", url: "https://acme.dev/blog/bazel", points: 212, num_comments: 88, created_at: iso(5) }, { objectID: "42", title: "Unrelated", url: "https://other.com/x", points: 5, num_comments: 1, created_at: iso(5) }] } }],
  // DNS + HEAD
  [/cloudflare-dns\.com.*name=www\.acme\.dev&type=CNAME/, { status: 200, body: { Answer: [{ type: 5, data: "d111111abcdef8.cloudfront.net." }] } }],
  [/cloudflare-dns\.com/, { status: 200, body: { Answer: [] } }],
];

// ---------- sdk-heavy company ----------
export const sdkRoutes: Route[] = [
  [/api\.github\.com\/orgs\/paycorp$/, { status: 200, headers: RL, body: { login: "paycorp", public_repos: 30, blog: "https://paycorp.com" } }],
  [
    /api\.github\.com\/orgs\/paycorp\/repos/,
    { status: 200, headers: RL, body: ["paycorp-python", "paycorp-node", "paycorp-go", "paycorp-java", "paycorp-ruby", "paycorp-php", "openapi", "paycorp-cli"].map((n, i) => repo("paycorp", n, i + 1)) },
  ],
  [/\/languages/, { status: 200, headers: RL, body: { Python: 100, JavaScript: 100, Go: 100, Java: 100, Ruby: 100, PHP: 100 } }],
  [/git\/trees/, { status: 200, headers: RL, body: { truncated: false, tree: [{ path: ".github/workflows/test.yml", type: "blob" }] } }],
  [/contents\//, { status: 200, headers: RL, body: { encoding: "base64", content: b64("jobs: {}") } }],
];

// ---------- no GitHub (thin) ----------
export const noGithubRoutes: Route[] = [
  [/api\.github\.com\/search\/users/, { status: 200, headers: RL, body: { items: [] } }],
  [/api\.github\.com\//, NOT_FOUND],
];

// ---------- no job board ----------
export const noJobsRoutes: Route[] = [
  [/greenhouse\.io|api\.lever\.co|ashbyhq\.com/, NOT_FOUND],
];

// ---------- GitHub 403 ----------
export const github403Routes: Route[] = [[/api\.github\.com\//, { status: 403, body: { message: "Resource not accessible" }, headers: { "x-ratelimit-remaining": "4000" } }]];

export function fakeFetch(routes: Route[], log?: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    log?.push(url);
    for (const [re, r] of routes) {
      if (re.test(url)) {
        const resp = typeof r === "function" ? r(url) : r;
        const body = resp.text ?? (resp.body !== undefined ? JSON.stringify(resp.body) : "");
        return new Response(body, { status: resp.status, headers: resp.headers });
      }
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}
