/**
 * Whisper Service — Local speech-to-text via Python openai-whisper
 *                   with cloud API fallback on failure.
 *
 * Architecture:
 *   1. Try local Whisper (Python subprocess, GPU via MPS)
 *   2. If local fails (OOM, model missing, timeout), fall back to
 *      OpenAI-compatible /v1/audio/transcriptions API
 *   3. Configure fallback via env vars (works with OpenAI, OpenRouter, etc.)
 *
 * The Whisper model is downloaded automatically on first use (cached in
 * ~/.cache/whisper/) so subsequent runs are fast — only model loading into
 * memory adds latency (~2-5s for 'base', ~5-10s for 'small').
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs/promises');
const os = require('os');

const SCRIPT_PATH = path.join(__dirname, '..', 'src', 'whisper_transcribe.py');
const { logger } = require('./utils/logger');
const config = require('./config');
const { BENGALI_RE } = require('./config/constants');

/**
 * Check whether a string contains enough Bengali characters to be
 * considered genuine Bengali text.
 *
 * Single-pass char-by-char scan — no temporary array allocation.
 *
 * Returns `true` if at least 15 % of visible characters are in the
 * Bengali Unicode block, OR if the string has at least 2 Bengali chars
 * (catches short utterances like "হ্যাঁ" or "না").
 */
function looksLikeBengali(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;

  let bengaliCount = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (BENGALI_RE.test(trimmed[i])) bengaliCount++;
    // Early exit: once we have 2 Bengali chars we're done for short text
    if (bengaliCount >= 2) return true;
  }

  // Longer text: at least 15 % Bengali chars
  return bengaliCount / trimmed.length >= 0.15;
}

/**
 * Transcribe a WAV audio buffer to text.
 *
 * Strategy:
 *   1. Try local Whisper (Python + GPU) first.
 *   2. If it fails (error, empty result, or rejected output), fall
 *      back to the cloud API.
 *   3. If cloud also fails, return empty (caller handles gracefully).
 *
 * @param {Buffer} audioBuffer - Raw WAV PCM data (16-bit, 16 kHz mono)
 * @param {object} [options]
 * @param {string}  [options.model] - Whisper model size (tiny/base/small/medium/large)
 * @param {boolean} [options.skipLocal] - Skip local Whisper, use cloud only
 * @returns {Promise<{text: string, language: string, loadTime: number, transcribeTime: number, source: string}>}
 */
async function transcribe(audioBuffer, options = {}) {
  const model = options.model || config.WHISPER_MODEL;

  // ── Try local Whisper first ──
  if (!options.skipLocal) {
    try {
      const localResult = await tryLocalWhisper(audioBuffer, model);
      if (localResult) return localResult;
    } catch (localErr) {
      logger.warn(`[Whisper] Local Whisper failed: ${localErr.message}`);
      logger.warn('[Whisper]   → Falling back to cloud API...');
    }
  }

  // ── Fall back to cloud API ──
  return await tryCloudWhisper(audioBuffer);
}

/**
 * Attempt local Whisper transcription via Python subprocess.
 * Returns null if result is empty or rejected (so caller can fall back).
 */
