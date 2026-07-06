/**
 * Env — Environment variable loading with fail-fast validation.
 *
 * Every env var is parsed, validated, and frozen here.
 * If any required variable is missing or invalid, the application
 * exits immediately with a clear error message — never runs with
 * a partial/broken config.
 *
 * All other modules import from config/index.js (which re-exports
 * this), never from process.env directly.
 */

const path = require('path');

// Load .env from the proxy root (before any validation)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ─── Validation helper ──────────────────────────────────────────────

/**
 * Assert that a value is non-empty.  Exits the process if not.
 */
function requireEnv(value, name, docsUrl) {
  if (!value || (typeof value === 'string' && value.trim() === '')) {
    console.error(`❌ ${name} is not set in .env`);
    console.error(`   ${docsUrl}`);
    process.exit(1);
  }
}

// ─── AI Provider ────────────────────────────────────────────────────

const AI_PROVIDER = (process.env.AI_PROVIDER || 'openrouter').toLowerCase();
const VALID_PROVIDERS = ['openrouter', 'groq', 'gemini'];

if (!VALID_PROVIDERS.includes(AI_PROVIDER)) {
  console.error(`❌ Unknown AI_PROVIDER "${process.env.AI_PROVIDER}".`);
  console.error(`   Valid options: ${VALID_PROVIDERS.join(', ')}`);
  process.exit(1);
}

// ─── API Keys — validate only the selected provider's key ──────────

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (AI_PROVIDER === 'openrouter') {
  requireEnv(OPENROUTER_API_KEY, 'OPENROUTER_API_KEY',
    'Get a key at https://openrouter.ai/ and add it to proxy/.env');
}
if (AI_PROVIDER === 'groq') {
  requireEnv(GROQ_API_KEY, 'GROQ_API_KEY',
    'Get a key at https://console.groq.com/ and add it to proxy/.env');
}
if (AI_PROVIDER === 'gemini') {
  requireEnv(GEMINI_API_KEY, 'GEMINI_API_KEY',
    'Get a key at https://aistudio.google.com/app/apikeys and add it to proxy/.env');
}

// ─── Server ─────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PROXY_PORT || '3000', 10);
if (isNaN(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`❌ Invalid PROXY_PORT: "${process.env.PROXY_PORT}". Must be 1-65535.`);
  process.exit(1);
}

// ─── LLM ────────────────────────────────────────────────────────────

const LLM_MODEL = process.env.LLM_MODEL || undefined; // each provider has its own default
const LLM_TEMPERATURE = parseFloat(process.env.LLM_TEMPERATURE || '0.7');
if (isNaN(LLM_TEMPERATURE) || LLM_TEMPERATURE < 0 || LLM_TEMPERATURE > 2) {
  console.error(`❌ Invalid LLM_TEMPERATURE: "${process.env.LLM_TEMPERATURE}". Must be 0-2.`);
  process.exit(1);
}

const LLM_MAX_TOKENS = parseInt(process.env.LLM_MAX_TOKENS || '512', 10);
if (isNaN(LLM_MAX_TOKENS) || LLM_MAX_TOKENS < 1 || LLM_MAX_TOKENS > 128_000) {
  console.error(`❌ Invalid LLM_MAX_TOKENS: "${process.env.LLM_MAX_TOKENS}". Must be 1-128000.`);
  process.exit(1);
}

// ─── STT ────────────────────────────────────────────────────────────

const WHISPER_MODEL = process.env.WHISPER_MODEL || 'large-v3-turbo';
const VALID_WHISPER_MODELS = ['tiny', 'base', 'small', 'medium', 'large', 'large-v3', 'large-v3-turbo'];
if (!VALID_WHISPER_MODELS.includes(WHISPER_MODEL)) {
  console.error(`❌ Invalid WHISPER_MODEL: "${WHISPER_MODEL}".`);
  console.error(`   Valid options: ${VALID_WHISPER_MODELS.join(', ')}`);
  process.exit(1);
}

