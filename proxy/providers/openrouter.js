/**
 * OpenRouter Provider — LLM via OpenRouter API.
 *
 * Implements the common provider interface: { name, chat() }.
 *
 * To activate, set in .env:
 *   AI_PROVIDER=openrouter
 *   OPENROUTER_API_KEY=sk-or-v1-...
 *   LLM_MODEL=google/gemini-3.1-flash-image   (optional, has free tier)
 */

const axios = require('axios');
const https = require('https');
const config = require('../config');
const { LLMError } = require('../utils/errors');

/** Reusable HTTPS agent with keep-alive (avoids TLS handshake per request) */
const _agent = new https.Agent({ keepAlive: true });

class OpenRouterProvider {
  constructor() {
    this._name = 'openrouter';
    this._client = axios.create({
      baseURL: 'https://openrouter.ai/api/v1',
      timeout: config.LLM_TIMEOUT,
      httpsAgent: _agent,
      headers: {
        Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/fikrikarim/parlor',
        'X-Title': 'Parlor Bengali',
      },
    });
  }

  get name() {
    return this._name;
  }

  /** Whether this provider can process image inputs. */
  get capabilities() {
    return { vision: true }; // OpenRouter routes to vision models like gemini-3.1-flash-image
  }

  /**
   * Send a chat completion request.
   *
   * @param {Array<{role:string,content:string|Array}>} messages
   *        Content can be a string (text-only) or an array of
   *        {type, text|image_url} parts (multimodal, OpenAI format).
   * @param {object} [options]
   * @param {string}  [options.model]    - Override the default model
   * @param {number}  [options.temperature]
   * @param {number}  [options.maxTokens]
   * @returns {Promise<string>} Response text
   */
  async chat(messages, options = {}) {
    const response = await this._client.post('/chat/completions', {
      model: options.model || config.LLM_MODEL,
      messages,
      temperature: options.temperature ?? config.LLM_TEMPERATURE,
      max_tokens: options.maxTokens ?? config.LLM_MAX_TOKENS,
    });

    const text = response.data?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new LLMError('OpenRouter returned empty response', undefined, { provider: 'openrouter' });
    }
    return text;
  }
}

module.exports = OpenRouterProvider;
