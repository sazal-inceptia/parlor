/**
 * Provider Factory — Returns the AI provider selected in .env.
 *
 * Usage:
 *   const provider = require('./provider');
 *   const response = await provider.chat(messages);
 *
 * To switch providers, change AI_PROVIDER in .env — no code changes needed.
 *
 * Adding a new provider:
 *   1. Create providers/your-provider.js implementing { name, chat() }
 *   2. Add it to the PROVIDER_MAP below
 *   3. Add your API key to config/index.js
 *   4. Set AI_PROVIDER=your-provider in .env
 *
 * The rest of the application never changes.
 */

const config = require('../config');
const { logger } = require('../utils/logger');

// ─── Provider registry ─────────────────────────────────────────────
// Map provider name → constructor.
// To add a new provider, register it here — Open/Closed Principle.
const PROVIDER_MAP = {
  openrouter: './openrouter',
  groq: './groq',
  gemini: './gemini',
};

// ─── Validate ──────────────────────────────────────────────────────
if (!PROVIDER_MAP[config.AI_PROVIDER]) {
  logger.error(`❌ Unknown AI_PROVIDER "${config.AI_PROVIDER}".`);
  logger.error(`   Valid options: ${Object.keys(PROVIDER_MAP).join(', ')}`);
  process.exit(1);
}

// ─── Instantiate the selected provider ─────────────────────────────
const ProviderClass = require(PROVIDER_MAP[config.AI_PROVIDER]);
const provider = new ProviderClass();

logger.info(`🤖 AI Provider: ${provider.name} (${config.LLM_MODEL})`);

module.exports = provider;
