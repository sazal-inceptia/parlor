/**
 * Config — Unified config combining env vars, prompts, and constants.
 *
 * Every module in the application imports from here instead of reading
 * process.env or hardcoding strings directly.
 *
 * Sub-modules:
 *   env.js        — Environment variables with fail-fast validation
 *   prompt.js     — System prompt + user-facing Bengali messages
 *   constants.js  — Shared constants (regex, defaults, paths)
 */

const env = require('./env');
const prompt = require('./prompt');
const constants = require('./constants');

// Merge everything into a single frozen object.
// Preference order: env vars > constants defaults
const config = Object.freeze({
  // ── Server ──
  PORT: env.PORT,
  WS_MAX_PAYLOAD: env.WS_MAX_PAYLOAD,
  WS_RATE_LIMIT_WINDOW: env.WS_RATE_LIMIT_WINDOW,
  WS_RATE_LIMIT_MAX: env.WS_RATE_LIMIT_MAX,

  // ── AI Provider ──
  AI_PROVIDER: env.AI_PROVIDER,
  LLM_MODEL: env.LLM_MODEL || constants.PROVIDER_DEFAULT_MODELS[env.AI_PROVIDER],
  LLM_TEMPERATURE: env.LLM_TEMPERATURE,
  LLM_MAX_TOKENS: env.LLM_MAX_TOKENS,
  LLM_TIMEOUT: constants.LLM_DEFAULT_TIMEOUT,

  // ── API Keys ──
  OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
  GROQ_API_KEY: env.GROQ_API_KEY,
  GEMINI_API_KEY: env.GEMINI_API_KEY,

  // ── STT ──
  WHISPER_MODEL: env.WHISPER_MODEL,
  STT_MAX_RETRIES: env.STT_MAX_RETRIES,
  STT_TIMEOUT: constants.STT_DEFAULT_TIMEOUT,
  STT_MAX_BUFFER: constants.STT_DEFAULT_MAX_BUFFER,

  // ── STT Cloud Fallback ──
  FALLBACK_STT_API_KEY: env.FALLBACK_STT_API_KEY,
  FALLBACK_STT_BASE_URL: env.FALLBACK_STT_BASE_URL,
  FALLBACK_STT_MODEL: env.FALLBACK_STT_MODEL,

  // ── TTS ──
  TTS_VOICE: env.TTS_VOICE,
  TTS_SAMPLE_RATE: env.TTS_SAMPLE_RATE,
  TTS_TIMEOUT: env.TTS_TIMEOUT,
  TTS_CACHE_SIZE: env.TTS_CACHE_SIZE,

  // ── Conversation ──
  MAX_HISTORY_LENGTH: constants.MAX_HISTORY_LENGTH,
  BARGE_IN_GRACE_MS: constants.BARGE_IN_GRACE_MS,

  // ── Paths ──
  PROXY_DIR: constants.PROXY_DIR,
  SRC_DIR: constants.SRC_DIR,
  INDEX_HTML: constants.INDEX_HTML,

  // ── Prompts ──
  SYSTEM_PROMPT: prompt.SYSTEM_PROMPT,
  USER_MESSAGES: prompt.USER_MESSAGES,
});

module.exports = config;
