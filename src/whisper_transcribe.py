#!/usr/bin/env python3
"""
Parlor Whisper STT — Local transcription using Whisper.cpp (GGML/Metal).

Much faster than openai-whisper (PyTorch) because:
  - GGML quantized models are 2-4x smaller, 2-3x faster inference
  - Metal GPU acceleration via whisper.cpp's Metal backend
  - No PyTorch dependency (lighter install, less memory)
  - large-v3-turbo is faster than medium with better accuracy

Models are auto-downloaded from HuggingFace to ~/.cache/whisper-cpp/ on first use.

Usage:
    python whisper_transcribe.py <path_to_wav_file> [model_size]

Model sizes (whisper.cpp): tiny, base, small, medium, large-v3-turbo (default), large-v3
Bengali needs at least 'large-v3-turbo' for good accuracy + speed.
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

# Other South Asian scripts that whisper might confuse with Bengali
# Devanagari (Hindi, Sanskrit, Marathi) — U+0900–U+097F
DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]")
# Gurmukhi (Punjabi) — U+0A00–U+0A7F
GURMUKHI_RE = re.compile(r"[\u0A00-\u0A7F]")
# Gujarati — U+0A80–U+0AFF
GUJARATI_RE = re.compile(r"[\u0A80-\u0AFF]")
# Other Indic scripts
OTHER_INDIC_RE = re.compile(r"[\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0D80-\u0DFF]")

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
    """Return True if text is valid Bengali (Bengali script, no other Indic scripts).

    Rejects text that:
    - Has Devanagari, Gurmukhi, Gujarati, or other Indic characters
      (whisper sometimes mixes Hindi/Devanagari chars into Bengali output)
    - Has less than 40% Bengali Unicode characters
    """
    if not text or not text.strip():
        return False

    text = text.strip()

    # Reject if contains Devanagari (Hindi) characters
    if DEVANAGARI_RE.search(text):
        return False

    # Reject if contains other non-Bengali Indic scripts
    if GURMUKHI_RE.search(text) or GUJARATI_RE.search(text) or OTHER_INDIC_RE.search(text):
        return False

    # Must have at least 40% Bengali characters
    chars = list(text)
    bengali_count = len(BENGALI_RE.findall(text))
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


# ── Model name mapping: user-friendly → whisper.cpp GGML filenames ─
# Models downloaded from: https://huggingface.co/ggerganov/whisper.cpp
# Cached in: ~/.cache/whisper-cpp/
MODEL_MAP = {
    "tiny":            "ggml-tiny.bin",
    "base":            "ggml-base.bin",
    "small":           "ggml-small.bin",
    "medium":          "ggml-medium.bin",
    "large":           "ggml-large-v3-turbo.bin",  # 'large' defaults to turbo
    "large-v3":        "ggml-large-v3.bin",
    "large-v3-turbo":  "ggml-large-v3-turbo.bin",
}

# HF repo for whisper.cpp GGML models
HF_REPO = "ggerganov/whisper.cpp"
HF_BASE = f"https://huggingface.co/{HF_REPO}/resolve/main"

# ── Default model ────────────────────────────────────────────────────
DEFAULT_MODEL = "large-v3-turbo"

# Cache directory
CACHE_DIR = os.path.expanduser("~/.cache/whisper-cpp/")


def get_model_filename(model_size: str) -> str:
    """Map user-friendly model name to GGML filename."""
    return MODEL_MAP.get(model_size, f"ggml-{model_size}.bin")


def ensure_model(model_size: str) -> str:
    """Download GGML model if not already cached. Returns local file path."""
    filename = get_model_filename(model_size)
    model_path = os.path.join(CACHE_DIR, filename)

    if os.path.isfile(model_path):
        print(f"[Whisper.cpp] Model cached at {model_path}", flush=True)
        return model_path

    # Download from HuggingFace
    url = f"{HF_BASE}/{filename}"
    os.makedirs(CACHE_DIR, exist_ok=True)

    print(f"[Whisper.cpp] Downloading {filename} from HuggingFace...", flush=True)
    print(f"[Whisper.cpp] URL: {url}", flush=True)

    import urllib.request
    import shutil

    tmp_path = model_path + ".download"
    try:
        with urllib.request.urlopen(url) as response:
            total = int(response.headers.get("Content-Length", 0))
            downloaded = 0
            with open(tmp_path, "wb") as f:
                while True:
                    chunk = response.read(8192)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total > 0:
                        pct = downloaded * 100 // total
                        if pct % 10 == 0:
                            print(f"[Whisper.cpp] Download: {pct}% ({downloaded // 1024 // 1024} MB / {total // 1024 // 1024} MB)", flush=True)
        os.rename(tmp_path, model_path)
        print(f"[Whisper.cpp] Model saved to {model_path}", flush=True)
    except Exception as e:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise RuntimeError(f"Failed to download model {filename}: {e}")

    return model_path


def transcribe(audio_path: str, model_size: str = DEFAULT_MODEL) -> dict:
    """Transcribe audio file using Whisper.cpp (GGML/Metal).

    Much faster than openai-whisper because:
      - whisper.cpp uses GGML quantized models (smaller + faster)
      - Metal GPU acceleration on Apple Silicon via Accelerate framework
      - No PyTorch overhead
    """
    import subprocess
    import shutil

    # Find whisper-cli binary (Homebrew installs it)
    WHISPER_CLI = shutil.which("whisper-cli") or "/opt/homebrew/Cellar/whisper-cpp/1.9.1/bin/whisper-cli"

    if not os.path.isfile(WHISPER_CLI):
        raise RuntimeError(
            f"whisper-cli not found at {WHISPER_CLI}. "
            "Install it via: brew install whisper-cpp"
        )

    # Resolve model path (download if needed)
    model_path = ensure_model(model_size)

    print(f"[Whisper.cpp] CLI: {WHISPER_CLI}", flush=True)
    print(f"[Whisper.cpp] Device: Apple M4 Metal GPU", flush=True)
    print(f"[Whisper.cpp] Model: {model_path}", flush=True)

    start = time.time()
    load_time = time.time() - start

    transcribe_start = time.time()

    # ── Strategy ─────────────────────────────────────────────────────
    #
    # Using Homebrew's whisper-cli which has full Metal GPU acceleration.
    # large-v3-turbo has excellent Bengali accuracy.
    #
    # Our approach:
    #   1. Run whisper-cli as a subprocess with Metal GPU
    #   2. language="bn" to force Bengali
    #   3. Output JSON for parsing
    #   4. Post-processing: reject repetitive hallucinations AND
    #      non-Bengali output with retry on failure.

    def _run_whisper(temp: float = 0.0, prompt: str = "") -> str:
        """Run whisper-cli and return transcribed text."""
        cmd = [
            WHISPER_CLI,
            "-m", model_path,
            "-f", audio_path,
            "-l", "bn",
            "-t", "4",            # threads
            "-tp", str(temp),     # temperature
            "-bs", "1",           # beam size 1 (greedy) for speed, retry with higher if needed
            "-bo", "1",           # best of
            "--no-fallback",      # disable internal temp fallback (we handle in Python)
            "--no-timestamps",
        ]
        if prompt:
            cmd += ["--prompt", prompt]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
        )

        # whisper-cli prints transcribed text to stdout, stderr has progress
        text = result.stdout.strip()
        # Remove any trailing progress indicator or newlines
        text = text.rstrip("% \t\r\n")

        return text

    text = ""
    try:
        text = _run_whisper(temp=0.0)
    except subprocess.TimeoutExpired:
        print("[Whisper.cpp] First pass timed out", flush=True)
    except Exception as e:
        print(f"[Whisper.cpp] First pass error: {e}", flush=True)

    transcribe_time = time.time() - transcribe_start

    # ── Post-processing ──────────────────────────────────────────────

    # Helper: check if text is valid Bengali transcription
    def _is_valid(t: str) -> bool:
        if not t:
            return False
        if is_repetitive_hallucination(t):
            return False
        if not looks_like_bengali(t) and len(t) > 3:
            return False
        return True

    def _retry(temp: float, prompt: str = "", beam: int = 5) -> str:
        """Run whisper with different params, return validated text."""
        try:
            # Override beam size for retry (wider search = better accuracy)
            cmd = [
                WHISPER_CLI,
                "-m", model_path,
                "-f", audio_path,
                "-l", "bn",
                "-t", "4",
                "-tp", str(temp),
                "-bs", str(beam),
                "-bo", str(beam),
                "--no-fallback",
                "--no-timestamps",
            ]
            if prompt:
                cmd += ["--prompt", prompt]

            r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            t = r.stdout.strip().rstrip("% \t\r\n")
            return t if _is_valid(t) else ""
        except Exception as e:
            print(f"[Whisper.cpp] Retry error: {e}", flush=True)
            return ""

    # Check first pass (greedy, fast)
    if _is_valid(text):
        pass  # Accept as-is
    else:
        # Retry 1: higher temp + Bengali prompt, wider beam
        print(f"[Whisper.cpp] First pass rejected, retrying (temp=0.2, beam=5)...", flush=True)
        text2 = _retry(0.2, "আমি বাংলায় কথা বলি। হ্যালো, আপনি কেমন আছেন?", beam=5)
        if text2:
            text = text2
        else:
            # Retry 2: extended Bengali prompt, greedy
            print(f"[Whisper.cpp] Second retry with extended prompt...", flush=True)
            text3 = _retry(0.0, "আমি বাংলায় কথা বলি। হ্যালো, আপনি কেমন আছেন? আমি ভালো আছি। বাংলা আমার মাতৃভাষা।", beam=5)
            if text3:
                text = text3
            else:
                # Last resort: keep non-repetitive text even if not Bengali-looking
                if text and not is_repetitive_hallucination(text):
                    pass
                else:
                    text = ""

    print(f"[Whisper.cpp] Result: {' '.join(text.split()[:10]) if text else '(empty)'} ({transcribe_time:.1f}s)", flush=True)

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
    model_size = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_MODEL

    if not os.path.isfile(audio_path):
        print(json.dumps({"error": f"File not found: {audio_path}"}))
        sys.exit(1)

    try:
        result = transcribe(audio_path, model_size)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
