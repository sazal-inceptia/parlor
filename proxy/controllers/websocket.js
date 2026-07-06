/**
 * WebSocket Controller — Client connection lifecycle & message routing.
 *
 * Orchestrates the STT → LLM → TTS pipeline for each WebSocket connection.
 * Uses structured error handling: typed errors, user-safe Bengali messages,
 * technical details logged server-side only.
 *
 * One instance is created per connected client.  It owns:
 *   - The WebSocket connection
 *   - An LlmService instance (per-connection conversation history)
 *   - The audio playback state (for barge-in support)
 *
 * Protocol (unchanged from original):
 *   Client → Server:  { audio: "<base64>" [, image: "<base64>"] }
 *   Client → Server:  { type: "interrupt" }
 *   Server → Client:  { type: "text", text: "...", llm_time: N, transcription: "..." }
 *   Server → Client:  { type: "audio_start", sample_rate: 24000, sentence_count: N }
 *   Server → Client:  { type: "audio_chunk", audio: "<base64>", index: N }
 *   Server → Client:  { type: "audio_end", tts_time: N }
 */

const sttService = require('../services/stt-service');
const LlmService = require('../services/llm-service');
const ttsService = require('../services/tts-service');
const config = require('../config');
const { STTError, LLMError, TTSError, TimeoutError, classifyError, logError } = require('../utils/errors');
const { createLogger, logger } = require('../utils/logger');

// ─── Simple per-connection rate limiter ──────────────────────────────
// Limits the number of STT→LLM→TTS turns per time window.
// Resets after the window expires.

class RateLimiter {
  constructor(windowMs, maxRequests) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.turns = [];
  }

  /**
   * Check if this request is allowed.
   * @returns {boolean} true if allowed, false if rate-limited
   */
  allow() {
    const now = Date.now();
    // Remove expired entries
    const cutoff = now - this.windowMs;
    this.turns = this.turns.filter((t) => t > cutoff);
    // Check limit
    if (this.turns.length >= this.maxRequests) {
      return false;
    }
    this.turns.push(now);
    return true;
  }
}

class WebSocketController {
  /**
   * @param {import('ws').WebSocket} ws
   */
  constructor(ws) {
    this.ws = ws;
    this.llm = new LlmService();
    this._clientAddr = ws._socket?.remoteAddress || 'unknown';
    this.log = createLogger(); // Each connection gets its own requestId
    this._rateLimiter = new RateLimiter(config.WS_RATE_LIMIT_WINDOW, config.WS_RATE_LIMIT_MAX);

    this.log.info(`[WebSocket] Client connected from ${this._clientAddr}`);

    // Bind message handler with top-level error catch
    ws.on('message', (raw) => this._onMessage(raw).catch((err) => this._handleFatal(err)));
    ws.on('close', () => this._onClose());
    ws.on('error', (err) => this.log.error('[WebSocket] Error:', err.message));
  }

  // ── Centralized Error Handler ─────────────────────────────────

  /**
   * Handle any error from the pipeline without crashing the connection.
   *
   * 1. Classify the error (typed errors, network errors, timeouts)
   * 2. Log technical details server-side
   * 3. Send a user-friendly Bengali message to the client
   * 4. Keep the WebSocket alive for the next turn
   */
  _handleFatal(rawErr) {
    const err = classifyError(rawErr, { provider: this.llm?.constructor?.name });
    logError('[WS]', err);

    // Extract a safe user message — never expose internals
    const userMessage =
      err instanceof STTError ? err.userMessage
      : err instanceof LLMError ? err.userMessage
      : err instanceof TimeoutError ? err.userMessage
      : config.USER_MESSAGES.UNKNOWN_ERROR;

    // Send fallback to client (only if socket is still open)
    this._sendText(userMessage, 0, '');
    this._stepTts(userMessage).catch((ttsErr) => {
      this.log.error('[TTS] Error during error recovery:', ttsErr);
    });
  }

  // ── Internal: message router ──────────────────────────────────

