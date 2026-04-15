#!/usr/bin/env node

/**
 * Convert markdown blog posts to the Leassh HTML blog format
 * Usage: node scripts/convert-md-to-html.js [markdown-file.md]
 */

const fs = require('fs');
const path = require('path');

// Simple markdown parser (no external dependencies)
function parseMarkdown(md) {
  const lines = md.split('\n');
  const blocks = [];
  let currentBlock = '';
  let inCodeBlock = false;
  let inList = false;
  let listType = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      currentBlock += line + '\n';
      continue;
    }

    if (inCodeBlock) {
      currentBlock += line + '\n';
      continue;
    }

    // Headings
    if (line.startsWith('## ')) {
      if (currentBlock.trim()) {
        blocks.push({ type: 'paragraph', content: currentBlock.trim() });
      }
      currentBlock = '';
      blocks.push({ type: 'h2', content: line.substring(3) });
      continue;
    }

    if (line.startsWith('### ')) {
      if (currentBlock.trim()) {
        blocks.push({ type: 'paragraph', content: currentBlock.trim() });
      }
      currentBlock = '';
      blocks.push({ type: 'h3', content: line.substring(4) });
      continue;
    }

    // Lists
    if (line.match(/^- \[x\]/i) || line.match(/^- \[ \]/i)) {
      if (!inList) {
        if (currentBlock.trim()) {
          blocks.push({ type: 'paragraph', content: currentBlock.trim() });
        }
        inList = true;
        listType = 'checkbox';
        currentBlock = '';
      }
      const checked = line.match(/\[x\]/i) ? 'checked' : '';
      const text = line.replace(/^- \[[x ]\]\s*/i, '');
      currentBlock += `<li><input type="checkbox" ${checked} disabled> ${text}</li>\n`;
      continue;
    }

    if (line.startsWith('- ')) {
      if (inList && listType === 'checkbox') {
        if (currentBlock.trim()) {
          blocks.push({ type: 'list', content: currentBlock.trim(), listType: 'checkbox' });
        }
        inList = true;
        listType = 'bullet';
        currentBlock = '';
      }
      if (!inList) {
        if (currentBlock.trim()) {
          blocks.push({ type: 'paragraph', content: currentBlock.trim() });
        }
        inList = true;
        listType = 'bullet';
        currentBlock = '';
      }
      const text = line.substring(2);
      currentBlock += `<li>${text}</li>\n`;
      continue;
    }

    if (inList) {
      if (currentBlock.trim()) {
        blocks.push({ type: 'list', content: currentBlock.trim(), listType: listType });
      }
      inList = false;
      listType = null;
      currentBlock = line + '\n';
      continue;
    }

    // Tables
    if (line.startsWith('|')) {
      if (currentBlock.trim()) {
        blocks.push({ type: 'paragraph', content: currentBlock.trim() });
      }
      currentBlock = line + '\n';
      inList = false;
      listType = null;
      continue;
    }

    // Empty line ends table
    if (line.trim() === '' && currentBlock.trim().startsWith('|')) {
      blocks.push({ type: 'table', content: currentBlock.trim() });
      currentBlock = '';
      continue;
    }

    // Regular paragraph
    if (line.trim() === '') {
      if (currentBlock.trim()) {
        blocks.push({ type: 'paragraph', content: currentBlock.trim() });
      }
      currentBlock = '';
      continue;
    }

    currentBlock += line + '\n';
  }

  // Handle remaining content
  if (currentBlock.trim()) {
    if (currentBlock.trim().startsWith('|')) {
      blocks.push({ type: 'table', content: currentBlock.trim() });
    } else {
      blocks.push({ type: 'paragraph', content: currentBlock.trim() });
    }
  }

  return blocks;
}

function renderBlocks(blocks) {
  let html = '';
  let inList = false;
  let listType = null;

  for (const block of blocks) {
    if (block.type === 'h2') {
      html += `<h2>${escapeHtml(block.content)}</h2>\n`;
    } else if (block.type === 'h3') {
      html += `<h3>${escapeHtml(block.content)}</h3>\n`;
    } else if (block.type === 'paragraph') {
      // Convert markdown formatting
      let text = block.content;
      text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      text = text.replace(/\*\*(.+?)\*/g, '<strong>$1</strong>');
      text = text.replace(/`(.+?)`/g, '<code>$1</code>');
      text = text.replace(/\n/g, '<br/>');
      html += `<p>${text}</p>\n`;
    } else if (block.type === 'list' || block.type === 'checkbox') {
      if (inList && listType !== block.listType) {
        html += '</ul>\n';
      }
      if (!inList) {
        html += `<ul>\n`;
        inList = true;
      }
      html += block.content;
      listType = block.listType;
    } else if (block.type === 'table') {
      html += renderTable(block.content);
    }
  }

  if (inList) {
    html += '</ul>\n';
  }

  return html;
}

