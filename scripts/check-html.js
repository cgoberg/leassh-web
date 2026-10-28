#!/usr/bin/env node
// Static QA: titles, descriptions, canonicals, H1s, JSON-LD, and internal
// links. Deliberately dependency-free so it runs in verify.sh and CI.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const errors = [];
const rewrites = new Set();
const redirects = new Set();

const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
for (const r of vercel.rewrites || []) {
  if (r.source.startsWith("/api/")) continue;
  if (r.source.startsWith("/")) rewrites.add(r.source.replace(/\/$/, ""));
}
for (const r of vercel.redirects || []) {
  redirects.add(r.source.replace(/\/$/, ""));
}

const files = fs
  .readdirSync(ROOT)
  .filter((name) => name.endsWith(".html") && !name.startsWith("current_") && !name.startsWith("live_"));

function fileForRoute(route) {
  const clean = route.split("#")[0].split("?")[0];
  if (clean === "/") return "index.html";
  const rel = clean.replace(/^\//, "");
  if (fs.existsSync(path.join(ROOT, rel))) return rel;
  const candidates = [
    `${rel}.html`,
    path.join(rel, "index.html"),
  ];
  return candidates.find((candidate) => fs.existsSync(path.join(ROOT, candidate))) || null;
}

for (const file of files) {
  const html = fs.readFileSync(path.join(ROOT, file), "utf8");
  const title = html.match(/<title>([^<]*)<\/title>/i);
  const description = html.match(/<meta\s+name=["']description["']\s+content=(["\'])(.*?)\1/is);
  const canonical = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/i);
  const robots = html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']*)["']/i);
  const noindex = robots && /noindex/i.test(robots[1]);
  const h1s = [...html.matchAll(/<h1\b[^>]*>/gi)];

  if (!title || title[1].trim().length < 10) errors.push(`${file}: missing/short <title>`);
  if (!noindex && (!description || description[2].trim().length < 30)) {
    errors.push(`${file}: missing/short meta description`);
  }
  if (!noindex && !canonical) errors.push(`${file}: missing canonical`);
  if (h1s.length !== 1 && !noindex) errors.push(`${file}: expected exactly one <h1>, found ${h1s.length}`);

  // JSON-LD must parse.
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      JSON.parse(m[1]);
    } catch (err) {
      errors.push(`${file}: invalid JSON-LD (${err.message})`);
    }
  }

  // Internal links resolve to a file, a rewrite, or a redirect.
  for (const m of html.matchAll(/href=["'](\/[^"'#]*)/g)) {
    const href = m[1].split("?")[0].replace(/\/$/, "") || "/";
    if (href.startsWith("/api/")) continue;
    if (href.match(/\.(css|js|svg|png|jpg|jpeg|webp|ico|xml|txt|ps1|sh|json)$/)) continue;
    if (href.startsWith("/leassh_static")) continue;
    if (rewrites.has(href) || redirects.has(href) || fileForRoute(href)) continue;
    errors.push(`${file}: internal link has no target: ${href}`);
  }

  // Duplicate id attributes break anchors and JS lookups.
  const ids = [...html.matchAll(/\sid=["']([^"']+)["']/g)].map((m) => m[1]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) errors.push(`${file}: duplicate id(s): ${[...new Set(dupes)].join(", ")}`);
}

if (errors.length) {
  console.error("✗ HTML/SEO check failed:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`✓ HTML/SEO OK (${files.length} pages)`);
