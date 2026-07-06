/**
 * Gemini Provider — LLM via Google Gemini API.
 *
 * Implements the common provider interface: { name, chat() }.
 * Uses Google's Gemini models directly via the generateContent endpoint.
 *
 * To activate, set in .env:
 *   AI_PROVIDER=gemini
 *   GEMINI_API_KEY=your_key_here
 *   LLM_MODEL=gemini-2.0-flash-001   (default, fast & free tier)
 *
 * Other recommended Gemini models:
 *   - gemini-2.0-flash-001       (fast, free tier, excellent Bengali)
 *   - gemini-2.0-flash-lite-001  (even faster, lighter)
 *   - gemini-3.1-flash-image     (multimodal, OpenRouter only)
 */

const axios = require('axios');
const https = require('https');
const config = require('../config');
const { LLMError } = require('../utils/errors');

/** Reusable HTTPS agent with keep-alive */
const _agent = new https.Agent({ keepAlive: true });

class GeminiProvider {
  constructor() {
    this._name = 'gemini';
    this._baseURL = 'https://generativelanguage.googleapis.com/v1beta';
  }

  get name() {
    return this._name;
  }

  /** Whether this provider can process image inputs. */
  get capabilities() {
    return { vision: true }; // All Gemini models natively support images
  }

  /**
   * Convert a single content part (string or OpenAI-format array)
   * to Gemini's parts array.
   *
   * OpenAI format:  [{type:'text', text:'...'}, {type:'image_url', image_url:{url:'data:...'}}]
   * Gemini format:  [{text:'...'}, {inlineData:{mimeType:'image/jpeg', data:'base64...'}}]
   */
  _contentToGeminiParts(content) {
    // String → simple text part
    if (typeof content === 'string') {
      return [{ text: content }];
    }

    // Array → convert each item
    if (Array.isArray(content)) {
      const parts = [];
      for (const item of content) {
        if (item.type === 'text') {
          parts.push({ text: item.text });
        } else if (item.type === 'image_url') {
          // OpenAI format: data:image/jpeg;base64,<base64>
          const url = item.image_url?.url || '';
          const match = url.match(/^data:(image\/\w+);base64,(.+)$/);
          if (match) {
            parts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          }
        }
      }
      return parts;
    }

    // Fallback
    return [{ text: String(content) }];
  }

  /**
   * Convert OpenAI-style messages to Gemini's format.
   *
   * Gemini uses:
   *   - "system" → systemInstruction at top level
   *   - "user" / "model" → contents array
   *   - Images → inlineData in parts
   */
  _toGeminiFormat(messages) {
    let systemInstruction = '';
    const contents = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = msg.content;
      } else if (msg.role === 'user') {
        contents.push({ role: 'user', parts: this._contentToGeminiParts(msg.content) });
      } else if (msg.role === 'assistant') {
        contents.push({ role: 'model', parts: [{ text: msg.content }] });
      }
    }

    const body = {
      contents,
      generationConfig: {
        temperature: config.LLM_TEMPERATURE,
        maxOutputTokens: config.LLM_MAX_TOKENS,
      },
    };

    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    return body;
  }

  /**
   * Extract text from Gemini's response format.
   */
  _parseResponse(response) {
    const candidate = response.data?.candidates?.[0];
    if (!candidate) {
      throw new Error('Gemini returned no candidates');
    }
    const text = candidate.content?.parts
      ?.map((p) => p.text)
      .filter(Boolean)
      .join('')
      .trim();

    if (!text) {
      throw new LLMError('Gemini returned empty response', undefined, { provider: 'gemini' });
    }
    return text;
  }

  /**
   * Send a chat completion request to Gemini.
   *
   * @param {Array<{role:string,content:string}>} messages
   * @param {object} [options]
   * @param {string}  [options.model]    - Override the default model
   * @param {number}  [options.temperature]
   * @param {number}  [options.maxTokens]
   * @returns {Promise<string>} Response text
   */
  async chat(messages, options = {}) {
    const model = options.model || config.LLM_MODEL;
    const url = `${this._baseURL}/models/${model}:generateContent`;

    const body = this._toGeminiFormat(messages);

    // Apply per-call overrides
    if (options.temperature !== undefined) {
      body.generationConfig.temperature = options.temperature;
    }
    if (options.maxTokens !== undefined) {
      body.generationConfig.maxOutputTokens = options.maxTokens;
    }

    const response = await axios.post(url, body, {
      params: { key: config.GEMINI_API_KEY },
      timeout: config.LLM_TIMEOUT,
      httpsAgent: _agent,
      headers: { 'Content-Type': 'application/json' },
    });

    return this._parseResponse(response);
  }
}

module.exports = GeminiProvider;
