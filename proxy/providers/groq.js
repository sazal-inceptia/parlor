/**
 * Groq Provider — LLM via Groq API.
 *
 * Implements the common provider interface: { name, chat() }.
 * Uses Groq's extremely fast inference on open-source models.
 *
 * To activate, set in .env:
 *   AI_PROVIDER=groq
 *   GROQ_API_KEY=gsk_your_key_here
 *   LLM_MODEL=llama-3.3-70b-versatile   (default, very fast on Groq)
 *
 * Other recommended Groq models:
 *   - llama-3.3-70b-versatile   (fast, 70B, excellent Bengali)
 *   - llama-3.1-8b-instant      (fastest, 8B)
 *   - mixtral-8x7b-32768        (large context, 32K)
 */

const axios = require('axios');
const https = require('https');
const config = require('../config');
const { LLMError } = require('../utils/errors');

/** Reusable HTTPS agent with keep-alive */
const _agent = new https.Agent({ keepAlive: true });

class GroqProvider {
  constructor() {
    this._name = 'groq';
    this._client = axios.create({
      baseURL: 'https://api.groq.com/openai/v1',
      timeout: config.LLM_TIMEOUT,
      httpsAgent: _agent,
      headers: {
        Authorization: `Bearer ${config.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
  }

  get name() {
    return this._name;
  }

  /** Whether this provider can process image inputs. */
  get capabilities() {
    // Groq supports vision only on specific models (llama-3.2-*vision*)
    const model = process.env.LLM_MODEL || '';
    return { vision: model.includes('vision') };
  }

  /**
   * Send a chat completion request to Groq.
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
      throw new LLMError('Groq returned empty response', undefined, { provider: 'groq' });
    }
    return text;
  }
}

module.exports = GroqProvider;
