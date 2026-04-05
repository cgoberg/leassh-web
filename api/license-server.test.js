#!/usr/bin/env node
// Leassh License Server — integration test
// Run: node license-server.test.js

const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'licenses.json');
const PORT = 18484; // Use a non-conflicting port for tests

// Backup existing DB and restore after tests
const backupPath = DB_PATH + '.test-backup';
let hadExistingDb = false;

function setup() {
  if (fs.existsSync(DB_PATH)) {
    hadExistingDb = true;
    fs.copyFileSync(DB_PATH, backupPath);
  }
  // Start with empty DB
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DB_PATH, '[]');
}

function teardown() {
  if (hadExistingDb) {
    fs.copyFileSync(backupPath, DB_PATH);
    fs.unlinkSync(backupPath);
  } else if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }
}

function request(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: PORT,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

async function runTests(server) {
  console.log('License Server Tests\n');

  // 1. Create a license (admin endpoint)
  console.log('--- Create license ---');
  const createRes = await request(
    'POST',
    '/api/license/create',
    { email: 'test@example.com', tier: 'family', duration_days: 30 },
    { Authorization: 'Bearer lsh-admin-secret' },
  );
  assert(createRes.status === 201, `Create returns 201 (got ${createRes.status})`);
  assert(createRes.body.key && createRes.body.key.startsWith('LSH-'), 'Key has LSH- prefix');
  assert(createRes.body.tier === 'family', 'Tier is family');
  assert(createRes.body.max_nodes === 10, 'Max nodes is 10');
  assert(createRes.body.features.includes('vision'), 'Features include vision');
  assert(createRes.body.features.includes('enforcement'), 'Features include enforcement');

  const licenseKey = createRes.body.key;

  // 2. Create without auth should fail
  console.log('\n--- Create without auth ---');
  const noAuthRes = await request('POST', '/api/license/create', {
    email: 'bad@example.com',
    tier: 'pro',
  });
  assert(noAuthRes.status === 401, 'Unauthorized without API secret');

  // 3. Validate the license
  console.log('\n--- Validate license ---');
  const validateRes = await request('POST', '/api/license/validate', {
    license_key: licenseKey,
    hardware_fingerprint: 'abc123',
    node_count: 3,
  });
  assert(validateRes.status === 200, `Validate returns 200 (got ${validateRes.status})`);
  assert(validateRes.body.valid === true, 'License is valid');
  assert(validateRes.body.tier === 'family', 'Tier is family');
  assert(validateRes.body.max_nodes === 10, 'Max nodes is 10');
  assert(Array.isArray(validateRes.body.features), 'Features is an array');

  // 4. Validate with too many nodes
  console.log('\n--- Validate with too many nodes ---');
  const tooManyRes = await request('POST', '/api/license/validate', {
    license_key: licenseKey,
    hardware_fingerprint: 'abc123',
    node_count: 15,
  });
  assert(tooManyRes.body.valid === false, 'Too many nodes rejected');

  // 5. Validate non-existent license
  console.log('\n--- Validate non-existent license ---');
  const badKeyRes = await request('POST', '/api/license/validate', {
    license_key: 'LSH-NOPE0-NOPE0-NOPE0-NOPE0',
  });
  assert(badKeyRes.body.valid === false, 'Non-existent key rejected');

  // 6. Info endpoint (admin)
  console.log('\n--- License info ---');
  const infoRes = await request('GET', `/api/license/info/${licenseKey}`, null, {
    Authorization: 'Bearer lsh-admin-secret',
  });
  assert(infoRes.status === 200, `Info returns 200 (got ${infoRes.status})`);
  assert(infoRes.body.email === 'test@example.com', 'Email matches');
  assert(infoRes.body.active_instances.length === 1, 'One active instance');
  assert(infoRes.body.active_instances[0].fingerprint === 'abc123', 'Fingerprint recorded');

  // 7. Max instances check — add a second instance, then try a third
  console.log('\n--- Max instances ---');
  await request('POST', '/api/license/validate', {
    license_key: licenseKey,
    hardware_fingerprint: 'def456',
    node_count: 2,
  });
  const thirdRes = await request('POST', '/api/license/validate', {
    license_key: licenseKey,
    hardware_fingerprint: 'ghi789',
    node_count: 1,
  });
  assert(thirdRes.body.valid === false, 'Third instance rejected');
  assert(thirdRes.body.error && thirdRes.body.error.includes('exceeded'), 'Error mentions exceeded');

  // 8. Create starter tier and verify features
  console.log('\n--- Starter tier ---');
  const starterRes = await request(
    'POST',
    '/api/license/create',
    { email: 'starter@example.com', tier: 'starter' },
    { Authorization: 'Bearer lsh-admin-secret' },
  );
  assert(starterRes.body.max_nodes === 5, 'Starter max nodes is 5');
  assert(!starterRes.body.features.includes('vision'), 'Starter has no vision');
  assert(!starterRes.body.features.includes('enforcement'), 'Starter has no enforcement');

  // Summary
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

// Main
async function main() {
  setup();

  // Set env for the server port
  process.env.LICENSE_PORT = String(PORT);
  process.env.LICENSE_API_SECRET = 'lsh-admin-secret';

  // Import and start server
  const { server } = require('./license-server');

  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  console.log(`Test server on port ${PORT}\n`);

  try {
    await runTests(server);
  } finally {
    server.close();
    teardown();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
