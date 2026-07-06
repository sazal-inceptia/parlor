/**
 * Parlor — Bengali Voice AI Server
 *
 * 🟢 Entry point. Initializes Express, HTTP, and WebSocket.
 *     Business logic is delegated to controllers, services, and providers.
 *
 * Architecture:
 *   server.js  ←  routes/  ←  controllers/  ←  services/  ←  providers/
 *                     (HTTP)      (WebSocket)    (STT/LLM/TTS)  (OpenRouter)
 *
 * See each module's header for detailed responsibility.
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const config = require('./config');
const { registerRoutes } = require('./routes');
const WebSocketController = require('./controllers/websocket');
const { logger } = require('./utils/logger');

// ─── Express + HTTP ─────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '50mb' }));
registerRoutes(app);

// ─── Connection tracking ────────────────────────────────────────
let activeConnections = 0;
const MAX_CONNECTIONS = 100;

// ─── HTTP Server + WebSocket ────────────────────────────────────
const server = http.createServer(app);

// WebSocket server with origin validation, max payload, and connection cap
const wss = new WebSocket.Server({
  server,
  maxPayload: config.WS_MAX_PAYLOAD,
  verifyClient: (info) => {
    // Reject if at capacity
    if (activeConnections >= MAX_CONNECTIONS) {
      logger.warn(`[Security] Rejected connection: at capacity (${MAX_CONNECTIONS})`);
      return false;
    }
    // Allow same-origin and localhost connections
    const origin = info.origin || info.req.headers.origin || '';
    const host = info.req.headers.host || '';
    if (!origin || origin.includes(host) || origin.includes('localhost') ||
        origin.includes('127.0.0.1') || origin.includes('file://')) {
      return true;
    }
    logger.warn(`[Security] Rejected WebSocket from origin: ${origin}`);
    return false;
  },
});

wss.on('connection', (ws) => {
  activeConnections++;
  logger.info(`[Server] Active connections: ${activeConnections}`);

  // Track pong responses for keep-alive detection
  ws._alive = true;
  ws.on('pong', () => { ws._alive = true; });

  // Each client gets its own controller with per-connection state
  new WebSocketController(ws);

  ws.on('close', () => {
    activeConnections--;
    logger.info(`[Server] Active connections: ${activeConnections}`);
  });
});

// ─── Keep-alive interval — ping all clients every 30s ─────────
// Detects dead connections (no pong response) and cleans them up.
const keepAliveInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN && !ws._alive) {
      ws.terminate();
      return;
    }
    ws._alive = false;
    ws.ping();
  });
}, 30_000);

// ─── Graceful Shutdown ─────────────────────────────────────────
function shutdown(signal) {
  logger.info(`[Server] Received ${signal} — shutting down gracefully...`);
  clearInterval(keepAliveInterval);

  // Stop accepting new connections
  wss.close(() => {
    logger.info('[Server] WebSocket server closed');
  });

  // Close HTTP server
  server.close(() => {
    logger.info('[Server] HTTP server closed');
    process.exit(0);
  });

  // Force exit after 5s if graceful shutdown hangs
  setTimeout(() => {
    logger.error('[Server] Forced exit after shutdown timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ─── Start ──────────────────────────────────────────────────────
server.listen(config.PORT, '127.0.0.1', () => {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║    🎙️  Parlor — Bengali Voice AI      ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║  WebSocket : ws://localhost:${config.PORT}/ws     ║`);
  console.log(`║  HTTP      : http://localhost:${config.PORT}      ║`);
  console.log('╠════════════════════════════════════════╣');
  console.log('║  STT: Local Whisper + ☁️  cloud fallback   ║');
  console.log(`║  LLM: ${config.AI_PROVIDER} / ${config.LLM_MODEL.padEnd(25)}║`);
  console.log('║  TTS: edge-tts (Microsoft Bengali)    ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');
});