function renderTable(tableContent) {
  const lines = tableContent.trim().split('\n');
  if (lines.length < 2) return '<p>' + escapeHtml(tableContent) + '</p>\n';

  let html = '<table class="feature-table">\n';

  // Parse rows
  const rows = [];
  for (const line of lines) {
    if (line.startsWith('|---')) continue; // Skip separator
    const cells = line.split('|').map(c => c.trim()).filter((_, i, arr) => i !== 0 && i !== arr.length - 1);
    rows.push(cells);
  }

  // First row is header
  if (rows.length > 0) {
    html += '  <thead>\n    <tr>\n';
    for (const cell of rows[0]) {
      html += `      <th>${escapeHtml(cell)}</th>\n`;
    }
    html += '    </tr>\n  </thead>\n';

    // Rest are body
    html += '  <tbody>\n';
    for (let i = 1; i < rows.length; i++) {
      html += '    <tr>\n';
      for (const cell of rows[i]) {
        html += `      <td>${escapeHtml(cell)}</td>\n`;
      }
      html += '    </tr>\n';
    }
    html += '  </tbody>\n';
  }

  html += '</table>\n';
  return html;
}

function escapeHtml(text) {
  const htmlEntities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return text.replace(/[&<>"']/g, char => htmlEntities[char]);
}

function extractFrontmatter(md, mdPath) {
  const titleMatch = md.match(/^# (.+)$/m);
  const publishedMatch = md.match(/\*Published (.+?) \| By (.+?)\*/);
  const author = publishedMatch ? publishedMatch[2] : 'Carl-Gustav Öberg';
  const published = publishedMatch ? publishedMatch[1] : new Date().toISOString().split('T')[0];

  // Use filename as slug source (remove -2026.md suffix)
  const filename = path.basename(mdPath, '.md');
  const slug = filename.replace(/-2026$/, '');

  return {
    title: titleMatch ? titleMatch[1] : 'Untitled',
    author,
    published,
    slug
  };
}

function generateHTML(title, author, published, contentBlocks) {
  const renderedContent = renderBlocks(contentBlocks);

  const dateObj = new Date(published);
  const formattedDate = dateObj.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const description = title.length > 160 ? title.substring(0, 157) + '...' : title;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Leassh | Digital Parenting Insights</title>
<meta name="description" content="${description}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="https://leassh.com/blog/${slugify(title)}">
<meta property="og:type" content="article">
<meta property="article:published_time" content="${published}">
<meta property="article:author" content="${author}">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="https://leassh.com/blog/${slugify(title)}">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "${title}",
  "description": "${description}",
  "datePublished": "${published}",
  "dateModified": "${published}",
  "url": "https://leassh.com/blog/${slugify(title)}",
  "mainEntityOfPage": { "@type": "WebPage", "@id": "https://leassh.com/blog/${slugify(title)}" },
  "author": { "@type": "Person", "name": "${author}", "url": "https://forgenord.com" },
  "publisher": {
    "@type": "Organization",
    "name": "Leassh",
    "url": "https://leassh.com"
  }
}
</script>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text x='4' y='26' font-size='28' font-weight='700' fill='%23d4a24c'>L</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;500;600;700;800&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:         #0f0d0a;
    --bg-raised:  #1a1714;
    --bg-warm:    #211e19;
    --border:     #302b23;
    --text:       #ece4d6;
    --text-mid:   #b8ad9b;
    --text-dim:   #7a6f5e;
    --amber:      #d4a24c;
    --amber-soft: #c4913f;
    --amber-bg:   rgba(212, 162, 76, 0.08);
    --font-d: 'Bricolage Grotesque', Georgia, serif;
    --font-b: 'Instrument Sans', system-ui, sans-serif;
    --ease: cubic-bezier(0.16, 1, 0.3, 1);
    --max: 1080px;
    --prose: 720px;
  }

  html { scroll-behavior: smooth; }
  body { background: var(--bg); color: var(--text); font-family: var(--font-b); font-size: 16px; line-height: 1.65; -webkit-font-smoothing: antialiased; }

  .atmo {
    position: fixed; inset: 0;
    background:
      radial-gradient(ellipse 70% 50% at 30% 0%, rgba(212,162,76,0.06), transparent 70%),
      radial-gradient(ellipse 50% 60% at 80% 100%, rgba(106,191,105,0.03), transparent 70%);
    pointer-events: none; z-index: 0;
  }

  .wrap { position: relative; z-index: 1; }

  nav {
    display: flex; align-items: center;
    max-width: var(--max); margin: 0 auto; padding: 24px 32px;
  }

  .nav-brand { font-family: var(--font-d); font-size: 22px; font-weight: 700; color: var(--amber); text-decoration: none; letter-spacing: -0.5px; }
  .nav-toggle-input { display: none; }
  .nav-hamburger { display: none; cursor: pointer; padding: 8px; z-index: 101; margin-left: auto; }
  .nav-hamburger span { display: block; width: 22px; height: 2px; background: var(--text); margin: 5px 0; transition: transform 0.3s var(--ease), opacity 0.2s; border-radius: 1px; }
  .nav-toggle-input:checked ~ .nav-links { display: flex; }
  .nav-toggle-input:checked ~ .nav-hamburger span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
  .nav-toggle-input:checked ~ .nav-hamburger span:nth-child(2) { opacity: 0; }
  .nav-toggle-input:checked ~ .nav-hamburger span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }
  .nav-links { margin-left: auto; display: flex; gap: 32px; list-style: none; align-items: center; }
  .nav-links a { color: var(--text-mid); text-decoration: none; font-size: 14px; font-weight: 500; transition: color 0.2s; }
  .nav-links a:hover { color: var(--text); }
  .nav-links a.active { color: var(--text); }
  .nav-fleet { color: var(--text-dim) !important; font-style: italic; }
  .nav-fleet:hover { color: var(--text-mid) !important; }
  .nav-cta { background: var(--amber); color: var(--bg) !important; padding: 8px 20px; border-radius: 6px; font-weight: 600 !important; transition: transform 0.2s var(--ease), box-shadow 0.2s; }
  .nav-cta:hover { transform: translateY(-1px); box-shadow: 0 4px 20px rgba(212, 162, 76, 0.25); }
  .nav-cta-mobile { display: none; }

  /* Blog post */
  .post-header {
    max-width: var(--prose); margin: 0 auto; padding: 80px 32px 40px;
  }

  .post-eyebrow {
    font-size: 13px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 2px; color: var(--amber); margin-bottom: 20px;
  }

  .post-header h1 {
    font-family: var(--font-d); font-size: clamp(28px, 5vw, 42px);
    font-weight: 800; line-height: 1.2; letter-spacing: -0.5px; margin-bottom: 16px;
  }

  .post-meta {
    color: var(--text-mid); font-size: 14px; display: flex; gap: 16px; align-items: center;
  }

  .post-meta a { color: var(--text-mid); text-decoration: none; transition: color 0.2s; }
  .post-meta a:hover { color: var(--text); }

  .post-content {
    max-width: var(--prose); margin: 0 auto; padding: 0 32px 100px;
  }

  .post-body {
    font-size: 17px;
  }

  .post-body h2 {
    font-family: var(--font-d); font-size: 24px; font-weight: 700;
    margin-top: 48px; margin-bottom: 16px; letter-spacing: -0.3px;
  }

  .post-body h3 {
    font-family: var(--font-d); font-size: 20px; font-weight: 700;
    margin-top: 36px; margin-bottom: 12px; letter-spacing: -0.3px;
  }

  .post-body p {
    margin-bottom: 20px;
  }

  .post-body ul {
    margin-bottom: 20px; padding-left: 24px;
  }

  .post-body li {
    margin-bottom: 8px;
  }

  .post-body strong {
    color: var(--text);
  }

  .post-body code {
    background: var(--bg-warm); border: 1px solid var(--border);
    padding: 2px 6px; border-radius: 4px; font-family: var(--font-b);
    font-size: 0.9em;
  }

  .post-body table {
    width: 100%; margin: 24px 0; border-collapse: collapse;
  }

  .post-body table th, .post-body table td {
    padding: 12px 16px; text-align: left; border: 1px solid var(--border);
  }

  .post-body table th {
    background: var(--bg-warm); font-weight: 600;
  }

  .post-body table td input[type="checkbox"] {
    margin-right: 8px; accent-color: var(--amber);
  }

  .post-body blockquote {
    border-left: 3px solid var(--amber); padding-left: 16px; margin: 24px 0;
    color: var(--text-mid); font-style: italic;
  }

  .post-footer {
    max-width: var(--prose); margin: 0 auto; padding: 0 32px 100px;
  }

  .post-divider {
    border: 0; height: 1px; background: var(--border); margin: 40px 0;
  }

  .post-author {
    background: var(--bg-warm); border: 1px solid var(--border);
    border-radius: 16px; padding: 32px; margin-top: 24px;
  }

  .post-author strong {
    color: var(--text); font-size: 16px;
  }

  .post-author a {
    color: var(--amber); text-decoration: none; font-weight: 500;
  }

  .post-author a:hover {
    color: var(--amber-soft);
  }

  /* Footer */
  footer {
    max-width: var(--max); margin: 0 auto; padding: 40px 32px;
    border-top: 1px solid var(--border);
  }

  .footer-content {
    display: flex; justify-content: space-between; align-items: center;
    color: var(--text-dim); font-size: 13px;
  }

  @media (max-width: 768px) {
    nav { padding: 16px 24px; }
    .nav-links { display: none; }
    .nav-hamburger { display: block; }
    .post-header, .post-content, .post-footer { padding-left: 24px; padding-right: 24px; }
    .post-header { padding-top: 48px; }
  }
</style>
</head>
<body>
<div class="atmo"></div>
<div class="wrap">
<nav>
<a href="/" class="nav-brand">Leassh</a>
<input type="checkbox" id="nav-toggle" class="nav-toggle-input">
<label for="nav-toggle" class="nav-hamburger">
<span></span><span></span><span></span>
</label>
<ul class="nav-links">
<li><a href="/features">Features</a></li>
<li><a href="/pricing">Pricing</a></li>
<li><a href="/docs">Docs</a></li>
<li><a href="/blog">Blog</a></li>
<li><a href="/fleet" class="nav-fleet">Fleet</a></li>
<li><a href="/install" class="nav-cta">Get Started</a></li>
</ul>
</nav>

<header class="post-header">
<span class="post-eyebrow">Blog</span>
<h1>${escapeHtml(title)}</h1>
<div class="post-meta">
<span>Published ${formattedDate}</span>
<span>•</span>
<span>By <a href="https://forgenord.com">${escapeHtml(author)}</a></span>
</div>
</header>

<article class="post-content">
<div class="post-body">
${renderedContent}
</div>
</article>

<footer class="post-footer">
<hr class="post-divider">
<div class="post-author">
<strong>Carl-Gustav Öberg</strong> is the founder of Leassh, a family technology platform that helps parents understand their children's digital lives through local-first monitoring. He has over a decade of experience building monitoring and analytics systems for enterprises and families.
</div>
</footer>
</div>

<footer>
<div class="footer-content">
<span>© 2026 Leassh. All rights reserved.</span>
<div>
<a href="/privacy" style="color: var(--text-dim); text-decoration: none; margin-left: 16px;">Privacy</a>
<a href="/docs" style="color: var(--text-dim); text-decoration: none; margin-left: 16px;">Docs</a>
</div>
</div>
</footer>

<script>
// Mobile nav toggle
document.getElementById('nav-toggle').addEventListener('change', function() {
  this.checked ? this.parentElement.classList.add('open') : this.parentElement.classList.remove('open');
});
</script>
</body>
</html>`;
}

function slugify(text) {
  return text.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Main
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('Usage: node convert-md-to-html.js [markdown-file.md]');
  console.log('Or run without arguments to process all markdown files in /opt/leassh/blog/');
  process.exit(1);
}

const mdPath = path.resolve(args[0]);

if (!fs.existsSync(mdPath)) {
  console.error(`File not found: ${mdPath}`);
  process.exit(1);
}

const mdContent = fs.readFileSync(mdPath, 'utf8');
const { title, author, published, slug } = extractFrontmatter(mdContent, mdPath);
const blocks = parseMarkdown(mdContent);
const html = generateHTML(title, author, published, blocks);

const outPath = `/opt/leassh-web/blog-${slug}.html`;

fs.writeFileSync(outPath, html, 'utf8');
console.log(`Generated: ${outPath}`);
console.log(`Title: ${title}`);
console.log(`Slug: ${slug}`);
console.log(`URL: https://leassh.com/blog/${slug}`);
