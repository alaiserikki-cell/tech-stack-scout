const fs = require("fs");
const ed = (f, a, b) => { let s = fs.readFileSync(f, "utf8"); if (!s.includes(a)) { console.log("MISS", f, a.slice(0, 60)); process.exitCode = 1; return; } fs.writeFileSync(f, s.replace(a, b)); };
ed("src/collectors/jobs.ts", `  step: "Reading job posts",\n  timeoutMs: 60_000,`, `  step: "Reading job posts",\n  timeoutMs: 100_000,`);
ed("src/app/api/companies/[id]/sources/route.ts",
  `      const [provider, slug] = value.split("/");\n      if (!["greenhouse", "lever", "ashby"].includes(provider) || !slug)`,
  `      const i = value.indexOf("/");\n      const provider = value.slice(0, i);\n      const slug = value.slice(i + 1);\n      if (i < 1 || !["greenhouse", "lever", "ashby", "workday", "smartrecruiters"].includes(provider) || !slug)`);
ed("src/app/api/companies/[id]/sources/route.ts", `"Use provider/slug, e.g. greenhouse/acme, or none."`, `"Use provider/slug, e.g. greenhouse/acme or workday/acme/wd1/AcmeCareers, or none."`);
ed("src/collectors/hosting.ts", `  [/webflow\.io\.?$|proxy-ssl\.webflow\.com\.?$/i, "Webflow"],`, `  [/webflow\.io\.?$|proxy-ssl\.webflow\.com\.?$/i, "Webflow"],\n  [/myshopify\.com\.?$|shopify\.com\.?$/i, "Shopify"],`);
ed("src/collectors/hosting.ts", `  [(h) => h.has("x-github-request-id"), "GitHub Pages", "x-github-request-id header"],`, `  [(h) => h.has("x-github-request-id"), "GitHub Pages", "x-github-request-id header"],\n  [(h) => h.has("x-shopid") || h.has("x-shopify-stage") || /shopify/i.test(h.get("powered-by") ?? ""), "Shopify", "x-shopid / x-shopify-stage header"],`);
console.log("done");
