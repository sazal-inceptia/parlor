/**
 * Errors — Custom error classes with user-friendly Bengali messages.
 *
 * Each error carries:
 *   - message:    Technical detail (logged server-side only)
 *   - userMessage: Bengali string sent to the frontend
 *   - name:       Error class name for typed catch blocks
 */

// ─── Error Classes ─────────────────────────────────────────────────

class STTError extends Error {
  /**
   * @param {string} message - Technical detail (server log only)
   * @param {string} [userMessage] - Bengali string for the user
   */
  constructor(message, userMessage) {
    super(message);
    this.name = 'STTError';
    this.userMessage = userMessage || 'দুঃখিত, আপনার কথা বুঝতে পারিনি। দয়া করে বাংলায় বলুন।';
    this.timestamp = Date.now();
  }
}

class LLMError extends Error {
  /**
   * @param {string} message - Technical detail (server log only)
   * @param {string} [userMessage] - Bengali string for the user
   * @param {object} [meta] - Optional metadata (status code, provider name)
   */
  constructor(message, userMessage, meta = {}) {
    super(message);
    this.name = 'LLMError';
    this.userMessage = userMessage || 'দুঃখিত, একটি ত্রুটি ঘটেছে। দয়া করে আবার চেষ্টা করুন।';
    this.statusCode = meta.statusCode || 0;
    this.provider = meta.provider || 'unknown';
    this.timestamp = Date.now();
  }
}

class TTSError extends Error {
  /**
   * @param {string} message - Technical detail (server log only)
   * @param {string} [userMessage] - Bengali string for the user
   */
  constructor(message, userMessage) {
    super(message);
    this.name = 'TTSError';
    this.userMessage = userMessage || '';
    this.timestamp = Date.now();
  }
}

class TimeoutError extends Error {
  /**
   * @param {string} message - Technical detail
   * @param {string} [userMessage] - Bengali string for the user
   */
  constructor(message, userMessage) {
    super(message);
    this.name = 'TimeoutError';
    this.userMessage = userMessage || 'ক্ষমা করবেন, সময় শেষ হয়ে গেছে। দয়া করে আবার চেষ্টা করুন।';
    this.timestamp = Date.now();
  }
}

// ─── Error Classification ──────────────────────────────────────────

/**
 * Classify a caught error into a known type for structured handling.
 *
 * @param {Error} err - The caught error
 * @param {object} [context] - Optional context (provider name, etc.)
 * @returns {Error} The classified error (original or wrapped)
 */
function classifyError(err, context = {}) {
  // Already a typed error — pass through
  if (err instanceof STTError || err instanceof LLMError ||
      err instanceof TTSError || err instanceof TimeoutError) {
    return err;
  }

  // Timeout
  if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED' ||
      err.message?.includes('timeout') || err.message?.includes('Timed out')) {
    return new TimeoutError(`Operation timed out: ${err.message}`);
  }

  // LLM provider error (axios response)
  if (err.response) {
    const provider = context.provider || 'unknown';
    const status = err.response.status;
    const detail = err.response.data?.error?.message || err.response.statusText;
    return new LLMError(
      `[${provider}] HTTP ${status}: ${detail}`,
      undefined,
      { statusCode: status, provider }
    );
  }

  // Network error (no response received)
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ERR_NETWORK' ||
      err.message?.includes('ECONNREFUSED') || err.message?.includes('ENOTFOUND') ||
      err.message?.includes('getaddrinfo') || err.message?.includes('socket hang up')) {
    return new LLMError(
      `Network error: ${err.message}`,
      'দুঃখিত, নেটওয়ার্ক সংযোগে সমস্যা হয়েছে। দয়া করে আবার চেষ্টা করুন।',
      { provider: context.provider || 'unknown' }
    );
  }

  // Default: wrap as generic
  return err;
}

// ─── Server-Side Logging ───────────────────────────────────────────

/**
 * Log an error with full technical detail (server-side only).
 * Never exposes internal details to the client.
 *
 * @param {string} prefix - Log prefix like '[STT]' or '[LLM]'
 * @param {Error} err - The error to log
 */
function logError(prefix, err) {
  const parts = [`${prefix} Error:`];

  if (err.name) parts.push(`[${err.name}]`);
  parts.push(err.message);

  if (err instanceof LLMError && err.provider !== 'unknown') {
    parts.push(`(provider: ${err.provider}`);
    if (err.statusCode) parts.push(`status: ${err.statusCode}`);
    parts.push(')');
  }

  if (err.stack) {
    // Use raw console.error here to avoid circular dependency
    console.error(parts.join(' '));
    console.error(`${prefix} Stack:`, err.stack.split('\n').slice(1, 3).join(' '));
  } else {
    console.error(parts.join(' '));
  }
}

module.exports = {
  STTError,
  LLMError,
  TTSError,
  TimeoutError,
  classifyError,
  logError,
};
