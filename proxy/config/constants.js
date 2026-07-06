/**
 * Constants — Shared constants used across the codebase.
 *
 * Central location for regex patterns, expected WAV format values,
 * Bengali Unicode ranges, provider defaults, and rate-limit config.
 */

const path = require('path');

// ─── Paths ──────────────────────────────────────────────────────────
const PROXY_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.resolve(PROXY_DIR, '..', 'src');
const INDEX_HTML = path.join(SRC_DIR, 'index.html');

// ─── Bengali Unicode Range ──────────────────────────────────────────
// Bengali script occupies U+0980–U+09FF.  We also allow Assamese
// extensions (U+09FA–U+09FF), common punctuations (।, ॥), and
// Bengali digits (U+09E6–U+09EF).
const BENGALI_RE = /[\u0980-\u09FF\u09E6-\u09EF\u0964\u0965]/;

// ─── WAV Format Expectations (STT) ──────────────────────────────────
const WAV_HEADER_SIZE = 44;
const WAV_EXPECTED = Object.freeze({
  riff: 'RIFF',
  wave: 'WAVE',
  fmt: 'fmt ',
  audioFormat: 1,       // PCM (uncompressed)
  channels: 1,          // Mono
  sampleRate: 16000,    // 16 kHz
  bitsPerSample: 16,    // 16-bit
});

// ─── Provider Default Models ────────────────────────────────────────
const PROVIDER_DEFAULT_MODELS = Object.freeze({
  openrouter: 'google/gemini-3.1-flash-image',
  groq: 'llama-3.3-70b-versatile',
  gemini: 'gemini-2.0-flash-001',
});

// ─── Known Provider Names ───────────────────────────────────────────
const VALID_PROVIDERS = Object.freeze(['openrouter', 'groq', 'gemini']);

// ─── Conversation ───────────────────────────────────────────────────
const MAX_HISTORY_LENGTH = 42;
const BARGE_IN_GRACE_MS = 800;

// ─── TTS ────────────────────────────────────────────────────────────
const TTS_DEFAULT_VOICE = 'bn-BD-NabanitaNeural';
const TTS_DEFAULT_SAMPLE_RATE = 24000;
const TTS_DEFAULT_TIMEOUT = 15000;
const TTS_DEFAULT_CACHE_SIZE = 100;

// ─── STT ────────────────────────────────────────────────────────────
const STT_DEFAULT_MODEL = 'large-v3-turbo';
const STT_DEFAULT_RETRIES = 2;
const STT_DEFAULT_TIMEOUT = 120_000; // 2 min (first download)
const STT_DEFAULT_MAX_BUFFER = 1024 * 1024; // 1 MB stdout

// ─── LLM ────────────────────────────────────────────────────────────
const LLM_DEFAULT_TIMEOUT = 30_000;
const LLM_DEFAULT_TEMPERATURE = 0.7;
const LLM_DEFAULT_MAX_TOKENS = 512;

// ─── Server ─────────────────────────────────────────────────────────
const WS_DEFAULT_MAX_PAYLOAD = 5 * 1024 * 1024; // 5 MB
const WS_DEFAULT_RATE_LIMIT_WINDOW = 10_000;     // 10 seconds
const WS_DEFAULT_RATE_LIMIT_MAX = 10;             // 10 turns per window
const DEFAULT_PORT = 3000;

module.exports = {
  // Paths
  PROXY_DIR,
  SRC_DIR,
  INDEX_HTML,
  // Bengali
  BENGALI_RE,
  // WAV
  WAV_HEADER_SIZE,
  WAV_EXPECTED,
  // Providers
  PROVIDER_DEFAULT_MODELS,
  VALID_PROVIDERS,
  // Conversation
  MAX_HISTORY_LENGTH,
  BARGE_IN_GRACE_MS,
  // TTS
  TTS_DEFAULT_VOICE,
  TTS_DEFAULT_SAMPLE_RATE,
  TTS_DEFAULT_TIMEOUT,
  TTS_DEFAULT_CACHE_SIZE,
  // STT
  STT_DEFAULT_MODEL,
  STT_DEFAULT_RETRIES,
  STT_DEFAULT_TIMEOUT,
  STT_DEFAULT_MAX_BUFFER,
  // LLM
  LLM_DEFAULT_TIMEOUT,
  LLM_DEFAULT_TEMPERATURE,
  LLM_DEFAULT_MAX_TOKENS,
  // Server
  WS_DEFAULT_MAX_PAYLOAD,
  WS_DEFAULT_RATE_LIMIT_WINDOW,
  WS_DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_PORT,
};
