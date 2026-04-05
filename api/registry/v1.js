// GET /api/registry/v1
// Returns the latest command registry for paid users
// The registry JSON is embedded in the function for simplicity

const registry = require('../_lib/registry-data');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600'); // cache 1 hour

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  res.json(registry);
};