  /**
   * Route incoming WebSocket messages to the appropriate handler.
   * Top-level catch sends all errors through _handleFatal so the
   * connection stays alive.
   */
  async _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.log.warn('[WebSocket] Invalid JSON received');
      return;
    }

    // Interrupt signal — barge-in from user
    if (msg.type === 'interrupt') {
      this.log.info('[Interrupt] Client interrupted');
      return;
    }

    // Need audio at minimum
    if (!msg.audio) {
      this.log.warn('[WebSocket] Message without audio, ignoring');
      return;
    }

    // ── Input validation ────────────────────────────────────────────
    // Validate audio is a valid base64 string (not too large)
    if (typeof msg.audio !== 'string' || msg.audio.length === 0) {
      this.log.warn('[WebSocket] Invalid audio payload type');
      return;
    }

    // Estimate decoded size: base64 is ~4/3 of binary
    const estimatedSize = Math.ceil(msg.audio.length * 0.75);
    if (estimatedSize > config.WS_MAX_PAYLOAD) {
      this.log.warn(`[WebSocket] Audio too large: ~${(estimatedSize / 1024 / 1024).toFixed(1)} MB`);
      this._sendText(config.USER_MESSAGES.STT_TOO_LARGE, 0, '');
      return;
    }

    // ── Rate limiting ────────────────────────────────────────────────
    if (!this._rateLimiter.allow()) {
      this.log.warn('[WebSocket] Rate limit exceeded');
      this._sendText(config.USER_MESSAGES.STT_RATE_LIMIT, 0, '');
      return;
    }

    this.log.info(`[WebSocket] Received: audio=${Math.round(estimatedSize / 1024)} KB  image=${Boolean(msg.image)}`);

    // ── Step 1: Transcribe ──
    const transcription = await this._stepTranscribe(msg.audio);
    if (!transcription) {
      return; // _stepTranscribe already sent the fallback response + TTS
    }

    // ── Step 2: LLM (with optional image) ──
    const aiResponse = await this._stepLlm(transcription, msg.image);

    // ── Step 3: Send text ──
    this._sendText(aiResponse.text, aiResponse.time, transcription);

    // ── Step 4: TTS ──
    await this._stepTts(aiResponse.text);
  }

  // ── Step 1: STT ───────────────────────────────────────────────

  /**
   * Transcribe the audio using STT service.
   * Returns the transcription text, or null if none detected.
   * On error: sends fallback, generates TTS, returns null.
   */
  async _stepTranscribe(audioBase64) {
    try {
      const result = await sttService.transcribeAudio(audioBase64);
      const { text, source, transcribeTime, audioSizeKb, audioDuration } = result;

      this.log.info(
        `[STT] [${source}] "${text.substring(0, 100)}" ` +
        `(${transcribeTime}s, ${audioSizeKb} KB, ${(audioDuration || 0).toFixed(1)}s audio)`
      );

      if (!text) {
        this.log.info('[STT] No Bengali speech detected, sending polite prompt');
        this._sendText(config.USER_MESSAGES.STT_EMPTY, 0, '');
        await this._stepTts(config.USER_MESSAGES.STT_EMPTY);
        return null;
      }

      return text;
    } catch (err) {
      this.log.error('[STT] Error:', err);
      const fallbackMsg = err instanceof STTError
        ? err.userMessage
        : config.USER_MESSAGES.STT_EMPTY;
      this._sendText(fallbackMsg, 0, '');
      await this._stepTts(fallbackMsg);
      return null;
    }
  }

  // ── Step 2: LLM ───────────────────────────────────────────────

  /**
   * Generate an AI response from the transcribed text.
   * Optionally includes a webcam image for vision-capable providers.
   * On error: returns the user-safe message from the LLM service
   * (which already falls back via its own catch).
   */
  async _stepLlm(transcription, imageBase64) {
    this.log.info(`[LLM] Generating response...${imageBase64 ? ' (with image)' : ''}`);
    const response = await this.llm.generateResponse(transcription, imageBase64);
    this.log.info(`[LLM] (${response.time}s) → "${response.text.substring(0, 100)}"`);
    return response;
  }

  // ── Step 3: Send text ─────────────────────────────────────────

  /**
   * Send the LLM response text to the client.
   */
  _sendText(text, llmTime, transcription) {
    this._send({
      type: 'text',
      text,
      llm_time: llmTime,
      transcription,
    });
  }

  // ── Step 4: TTS (streaming) ───────────────────────────────────

  /**
   * Generate Bengali speech and stream audio chunks to the client.
   *
   * Each sentence is sent as soon as it's generated (streaming).
   * The next sentence starts generating while the previous one plays.
   * Uses the onSentence callback pattern from tts-service.
   */
  async _stepTts(text) {
    let chunkCount = 0;
    const start = Date.now();

    try {
      // Signal audio stream start (before any sentences are generated)
      this._send({
        type: 'audio_start',
        sample_rate: config.TTS_SAMPLE_RATE,
        sentence_count: ttsService.splitSentences(text).length,
      });

      // Generate speech with streaming callback
      const { totalTime } = await ttsService.generateSpeech(text, (index, total, sentence, pcm) => {
        // Strip 44-byte WAV header, send raw PCM
        const rawPcm = pcm.length > 44 ? pcm.subarray(44) : pcm;

        // Ensure even byte length (PCM16 = 2 bytes per sample)
        const alignedPcm = rawPcm.length % 2 === 0 ? rawPcm : rawPcm.subarray(0, rawPcm.length - 1);

        this._send({
          type: 'audio_chunk',
          audio: alignedPcm.toString('base64'),
          index,
        });
        chunkCount++;
      });

      // Signal audio stream end
      this._send({
        type: 'audio_end',
        tts_time: totalTime,
      });

      this.log.info(`[TTS] ${chunkCount} chunks in ${totalTime}s (streaming)`);
    } catch (err) {
      this.log.error('[TTS] Error:', err);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────

  /**
   * Send a JSON message to the client.  Safe to call even after
   * the connection has closed — catches and ignores send errors.
   */
  _send(payload) {
    if (this.ws.readyState === this.ws.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (err) {
        this.log.error('[WS] Send error:', err);
      }
    }
  }

  _onClose() {
    this.log.info(`[WebSocket] Client disconnected`);
  }
}

module.exports = WebSocketController;
