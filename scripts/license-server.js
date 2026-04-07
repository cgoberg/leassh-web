#!/usr/bin/env node
// Leassh License Server
// Validates license keys, tracks active instances, manages tiers.
//
// Storage: JSON file (for MVP). Replace with a real database for production.
// Deployment: node license-server.js (standalone) or adapt for Cloudflare Workers.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.LICENSE_PORT || '8484', 10);
const API_SECRET = process.env.LICENSE_API_SECRET || 'lsh-admin-secret';
const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'licenses.json');
const MAX_INSTANCES_PER_LICENSE = 2;

// ---------------------------------------------------------------------------
// Tier definitions
// ---------------------------------------------------------------------------
const TIERS = {
  starter: {
    max_nodes: 5,
    features: ['monitoring', 'dashboard'],
  },
  pro: {
    max_nodes: 25,
    features: ['monitoring', 'dashboard', 'vision', 'enforcement', 'notifications', 'screen_time'],
  },
  family: {
    max_nodes: 10,
    features: ['monitoring', 'dashboard', 'vision', 'enforcement', 'notifications', 'screen_time'],
  },
  unlimited: {
    max_nodes: 0, // 0 = unlimited
    features: ['monitoring', 'dashboard', 'vision', 'enforcement', 'notifications', 'screen_time'],
  },
};

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------
function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveDb(licenses) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(licenses, null, 2));
}

function findLicense(key) {
  const db = loadDb();
  return db.find((l) => l.key === key) || null;
}

// ---------------------------------------------------------------------------
// Key generation: LSH-XXXXX-XXXXX-XXXXX-XXXXX
// ---------------------------------------------------------------------------
function generateKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const segments = [];
  for (let s = 0; s < 4; s++) {
    let seg = '';
    for (let i = 0; i < 5; i++) {
      seg += chars[crypto.randomInt(chars.length)];
    }
    segments.push(seg);
  }
  return `LSH-${segments.join('-')}`;
}

// ---------------------------------------------------------------------------
// Request body parser
// ---------------------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Route: POST /api/license/validate
// ---------------------------------------------------------------------------
async function handleValidate(req, res) {
  const { license_key, hardware_fingerprint, node_count } = await readBody(req);

  if (!license_key) {
    return json(res, 400, { valid: false, error: 'Missing license_key' });
  }

  const db = loadDb();
  const license = db.find((l) => l.key === license_key);

  if (!license) {
    return json(res, 200, { valid: false, error: 'License not found' });
  }

  // Check expiry
  if (license.expires_at && new Date(license.expires_at) < new Date()) {
    return json(res, 200, { valid: false, error: 'License expired' });
  }

  // Check hardware fingerprint / instance tracking
  if (hardware_fingerprint) {
    const existing = (license.active_instances || []).find(
      (i) => i.fingerprint === hardware_fingerprint,
    );
    if (existing) {
      existing.last_seen = new Date().toISOString();
      existing.node_count = node_count || existing.node_count;
    } else {
      // Prune stale instances (not seen in 7 days)
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      license.active_instances = (license.active_instances || []).filter(
        (i) => new Date(i.last_seen).getTime() > sevenDaysAgo,
      );

      if (license.active_instances.length >= MAX_INSTANCES_PER_LICENSE) {
        return json(res, 200, {
          valid: false,
          error: `Maximum ${MAX_INSTANCES_PER_LICENSE} active instances exceeded`,
        });
      }

      license.active_instances.push({
        fingerprint: hardware_fingerprint,
        last_seen: new Date().toISOString(),
        node_count: node_count || 0,
      });
    }
  }

  // Check node count
  const maxNodes = license.max_nodes;
  if (maxNodes > 0 && node_count && node_count > maxNodes) {
    return json(res, 200, {
      valid: false,
      error: `Node count ${node_count} exceeds max ${maxNodes} for tier ${license.tier}`,
    });
  }

  // Save updated instances
  saveDb(db);

  return json(res, 200, {
    valid: true,
    tier: license.tier,
    max_nodes: license.max_nodes,
    features: license.features,
    expires_at: license.expires_at,
  });
}

// ---------------------------------------------------------------------------
// Route: POST /api/license/create  (admin — requires API_SECRET)
// ---------------------------------------------------------------------------
async function handleCreate(req, res) {
  // Check auth
  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${API_SECRET}`) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  const { email, tier, duration_days } = await readBody(req);

  if (!email || !tier) {
    return json(res, 400, { error: 'Missing email or tier' });
  }

  const tierDef = TIERS[tier];
  if (!tierDef) {
    return json(res, 400, { error: `Unknown tier: ${tier}. Valid: ${Object.keys(TIERS).join(', ')}` });
  }

  const days = duration_days || 365;
  const now = new Date();
  const expires = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const license = {
    key: generateKey(),
    email,
    tier,
    max_nodes: tierDef.max_nodes,
    features: tierDef.features,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    active_instances: [],
  };

  const db = loadDb();
  db.push(license);
  saveDb(db);

  return json(res, 201, license);
}

// ---------------------------------------------------------------------------
// Route: GET /api/license/info/:key  (admin — requires API_SECRET)
// ---------------------------------------------------------------------------
function handleInfo(req, res, key) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${API_SECRET}`) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  const license = findLicense(key);
  if (!license) {
    return json(res, 404, { error: 'License not found' });
  }

  return json(res, 200, license);
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    // POST /api/license/validate
    if (req.url === '/api/license/validate' && req.method === 'POST') {
      return await handleValidate(req, res);
    }

    // POST /api/license/create
    if (req.url === '/api/license/create' && req.method === 'POST') {
      return await handleCreate(req, res);
    }

    // GET /api/license/info/:key
    const infoMatch = req.url?.match(/^\/api\/license\/info\/(.+)$/);
    if (infoMatch && req.method === 'GET') {
      return handleInfo(req, res, decodeURIComponent(infoMatch[1]));
    }

    // Health
    if (req.url === '/health') {
      return json(res, 200, { status: 'ok' });
    }

    json(res, 404, { error: 'Not found' });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

// Only start listening when run directly (not when required for tests)
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Leassh License Server listening on port ${PORT}`);
  });
}

module.exports = { server, loadDb, saveDb, generateKey, findLicense, TIERS, handleValidate, handleCreate };
