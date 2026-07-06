/**
 * LLM Service — Manages a per-connection conversation session
 *               with token-aware history and automatic summarization.
 *
 * Strategy:
 *   1. System prompt is always preserved (index 0).
 *   2. Recent K turns are kept in full fidelity (default: 3).
 *   3. Total estimated token count is tracked per turn.
 *   4. When the budget is exceeded, older turns are summarized
 *      into a single compressed message via a lightweight LLM call.
 *   5. If summarization fails, old turns are truncated silently.
 *
 * This reduces OpenRouter costs by shrinking each request's context
 * while preserving conversational continuity.
 */

const provider = require('../providers/provider');
const config = require('../config');
const { LLMError, classifyError, logError } = require('../utils/errors');
const { logger } = require('../utils/logger');

// ─── Constants ──────────────────────────────────────────────────────

/** Always keep this many recent user+assistant pairs verbatim. */
const KEEP_RECENT_TURNS = 3;

/** Maximum estimated tokens for the full history. */
const MAX_HISTORY_TOKENS = 2000;

/** Approximate chars-per-token ratio for Bengali (conservative). */
const CHARS_PER_TOKEN = 4;

// ─── Token Estimation ───────────────────────────────────────────────

function estimateTokens(content) {
  if (typeof content === 'string') {
    return Math.ceil(content.length / CHARS_PER_TOKEN);
  }
  if (Array.isArray(content)) {
    return content.reduce(function (sum, part) {
      if (part.type === 'text') return sum + Math.ceil((part.text || '').length / CHARS_PER_TOKEN);
      if (part.type === 'image_url') return sum + 258;
      return sum;
    }, 0);
  }
  return 0;
}

function estimateHistoryTokens(history) {
  return history.reduce(function (sum, msg) { return sum + estimateTokens(msg.content); }, 0);
}

// ─── Summarization ──────────────────────────────────────────────────

async function summarizeTurns(turns) {
  var summaryPrompt = [
    { role: 'system', content: 'You are a summarizer. Summarize the following conversation in 1-2 sentences in Bengali. Keep only important information.' },
    { role: 'user', content: turns.map(function (t) {
      var label = t.role === 'user' ? 'User' : 'AI';
      var text = typeof t.content === 'string' ? t.content
        : Array.isArray(t.content) ? t.content.map(function (p) { return p.text || '[image]'; }).join(' ')
        : '';
      return label + ': ' + text;
    }).join('\n') },
  ];

  try {
    var summary = await provider.chat(summaryPrompt, { maxTokens: 150, temperature: 0.3 });
    return summary.substring(0, 500);
  } catch (err) {
    logger.warn('[LLM] Summarization failed, will truncate instead:', err.message);
    return '';
  }
}

// ─── LlmService ─────────────────────────────────────────────────────

class LlmService {
  constructor(systemPrompt) {
    this.history = [
      { role: 'system', content: systemPrompt || config.SYSTEM_PROMPT },
    ];
    this._lastSummary = null;
  }

  async generateResponse(userMessage, imageBase64) {
    var start = Date.now();
    var userContent = this._buildUserContent(userMessage, imageBase64);
    this.history.push({ role: 'user', content: userContent });

    var responseText;
    try {
      responseText = await provider.chat(this.history);
    } catch (rawErr) {
      var err = classifyError(rawErr, { provider: provider.name });
      logError('[LLM]', err);
      responseText = err.userMessage || config.USER_MESSAGES.LLM_ERROR;
    }

    var elapsed = (Date.now() - start) / 1000;
    this.history.push({ role: 'assistant', content: responseText });

    // Post-turn: trim if over budget
    await this._trimHistory();

    return { text: responseText, time: elapsed };
  }

  /**
   * Keep history within the token budget.
   *
   * 1. Under budget: no action.
   * 2. Over budget: summarize oldest turns (before recent K).
   * 3. Summarization fails: truncate oldest pair.
   */
  async _trimHistory() {
    if (this.history.length <= 1) return;
    if (estimateHistoryTokens(this.history) <= MAX_HISTORY_TOKENS) return;

    var keepCount = 1 + KEEP_RECENT_TURNS * 2;
    if (this.history.length <= keepCount) return;

    var cutoff = this.history.length - keepCount + 1;
    var oldTurns = this.history.slice(1, cutoff);
    var recentTurns = this.history.slice(cutoff);

    var summary = await summarizeTurns(oldTurns);

    if (summary) {
      var oldTokens = estimateHistoryTokens(oldTurns);
      this.history = [
        this.history[0],
        { role: 'system', content: 'Previous conversation summary:\n' + summary },
        ...recentTurns,
      ];
      this._lastSummary = summary;
      logger.info('[LLM] Summarized ' + oldTurns.length + ' turns: ~' + oldTokens + ' -> ~' + estimateTokens(summary) + ' tokens');
    } else {
      this.history.splice(1, 2);
      logger.warn('[LLM] Summarization failed, dropped oldest turn');
    }
  }

  _buildUserContent(text, imageBase64) {
    if (!imageBase64 || !provider.capabilities?.vision) return text;
    return [
      { type: 'text', text: text },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + imageBase64 } },
    ];
  }
}

module.exports = LlmService;
