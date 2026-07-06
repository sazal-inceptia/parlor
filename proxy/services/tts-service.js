/**
 * TTS Service — Bengali Text-to-Speech via edge-tts.
 *
 * Architecture:
 *   text → edge-tts (Python) → MP3 (temp file) → ffmpeg (pipe) → PCM Buffer
 *
 * Key features:
 *   - Streaming: calls onSentence callback as each sentence is generated
 *   - Caching: repeated sentences return instantly (in-memory LRU)
 *   - Configurable voice via TTS_VOICE in .env
 *   - No WAV temp files (ffmpeg pipes directly to stdout)
 *   - Graceful silence fallback on failure
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const config = require('../config');
const { splitSentences, escapeShellArg } = require('../utils/text');
const { TTSError, logError } = require('../utils/errors');
const { logger } = require('../utils/logger');

// ─── Async subprocess helper (non-blocking) ─────────────────────────

/**
 * Run a command asynchronously without blocking the event loop.
 *
 * @param {string} file - Executable path
 * @param {string[]} args - Arguments
 * @param {object} [options] - Child process options
 * @returns {Promise<{stdout:string, stderr:string}>}
 */
function execAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

// ─── Sentence Cache ─────────────────────────────────────────────────
// In-memory Map: text → PCM Buffer.  Cleared on server restart.
// Automatically trims to TTS_CACHE_SIZE to prevent memory leaks.

const _cache = new Map();

function _cacheGet(text) {
  const hit = _cache.get(text);
  if (hit) {
    // LRU: re-insert to move to end
    _cache.delete(text);
    _cache.set(text, hit);
    return hit;
  }
  return null;
}

function _cacheSet(text, buffer) {
  if (_cache.size >= config.TTS_CACHE_SIZE) {
    // Evict oldest entry (first key)
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
  _cache.set(text, buffer);
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Find the best available Python interpreter (venv preferred).
 * Cached after first call since the result never changes.
 */
let _pythonCmd = null;
function resolvePython() {
  if (_pythonCmd) return _pythonCmd;
  const candidates = [
    path.join(config.PROXY_DIR, '.venv', 'bin', 'python3'),
    path.join(config.PROXY_DIR, '..', '.venv', 'bin', 'python3'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      _pythonCmd = candidate;
      return _pythonCmd;
    }
  }
  _pythonCmd = process.env.WHISPER_PYTHON || 'python3';
  return _pythonCmd;
}

/**
 * Build a silence WAV buffer as a graceful fallback.
 *
 * @param {number} durationSec
 * @param {number} sampleRate
 * @returns {Buffer}
 */
function createSilenceWav(durationSec = 0.5, sampleRate = 24000) {
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  return buf;
}

// ─── Core: generate one sentence ────────────────────────────────────

/**
 * Generate PCM WAV audio for a single Bengali sentence.
 *
 * Uses cache if this exact text was generated before.
 * Writes temporary MP3 + WAV files (cleaned up after each call).
 *
 * @param {string} text - Bengali sentence to speak
 * @returns {Promise<Buffer>} WAV buffer (PCM s16le, mono, 24 kHz)
 */
async function generateSentencePcm(text) {
  // ── Check cache ──
  const cached = _cacheGet(text);
  if (cached) {
    logger.debug(`[TTS] Cache hit: "${text.substring(0, 30)}..."`);
    return cached;
  }

  const tmpDir = os.tmpdir();
  const mp3Path = path.join(tmpDir, `parlor_tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);
  const wavPath = path.join(tmpDir, `parlor_tts_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);

  try {
    const pythonCmd = resolvePython();
    const escapedText = escapeShellArg(text);

    // Step 1: edge-tts → MP3 (async, non-blocking)
    await execAsync(pythonCmd, [
      '-m', 'edge_tts',
      '--text', escapedText,
      '--voice', config.TTS_VOICE,
      '--write-media', mp3Path,
    ], { timeout: config.TTS_TIMEOUT });

    if (!fs.existsSync(mp3Path) || fs.statSync(mp3Path).size < 100) {
      throw new TTSError('edge-tts produced no output');
    }

    // Step 2: ffmpeg MP3 → WAV (file output — preserves binary integrity)
    let wavBuffer;
    const wavPath = path.join(tmpDir, `parlor_tts_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
    try {
      await execAsync('ffmpeg', [
        '-y', '-i', mp3Path,
        '-acodec', 'pcm_s16le',
        '-ac', '1',
        '-ar', String(config.TTS_SAMPLE_RATE),
        wavPath,
      ], { timeout: 10_000 });
      wavBuffer = fs.readFileSync(wavPath);
    } catch {
      // ffmpeg failed — return raw MP3 data (browser can handle it)
      wavBuffer = fs.readFileSync(mp3Path);
    }

    if (!wavBuffer || wavBuffer.length < 44) {
      throw new TTSError('ffmpeg conversion produced no output');
    }

    // Cache before returning
    _cacheSet(text, wavBuffer);
    return wavBuffer;
  } catch (err) {
    logError('[TTS]', err);
    return createSilenceWav(0.5, config.TTS_SAMPLE_RATE);
  } finally {
    // Cleanup temp files
    try { if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path); } catch { /* ignore */ }
    try { if (wavPath && fs.existsSync(wavPath)) fs.unlinkSync(wavPath); } catch { /* ignore */ }
  }
}

// ─── Streaming generator ────────────────────────────────────────────

/**
 * Generate speech from Bengali text, calling onSentence for each
 * sentence as soon as its PCM audio is ready (streaming).
 *
 * This enables the controller to send audio chunks to the browser
 * while the next sentence is still being generated.
 *
 * @param {string} text - Full Bengali response text
 * @param {function} onSentence - Callback(index, total, sentence, pcmBuffer)
 * @returns {Promise<{sentences:string[], totalTime:number}>}
 */
async function generateSpeech(text, onSentence) {
  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    return { sentences: [], totalTime: 0 };
  }

  const start = Date.now();

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i].trim();
    if (!sentence) continue;

    logger.info(`[TTS] Sentence ${i + 1}/${sentences.length}: "${sentence.substring(0, 50)}..."`);
    const pcm = await generateSentencePcm(sentence);

    // Call the streaming callback immediately
    if (typeof onSentence === 'function') {
      onSentence(i, sentences.length, sentence, pcm);
    }
  }

  return {
    sentences,
    totalTime: (Date.now() - start) / 1000,
  };
}

module.exports = {
  generateSpeech,
  generateSentencePcm,
  splitSentences,
  /** Clear the TTS cache (useful for testing) */
  clearCache: () => { _cache.clear(); },
  /** Current cache size */
  cacheSize: () => _cache.size,
};