const STT_MAX_RETRIES = parseInt(process.env.STT_MAX_RETRIES || '2', 10);
if (isNaN(STT_MAX_RETRIES) || STT_MAX_RETRIES < 0 || STT_MAX_RETRIES > 10) {
  console.error(`❌ Invalid STT_MAX_RETRIES: "${process.env.STT_MAX_RETRIES}". Must be 0-10.`);
  process.exit(1);
}

// ─── STT Cloud Fallback ─────────────────────────────────────────────

const FALLBACK_STT_API_KEY = process.env.FALLBACK_STT_API_KEY || '';
const FALLBACK_STT_BASE_URL = process.env.FALLBACK_STT_BASE_URL || '';
const FALLBACK_STT_MODEL = process.env.FALLBACK_STT_MODEL || 'whisper-1';

// Validate fallback URL format
if (FALLBACK_STT_BASE_URL && !FALLBACK_STT_BASE_URL.startsWith('http')) {
  console.error(`❌ Invalid FALLBACK_STT_BASE_URL: must start with http or https`);
  process.exit(1);
}

// ─── TTS ────────────────────────────────────────────────────────────

const TTS_VOICE = process.env.TTS_VOICE || 'bn-BD-NabanitaNeural';
const TTS_SAMPLE_RATE = parseInt(process.env.TTS_SAMPLE_RATE || '24000', 10);
if (isNaN(TTS_SAMPLE_RATE) || TTS_SAMPLE_RATE < 8000 || TTS_SAMPLE_RATE > 48000) {
  console.error(`❌ Invalid TTS_SAMPLE_RATE: "${process.env.TTS_SAMPLE_RATE}". Must be 8000-48000.`);
  process.exit(1);
}

const TTS_TIMEOUT = parseInt(process.env.TTS_TIMEOUT || '15000', 10);
if (isNaN(TTS_TIMEOUT) || TTS_TIMEOUT < 1000 || TTS_TIMEOUT > 120_000) {
  console.error(`❌ Invalid TTS_TIMEOUT: "${process.env.TTS_TIMEOUT}". Must be 1000-120000.`);
  process.exit(1);
}

const TTS_CACHE_SIZE = parseInt(process.env.TTS_CACHE_SIZE || '100', 10);
if (isNaN(TTS_CACHE_SIZE) || TTS_CACHE_SIZE < 0 || TTS_CACHE_SIZE > 10_000) {
  console.error(`❌ Invalid TTS_CACHE_SIZE: "${process.env.TTS_CACHE_SIZE}". Must be 0-10000.`);
  process.exit(1);
}

// ─── WebSocket Rate Limiting ────────────────────────────────────────

const WS_MAX_PAYLOAD = parseInt(process.env.WS_MAX_PAYLOAD || String(5 * 1024 * 1024), 10);
if (isNaN(WS_MAX_PAYLOAD) || WS_MAX_PAYLOAD < 1024 || WS_MAX_PAYLOAD > 100 * 1024 * 1024) {
  console.error(`❌ Invalid WS_MAX_PAYLOAD. Must be 1024-104857600.`);
  process.exit(1);
}

const WS_RATE_LIMIT_WINDOW = parseInt(process.env.WS_RATE_LIMIT_WINDOW || '10000', 10);
const WS_RATE_LIMIT_MAX = parseInt(process.env.WS_RATE_LIMIT_MAX || '10', 10);

// ─── Export frozen, validated config object ─────────────────────────

const env = Object.freeze({
  // Server
  PORT,
  WS_MAX_PAYLOAD,
  WS_RATE_LIMIT_WINDOW,
  WS_RATE_LIMIT_MAX,

  // AI Provider
  AI_PROVIDER,
  LLM_MODEL,
  LLM_TEMPERATURE,
  LLM_MAX_TOKENS,

  // API Keys
  OPENROUTER_API_KEY,
  GROQ_API_KEY,
  GEMINI_API_KEY,

  // STT
  WHISPER_MODEL,
  STT_MAX_RETRIES,

  // STT Cloud Fallback
  FALLBACK_STT_API_KEY,
  FALLBACK_STT_BASE_URL,
  FALLBACK_STT_MODEL,

  // TTS
  TTS_VOICE,
  TTS_SAMPLE_RATE,
  TTS_TIMEOUT,
  TTS_CACHE_SIZE,
});

module.exports = env;
