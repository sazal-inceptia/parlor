#!/usr/bin/env python3
"""
Parlor Whisper STT — Local transcription using OpenAI Whisper.
Models are automatically downloaded to ~/.cache/whisper/ on first use.

Usage:
    python whisper_transcribe.py <path_to_wav_file> [model_size]

Model sizes: tiny, base, small, medium, large (default: medium)
Bengali needs at least 'small' for decent accuracy. 'medium' is better.
"""

import sys
import os
import json
import time
import warnings
import re
from collections import Counter

warnings.filterwarnings("ignore")

# ── Bengali Unicode ranges ─────────────────────────────────────────
BENGALI_RE = re.compile(r"[\u0980-\u09FF\u09E6-\u09EF]")

# Regex to detect heavy repetition: same Bengali syllable repeated 8+ times
# e.g. "পাযাযাযাযাযাযাযাযাযা" or "আমাযাযাযাযাযাযাযা"
REPETITIVE_RE = re.compile(
    r"("
    r"(\w)\2{7,}"                          # same char 8+ times (yyyyyyyy)
    r"|"
    r"([\u0980-\u09FF])\3{5,}"             # same Bengali char 6+ times
    r")"
)


def looks_like_bengali(text: str) -> bool:
    """Return True if text contains enough Bengali characters."""
    if not text or not text.strip():
        return False
    chars = list(text.strip())
    bengali_count = len(BENGALI_RE.findall(text))
    # Require at least 40% Bengali chars (up from 15%) to filter out
    # mixed garbage like "ঘ� shipped �ṃ হান" which has some Bengali chars
    # mixed with English/other scripts.
    if len(chars) >= 3 and bengali_count / len(chars) >= 0.40:
        return True
    return False


def is_repetitive_hallucination(text: str) -> bool:
    """Detect if Whisper output is a repetitive hallucination.

    Whisper sometimes emits Bengali-script gibberish where a single
    character or syllable repeats many times, like:
      "পাযাযাযাযাযাযাযাযাযা"  (পা + lots of যাযা)
      "আমাযাযাযাযাযাযাযা"    (আ + মা + lots of যাযা)
      "হ্যাযাযাযাযাযাযাযা"
      "খালি কালি কালি কালি"  (same word repeated)
      "চাদে কাস্তা চ্যালো তাস্যালো তাস্যালো"

    Returns True if the output looks like such a hallucination.
    """
    if not text:
        return False

    # ── Regex-level: same char 8+ times ─────────────────────────────
    if REPETITIVE_RE.search(text):
        return True

    # ── Character-level: any single char >=40% ──────────────────────
    char_counts = Counter(text.replace(" ", ""))
    if char_counts:
        most_common_char, count = char_counts.most_common(1)[0]
        total = sum(char_counts.values())
        if total > 5 and count / total >= 0.40:
            return True

    # ── Bigram-level: any 2-char pair >=30% ─────────────────────────
    bigrams = [text[i:i+2] for i in range(0, len(text)-1, 2) if len(text[i:i+2]) == 2]
    if len(bigrams) >= 3:
        bigram_counts = Counter(bigrams)
        top_bigram, bg_count = bigram_counts.most_common(1)[0]
        if bg_count / len(bigrams) >= 0.30:
            return True

    # ── Word-level: same word appears many times ────────────────────
    # Catches "খালি কালি কালি কালি" or "চাদে কাস্তা চ্যালো তাস্যালো তাস্যালো"
    words = text.split()
    if len(words) >= 3:
        word_counts = Counter(words)
        top_word, wc = word_counts.most_common(1)[0]
        # If the same word makes up >=40% of all words, it's repetitive
        if wc / len(words) >= 0.40:
            return True
        # If any word appears 3+ times in a short text, it's repetitive
        if wc >= 3 and len(words) <= 10:
            return True

    return False


