#!/usr/bin/env node
// Guard the platform truth. Leassh runs on computers; it does not run on
// phones or tablets. Fail CI when marketing copy drifts.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const platforms = JSON.parse(fs.readFileSync(path.join(ROOT, "data/platforms.json"), "utf8"));
const errors = [];
const ok = [];

const byId = Object.fromEntries(platforms.platforms.map((p) => [p.id, p]));
for (const id of ["windows", "macos", "linux"]) {
  if (byId[id]?.status !== "supported") errors.push(`${id} must be supported`);
  else ok.push(`${id} supported`);
}
for (const id of ["android", "ios", "chromeos"]) {
  if (byId[id]?.status !== "not_supported") errors.push(`${id} must be not_supported`);
  else ok.push(`${id} not supported`);
}
if (platforms.dashboard?.hosted !== false) errors.push("dashboard.hosted must be false");
if (platforms.dashboard?.local_only !== true) errors.push("dashboard.local_only must be true");

const htmlFiles = fs
  .readdirSync(ROOT)
  .filter((name) => name.endsWith(".html") && !name.startsWith("current_") && !name.startsWith("live_"));

const forbidden = [
  {
    re: /Leassh[^.<]{0,80}\b(works? on|runs? on|supports?)\b[^.<]{0,60}\b(Android|iOS|iPhone|iPad|ChromeOS|Chromebook)\b/i,
    why: "Leassh Android/iOS support claim",
  },
  {
    re: /Leassh[^.<]{0,60}\b(Android|iOS|iPhone|iPad|ChromeOS|Chromebook)\b[^.<]{0,40}\b(app|agent|client)\b/i,
    why: "Leassh phone/tablet agent claim",
  },
  {
    re: /\ball devices\b/i,
    why: "'all devices' phrasing (say computers)",
  },
  {
    re: /Leassh[^.<]{0,60}\bcoming soon\b[^.<]{0,40}\b(Android|iOS|ChromeOS)\b/i,
    why: "uncommitted Android/iOS roadmap claim",
  },
];

for (const file of htmlFiles) {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  for (const { re, why } of forbidden) {
    const match = text.match(re);
    if (match) {
      // Negated statements are the honest form: "Leassh does not run on
      // Android". Do not flag those.
      if (/\b(does not|doesn't|do not|is not|isn't|not supported|no app|no phone)\b/i.test(match[0])) {
        continue;
      }
      errors.push(`${file}: ${why}: "${match[0].replace(/\s+/g, " ").slice(0, 120)}"`);
    }
  }
}

// The pages named in the brief must explicitly carry the desktop-only
// coverage note rather than only removing the bad claim.
const rewritePages = [
  "blog-parental-controls-android-2026.html",
  "blog-net-nanny-vs-leassh-android.html",
  "blog-leassh-vs-family-link-2026.html",
  "blog-leassh-vs-bark-comparison.html",
  "blog-bark-parental-controls-doesnt-support-mac.html",
  "blog-leassh-vs-microsoft-family-safety-2026.html",
];
for (const file of rewritePages) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    errors.push(`${file}: expected page is missing`);
    continue;
  }
  const text = fs.readFileSync(full, "utf8");
  if (!/Where Leassh fits/i.test(text)) {
    errors.push(`${file}: missing "Where Leassh fits" coverage note`);
  } else {
    ok.push(`${file}: coverage note`);
  }
}

const platformsPage = path.join(ROOT, "platforms.html");
if (!fs.existsSync(platformsPage)) {
  errors.push("platforms.html is missing");
} else {
  const text = fs.readFileSync(platformsPage, "utf8");
  for (const phrase of ["What Leassh runs on", "Android", "iOS", "ChromeOS", "not supported", "Why computers first"]) {
    if (!text.toLowerCase().includes(phrase.toLowerCase())) errors.push(`platforms.html: missing "${phrase}"`);
  }
  ok.push("platforms.html matrix");
}

if (errors.length) {
  console.error("✗ coverage claim check failed:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`✓ coverage claims OK (${htmlFiles.length} pages, ${ok.length} checks)`);
