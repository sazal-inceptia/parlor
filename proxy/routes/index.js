/**
 * Routes — Express HTTP route handlers.
 *
 * Kept minimal: serves the single-page frontend.
 */

const fs = require('fs');
const config = require('../config');

/**
 * Register all HTTP routes on the Express app.
 *
 * @param {import('express').Application} app
 */
function registerRoutes(app) {
  // ── Serve the Bengali UI ──
  app.get('/', (_req, res) => {
    if (fs.existsSync(config.INDEX_HTML)) {
      res.sendFile(config.INDEX_HTML);
    } else {
      res.status(500).send('index.html not found');
    }
  });

  // ── Health check ──
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', llm: config.LLM_MODEL, stt: 'whisper' });
  });
}

module.exports = { registerRoutes };