def _get_device():
    """Return 'mps' on Apple Silicon, 'cuda' on NVIDIA, 'cpu' otherwise."""
    import torch
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def transcribe(audio_path: str, model_size: str = "medium") -> dict:
    """Transcribe audio file using local Whisper model, forced to Bengali."""
    import whisper
    import torch

    device = _get_device()
    print(f"[Whisper] Using device: {device}", flush=True)

    start = time.time()
    print(f"[Whisper] Loading model '{model_size}'...", flush=True)

    model = whisper.load_model(model_size, device=device)

    load_time = time.time() - start
    print(f"[Whisper] Model loaded in {load_time:.1f}s", flush=True)

    # On GPU we can use fp16 for ~2x speedup
    use_fp16 = device != "cpu"

    # ── Strategy ─────────────────────────────────────────────────────
    #
    # Bengali is hard for Whisper because:
    #   - The base/multilingual models have less Bengali training data
    #   - The model can get stuck repeating Bengali syllables
    #
    # Our approach:
    #   1. temperature=0.0 (greedy) first, with automatic fallback to
    #      0.2, 0.4, 0.6, 0.8 if repetition is detected.
    #   2. language="bn" + task="transcribe" to stay in Bengali mode.
    #   3. GPU acceleration via MPS (Apple Silicon) or CUDA.
    #   4. A short initial_prompt to seed the first Bengali tokens.
    #   5. Post-processing: reject repetitive hallucinations AND
    #      non-Bengali output.

    transcribe_start = time.time()

    initial_prompt = "হ্যালো, আপনি কেমন আছেন?"

    # Use temperature fallback chain: start greedy, fall back if stuck
    temperatures = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]

    result = model.transcribe(
        audio_path,
        language="bn",
        task="transcribe",
        fp16=use_fp16,
        verbose=False,
        initial_prompt=initial_prompt,
        condition_on_previous_text=False,
        temperature=temperatures,
        compression_ratio_threshold=2.4,
        logprob_threshold=-1.0,
        no_speech_threshold=0.6,
    )

    transcribe_time = time.time() - transcribe_start

    text = result.get("text", "").strip()
    detected_lang = result.get("language", "bn")

    # ── Post-processing ──────────────────────────────────────────────

    # 1. Reject repetitive hallucinations (same char repeating)
    if text and is_repetitive_hallucination(text):
        print(f"[Whisper] Rejected repetitive hallucination: {text[:40]}", flush=True)
        text = ""

    # 2. If non-Bengali language detected, retry with stronger forcing
    if text and detected_lang and detected_lang != "bn":
        print(f"[Whisper] Detected '{detected_lang}', re-forcing Bengali...", flush=True)
        result = model.transcribe(
            audio_path,
            language="bn",
            task="transcribe",
            fp16=use_fp16,
            verbose=False,
            initial_prompt="আমি বাংলায় কথা বলি।",
            condition_on_previous_text=False,
            temperature=temperatures,
            compression_ratio_threshold=2.4,
            logprob_threshold=-1.0,
            no_speech_threshold=0.6,
        )
        text = result.get("text", "").strip()
        # Check again for repetition
        if text and is_repetitive_hallucination(text):
            print(f"[Whisper] Retry also repetitive, discarding", flush=True)
            text = ""

    # 3. Final check: must look like Bengali
    if text and not looks_like_bengali(text):
        print(f"[Whisper] Output rejected (not Bengali): {text[:60]}", flush=True)
        text = ""

    print(f"[Whisper] Result: {' '.join(text.split()[:10]) if text else '(empty)'} ({transcribe_time:.1f}s)", flush=True)

    return {
        "text": text,
        "language": "bn",
        "load_time_seconds": round(load_time, 2),
        "transcribe_time_seconds": round(transcribe_time, 2),
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: whisper_transcribe.py <audio.wav> [model_size]"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "medium"

    if not os.path.isfile(audio_path):
        print(json.dumps({"error": f"File not found: {audio_path}"}))
        sys.exit(1)

    try:
        result = transcribe(audio_path, model_size)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
