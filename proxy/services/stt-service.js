/**
 * STT Service — Speech-to-Text orchestration with WAV validation,
 *               audio diagnostics, and automatic retry.
 *
 * Pipeline:
 *   1. Decode base64 → Buffer
 *   2. Validate WAV header (RIFF, PCM, 16 kHz, 16-bit, mono)
 *   3. Log audio diagnostics (duration, sample rate, channels)
 *   4. Delegate to whisper-service (local GPU → cloud fallback)
 *   5. If empty, retry once
 *   6. Return transcribed text with metadata
 */

const { transcribe } = require('../whisper-service');
const config = require('../config');
const { WAV_HEADER_SIZE, WAV_EXPECTED } = require('../config/constants');
const { STTError, logError } = require('../utils/errors');
const { logger } = require('../utils/logger');

/**
 * Parse and validate a WAV audio buffer.
 *
 * Searches for the "data" chunk dynamically (handles WAVs with extra
 * chunks like "fact" that shift the data offset).
 *
 * @param {Buffer} buffer
 * @returns {{ channels:number, sampleRate:number, bitsPerSample:number, durationSec:number }}
 * @throws {STTError} If the buffer is not a valid WAV
 */
function parseWavHeader(buffer) {
  if (buffer.length < WAV_HEADER_SIZE) {
    throw new STTError(
      `Audio too short: ${buffer.length} bytes (minimum ${WAV_HEADER_SIZE} for WAV header)`
    );
  }

  const riff = buffer.toString('ascii', 0, 4);
  if (riff !== WAV_EXPECTED.riff) {
    throw new STTError(`Invalid audio: missing RIFF header (got "${riff}")`);
  }

  const wave = buffer.toString('ascii', 8, 12);
  if (wave !== WAV_EXPECTED.wave) {
    throw new STTError(`Invalid audio: missing WAVE identifier (got "${wave}")`);
  }

  // Read format from fmt chunk (always at offset 20 after RIFF + WAVE)
  const audioFormat = buffer.readUInt16LE(20);
  if (audioFormat !== WAV_EXPECTED.audioFormat) {
    throw new STTError(
      `Unsupported audio format: ${audioFormat} (expected PCM=${WAV_EXPECTED.audioFormat})`
    );
  }

  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);

  // ── Search for the "data" chunk ───────────────────────────────
  // fmt chunk size is at offset 16; data may follow after variable-length fmt
  const fmtChunkSize = buffer.readUInt32LE(16);
  let dataOffset = 20 + fmtChunkSize; // Start searching after fmt chunk

  // Some WAVs pad fmt chunk to even size
  if (dataOffset % 2 !== 0) dataOffset += 1;

  // Scan for "data" chunk
  let dataSize = 0;
  while (dataOffset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', dataOffset, dataOffset + 4);
    const chunkSize = buffer.readUInt32LE(dataOffset + 4);
    if (chunkId === 'data') {
      dataSize = chunkSize;
      break;
    }
    // Skip to next chunk
    dataOffset += 8 + chunkSize;
    if (dataOffset % 2 !== 0) dataOffset += 1;
  }

  const bytesPerFrame = channels * (bitsPerSample / 8);
  const durationSec = dataSize > 0 && bytesPerFrame > 0
    ? dataSize / (sampleRate * bytesPerFrame)
    : 0;

  // Validate and warn about deviations
  if (channels !== WAV_EXPECTED.channels) {
    logger.warn('[STT] Non-mono audio: ' + channels + ' channels');
  }
  if (sampleRate !== WAV_EXPECTED.sampleRate) {
    logger.warn('[STT] Non-standard sample rate: ' + sampleRate + ' Hz (expected ' + WAV_EXPECTED.sampleRate + ')');
  }
  if (bitsPerSample !== WAV_EXPECTED.bitsPerSample) {
    logger.warn('[STT] Non-standard bit depth: ' + bitsPerSample + '-bit (expected ' + WAV_EXPECTED.bitsPerSample + ')');
  }
  if (durationSec > 0 && durationSec < 0.3) {
    logger.warn(`[STT] Very short audio: ${durationSec.toFixed(2)}s — likely noise or truncation`);
  }
  if (durationSec > 30) {
    logger.warn(`[STT] Long audio: ${durationSec.toFixed(1)}s — may increase latency`);
  }
  if (durationSec === 0) {
    logger.warn('[STT] Could not determine audio duration (data chunk not found or empty)');
  }

  return { channels, sampleRate, bitsPerSample, dataSize, durationSec };
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Transcribe a base64-encoded audio message from the client.
 *
 * Steps:
 *   1. Decode base64 → Buffer
 *   2. Validate WAV header
 *   3. Log diagnostics
 *   4. Transcribe (with auto-retry on empty result)
 *
 * @param {string} audioBase64 - Base64-encoded WAV audio (16 kHz, 16-bit mono)
 * @returns {Promise<{text:string, source:string, transcribeTime:number}>}
 * @throws {STTError} On invalid audio or transcription failure
 */
async function transcribeAudio(audioBase64) {
  // ── Step 1: Decode ──
  let audioBuffer;
  try {
    audioBuffer = Buffer.from(audioBase64, 'base64');
  } catch (err) {
    throw new STTError(`Invalid base64 audio: ${err.message}`);
  }

  // ── Step 2: Validate WAV header ──
  const info = parseWavHeader(audioBuffer);

  // ── Step 3: Log audio diagnostics ──
  logger.info(
    `[STT] Audio: ${(audioBuffer.length / 1024).toFixed(0)} KB | ` +
    `${info.durationSec.toFixed(1)}s | ` +
    `${info.sampleRate / 1000} kHz | ` +
    `${info.bitsPerSample}-bit | ` +
    `${info.channels === 1 ? 'mono' : info.channels + 'ch'}`
  );

  // ── Step 4: Transcribe (with retry) ──
  let lastError = null;

  for (let attempt = 1; attempt <= config.STT_MAX_RETRIES; attempt++) {
    try {
      const sttResult = await transcribe(audioBuffer);

      if (sttResult.text) {
        return {
          text: sttResult.text,
          source: sttResult.source || 'local',
          transcribeTime: sttResult.transcribeTime || 0,
          audioSizeKb: Math.round(audioBuffer.length / 1024),
          audioDuration: info.durationSec,
        };
      }

      // Empty result — retry if attempts remain
      if (attempt < config.STT_MAX_RETRIES) {
        logger.warn(`[STT] Empty transcription (attempt ${attempt}/${config.STT_MAX_RETRIES}), retrying...`);
        // Small delay before retry to allow model to settle
        await new Promise((r) => setTimeout(r, 500));
      } else {
        logger.warn(`[STT] Empty transcription after ${config.STT_MAX_RETRIES} attempts`);
      }
    } catch (err) {
      lastError = err;
      if (attempt < config.STT_MAX_RETRIES) {
        logger.warn(`[STT] Attempt ${attempt} failed: ${err.message}, retrying...`);
        await new Promise((r) => setTimeout(r, 1000));
      } else {
        logError('[STT]', err);
      }
    }
  }

  throw new STTError(
    `Transcription failed after ${config.STT_MAX_RETRIES} attempts`,
    lastError?.userMessage
  );
}

module.exports = { transcribeAudio, parseWavHeader };
