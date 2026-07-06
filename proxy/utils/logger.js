/**
 * Logger — Structured logging with timestamps and optional request IDs.
 *
 * Usage:
 *   const { logger } = require('./utils/logger');
 *   logger.info('Server started');
 *   logger.warn('Disk space low');
 *   logger.error('Connection failed', err);
 *
 *   // Per-request logging:
 *   const { createLogger } = require('./utils/logger');
 *   const log = createLogger('req_abc123');
 *   log.info('Processing turn');
 *
 * Output format:
 *   2026-07-06 14:30:22 [INFO]  Server started
 *   2026-07-06 14:30:22 [WARN]  Disk space low
 *   2026-07-06 14:30:22 [ERROR] Connection failed: ECONNREFUSED
 *   2026-07-06 14:30:22 [req_abc123] [INFO] Processing turn
 */

// ─── Helpers ────────────────────────────────────────────────────────

/** Pad a number to `width` digits (hoisted — created once, not per call). */
const pad = (n, w = 2) => String(n).padStart(w, '0');

/**
 * Format a timestamp as YYYY-MM-DD HH:MM:SS.mmm
 */
function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

// ─── Logger Class ───────────────────────────────────────────────────

class Logger {
  /**
   * @param {string} [requestId] - Optional ID scoped to a single conversation
   */
  constructor(requestId) {
    this._requestId = requestId;
  }

  /** Human-readable scope tag shown in every line */
  get _tag() {
    return this._requestId ? `[${this._requestId}]` : '';
  }

  /**
   * General information (normal operation, state transitions).
   */
  info(message, ...args) {
    this._write('INFO', message, args, process.stdout);
  }

  /**
   * Warning (something unexpected but non-fatal).
   */
  warn(message, ...args) {
    this._write('WARN', message, args, process.stderr);
  }

  /**
   * Error (failure handled gracefully, pipeline continues).
   */
  error(message, ...args) {
    this._write('ERROR', message, args, process.stderr);
  }

  /**
   * Debug (only printed when DEBUG=true in env).
   */
  debug(message, ...args) {
    if (!process.env.DEBUG) return;
    this._write('DEBUG', message, args, process.stdout);
  }

  /**
   * Internal: format and write a single log line.
   */
  _write(level, message, args, stream) {
    const ts = timestamp();
    const tag = this._tag;
    const prefix = `${ts} ${tag}[${level}]`;

    if (args.length > 0) {
      // Format arguments — if any are Error objects, extract their message
      const formatted = args.map((a) => {
        if (a instanceof Error) return a.stack || a.message;
        if (typeof a === 'object' && a !== null) {
          try { return JSON.stringify(a); } catch { return String(a); }
        }
        return a;
      });
      stream.write(`${prefix} ${message} ${formatted.join(' ')}\n`);
    } else {
      stream.write(`${prefix} ${message}\n`);
    }
  }
}

/**
 * Generate a short, unique request ID for a conversation session.
 */
function generateRequestId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `conv_${ts}_${rand}`;
}

// ─── Exports ────────────────────────────────────────────────────────

/** Default logger (no request ID — for startup, global logs) */
const logger = new Logger();

/**
 * Create a scoped logger for a specific conversation.
 *
 * @param {string} [requestId] - Explicit ID or auto-generated
 * @returns {Logger}
 */
function createLogger(requestId) {
  return new Logger(requestId || generateRequestId());
}

module.exports = { Logger, logger, createLogger, generateRequestId };