async function tryLocalWhisper(audioBuffer, model) {
  const tmpPath = path.join(os.tmpdir(), `parlor_stt_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
  await fsPromises.writeFile(tmpPath, audioBuffer);

  try {
    const result = await runPythonScript(tmpPath, model);
    const text = result.text || '';
    const loadTime = result.load_time_seconds || 0;
    const transcribeTime = result.transcribe_time_seconds || 0;

    // Final validation: discard if it doesn't look like Bengali
    if (text && !looksLikeBengali(text)) {
      logger.info(`[Whisper] Local rejected non-Bengali output: "${text.substring(0, 60)}"`);
      return null; // fall back to cloud
    }

    if (!text) {
      logger.info('[Whisper] Local returned empty transcription');
      return null; // fall back to cloud
    }

    return {
      text,
      language: 'bn',
      loadTime,
      transcribeTime,
      source: 'local',
    };
  } finally {
    // Clean up temp file
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

/**
 * Fallback: transcribe via OpenAI-compatible cloud API.
 *
 * Uses the /v1/audio/transcriptions endpoint with the configured
 * API key and base URL.  Supports OpenAI, OpenRouter, or any
 * OpenAI-compatible provider.
 */
async function tryCloudWhisper(audioBuffer) {
  if (!config.FALLBACK_STT_API_KEY) {
    logger.warn('[Whisper] Cloud fallback skipped: no FALLBACK_STT_API_KEY configured');
    return { text: '', language: 'bn', loadTime: 0, transcribeTime: 0, source: 'cloud' };
  }

  const start = Date.now();
  logger.info(`[Whisper] Cloud fallback: sending ${(audioBuffer.length / 1024).toFixed(0)} KB to ${config.FALLBACK_STT_BASE_URL}...`);

  try {
    // Build multipart form with the audio file
    const form = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/wav' });
    form.append('file', blob, 'audio.wav');
    form.append('model', config.FALLBACK_STT_MODEL);
    form.append('language', 'bn');
    form.append('response_format', 'json');

    const response = await fetch(`${config.FALLBACK_STT_BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.FALLBACK_STT_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      // Redact API keys from error messages before logging
      const sanitized = errBody.replace(/(sk-or-[a-zA-Z0-9]+)[a-zA-Z0-9]+/g, '$1***');
      throw new Error(`HTTP ${response.status}: ${sanitized.substring(0, 200)}`);
    }

    const data = await response.json();
    const text = (data.text || '').trim();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    logger.info(`[Whisper] Cloud → "${text.substring(0, 100)}" (${elapsed}s)`);

    return {
      text,
      language: 'bn',
      loadTime: 0,
      transcribeTime: parseFloat(elapsed),
      source: 'cloud',
    };
  } catch (err) {
    logger.error(`[Whisper] Cloud fallback also failed: ${err.message}`);
    return { text: '', language: 'bn', loadTime: 0, transcribeTime: 0, source: 'cloud' };
  }
}

/**
 * Spawn the Python transcription script and return parsed JSON.
 */
function getPythonCommand() {
  // Check virtual environments — try proxy/.venv, then root .venv, then system
  const candidates = [
    path.join(__dirname, '.venv', 'bin', 'python3'),
    path.join(__dirname, '..', '.venv', 'bin', 'python3'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return process.env.WHISPER_PYTHON || 'python3';
}

function runPythonScript(audioPath, model) {
  return new Promise((resolve, reject) => {
    const pythonCmd = getPythonCommand();

    const child = execFile(
      pythonCmd,
      [SCRIPT_PATH, audioPath, model],
      {
        timeout: 120_000,          // 2 min max (model download first time)
        maxBuffer: 1024 * 1024,    // 1 MB stdout
        // env inherited from process by default — no spread needed
      },
      (error, stdout, stderr) => {
        if (error) {
          // stderr may have useful diagnostics
          const msg = stderr?.trim() || error.message;
          return reject(new Error(`Whisper error: ${msg}`));
        }

        try {
          // Extract the last JSON line from mixed stdout (script prints progress too)
          const jsonMatch = stdout.match(/\{[^}]*\}/g);
          const jsonLine = jsonMatch ? jsonMatch[jsonMatch.length - 1] : null;
          if (!jsonLine) {
            return reject(new Error('No JSON output from Whisper script'));
          }
          resolve(JSON.parse(jsonLine));
        } catch (parseErr) {
          reject(new Error(`Failed to parse Whisper output: ${parseErr.message}`));
        }
      }
    );

    // Log stderr for diagnostics
    child.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) process.stderr.write(`[whisper stderr] ${msg}\n`);
    });
  });
}

module.exports = { transcribe, defaultModel: config.WHISPER_MODEL };
