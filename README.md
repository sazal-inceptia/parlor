# 🎙️ পার্লর (Parlor) — Bengali Voice AI

[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js)](https://nodejs.org)
[![Python](https://img.shields.io/badge/python-%3E%3D3.12-3776AB?logo=python)](https://python.org)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![OpenRouter](https://img.shields.io/badge/LLM-OpenRouter-FF6B6B)](#configuration)

> **A fork of [fikrikarim/parlor](https://github.com/fikrikarim/parlor) — adapted from an Indonesian-language Python/FastAPI on-device multimodal AI into a Bengali voice AI with a Node.js proxy layer, cloud LLM integration, and local Whisper.cpp STT with Metal GPU acceleration (no cloud fallback needed).**

Speak Bengali into your microphone. The AI understands you, responds in natural Bengali, and speaks back — all hands-free with voice-activity detection and barge-in support.

---

## 📋 Table of Contents

- [Quick Start](#-quick-start)
- [Features](#-features)
- [Architecture](#-architecture)
- [Project Structure](#-project-structure)
- [Localization](#-localization)
- [Configuration](#-configuration)
- [Performance](#-performance)
- [Troubleshooting](#-troubleshooting)
- [License](#-license)

---

## 🚀 Quick Start

### Prerequisites

```bash
brew install ffmpeg                   # macOS
node --version   # v18+
python3 --version # 3.12+
```

### 1. Get a Free API Key

| Service | Purpose | Sign Up |
|---------|---------|---------|
| **OpenRouter** | LLM inference (free tier) | [openrouter.ai](https://openrouter.ai/) |

The default LLM model `google/gemini-3.1-flash-image` has a generous free tier.

### 2. Setup & Run

```bash
# ── Install macOS dependencies ──
brew install ffmpeg whisper-cpp

# ── Install Node.js dependencies ──
cd proxy
npm install

# ── Create Python virtual environment for TTS ──
python3 -m venv .venv
source .venv/bin/activate
pip install edge-tts

# ── Configure your API key ──
cp .env.example .env
# Edit .env → set OPENROUTER_API_KEY=sk-or-v1-your-key-here

# ── Start the server ──
cd proxy
npm start
```

### 3. Open & Speak Bengali

```
http://localhost:3000
```

Grant camera and microphone access when prompted. Speak in **Bengali** — the AI responds in natural Bengali speech.

> ⏳ **First run:** Whisper.cpp GGML model downloads automatically (~1.5 GB for `large-v3-turbo`) to `~/.cache/whisper-cpp/`. Model load takes ~1-2s with Metal GPU on Apple Silicon. For best Bengali accuracy, download `large-v3` (~6 GB) and set `WHISPER_MODEL=large-v3` in `.env`.

### Model Setup

Whisper.cpp requires GGML model files. They auto-download on first use, or you can download manually:

```bash
# Default model (large-v3-turbo, ~1.5 GB - good speed/accuracy balance)
mkdir -p ~/.cache/whisper-cpp/

# Recommended for Bengali (large-v3-turbo, automatic):
#   The STT script auto-downloads this from HuggingFace on first run

# For best Bengali accuracy (large-v3, ~6 GB):
curl -L -o ~/.cache/whisper-cpp/ggml-large-v3.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin"

# Then set in .env:
# WHISPER_MODEL=large-v3
```

Models are cached in `~/.cache/whisper-cpp/`. Available models from [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp).

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎤 **Hands-free voice** | Silero VAD in the browser — no push-to-talk, just speak naturally |
| 🎯 **Bengali-first** | Full Bengali UI, Whisper ASR optimized for Bengali, Microsoft Bengali neural TTS voice |
| 📷 **Camera vision** | AI can see your webcam feed and reference it in conversation |
| ⚡ **Streaming TTS** | Sentence-level streaming — audio starts playing before the LLM finishes generating |
| 🚫 **Barge-in** | Interrupt the AI mid-response by speaking (with echo suppression) |
| 🔁 **Resilient STT** | Local Whisper.cpp (Metal GPU) with automatic cloud fallback if local fails |
| 🧠 **Pluggable LLM** | Switch between Gemini, Llama, Mistral, etc. via OpenRouter/Groq/Gemini providers |
| 📊 **Latency metrics** | Per-turn timing logged for STT, LLM, and TTS stages |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Browser                                   │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────────────────┐  │
│  │  Webcam  │   │  Microphone  │   │  Audio Playback + VAD    │  │
│  │  (1 fps) │   │  (16 kHz)    │   │  (Silero, Web Audio API) │  │
│  └────┬─────┘   └──────┬───────┘   └──────────┬───────────────┘  │
│       └────────────────┼──────────────────────┘                  │
│                        │  WebSocket (WAV + JPEG)                  │
└────────────────────────┼──────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│               🟢 Node.js Proxy (port 3000)                        │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  WebSocket Controller (controllers/websocket.js)         │     │
│  │  • Message routing • Input validation • Rate limiting    │     │
│  │  • Error recovery • Per-connection logging               │     │
│  └────────────────────┬────────────────────────────────────┘     │
│                       │                                          │
│         ┌─────────────┴─────────────┐                            │
│         ▼                           ▼                            │
│  ┌────────────────┐       ┌────────────────────┐                 │
│  │  STT Service   │       │  LLM Service        │                │
│  │  (WAV validation│      │  (token-aware       │                │
│  │   + retry +    │       │   history +         │                │
│  │   diagnostics) │       │   summarization)    │                │
│  │                │       │                    │                 │
│  │  ┌─────────┐   │       │  ┌──────────────┐  │                 │
│  │  │ Whisper │   │       │  │  Provider    │  │                 │
│  │  │ .cpp    │◄──┤       │  │  Factory     │  │                 │
│  │  │ (Metal) │   │       │  │  (openrouter │  │                 │
│  │  └────┬────┘   │       │  │   /groq/     │  │                 │
│  │       │ fail   │       │  │   gemini)    │  │                 │
│  │       ▼        │       │  └──────────────┘  │                 │
│  │  ┌─────────┐   │       └────────┬───────────┘                 │
│  │  │ Cloud   │   │                │                             │
│  │  │ STT API │   │                ▼                             │
│  │  └─────────┘   │       ┌────────────────────┐                 │
│  └───────┬────────┘       │  TTS Service        │                │
│          │                │  (async edge-tts    │                 │
│          │                │   + sentence cache  │                 │
│          │                │   + streaming cb)   │                 │
│          └───────┬────────┴────────┬───────────┘                 │
│                  ▼                  ▼                             │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  WebSocket Response Stream                              │     │
│  │  • text (LLM response) • audio_start / audio_chunk      │     │
│  │  • audio_end (streaming PCM)                            │     │
│  └─────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

### Pipeline Flow

```
Audio → [1: STT] Whisper.cpp (Metal GPU) → Bengali text
                  ↳ On failure: cloud API fallback (optional)

Text  → [2: LLM] OpenRouter / Groq / Gemini → Bengali response
                  ↳ Token-aware history with auto-summarization

Text  → [3: TTS] edge-tts (async, streaming) → PCM audio chunks
                  ↳ LRU cache for repeated sentences
```

---

## 📁 Project Structure

```
proxy/                              # 🟢 Node.js application
├── server.js                       # Entry point (Express + WebSocket)
├── config/
│   ├── index.js                    # Combined config (env + prompts + constants)
│   ├── env.js                      # Env var loading with fail-fast validation
│   ├── prompt.js                   # Bengali system prompt + user messages
│   └── constants.js                # Shared constants (regex, defaults, paths)
├── providers/
│   ├── provider.js                 # Factory — returns selected AI provider
│   ├── openrouter.js               # OpenRouter API (200+ models)
│   ├── groq.js                     # Groq API (ultra-fast open-source models)
│   └── gemini.js                   # Google Gemini API (native multimodal)
├── services/
│   ├── stt-service.js              # STT orchestration (WAV validation, retry)
│   ├── llm-service.js              # LLM conversation (token-aware history)
│   └── tts-service.js              # TTS (async edge-tts, streaming, cache)
├── controllers/
│   └── websocket.js                # WebSocket message routing & pipeline
├── routes/
│   └── index.js                    # Express HTTP routes
├── utils/
│   ├── logger.js                   # Structured logging (timestamps, IDs)
│   ├── errors.js                   # Typed errors (STTError, LLMError, etc.)
│   └── text.js                     # Bengali sentence splitting, shell escaping
├── whisper-service.js              # Low-level Whisper.cpp subprocess wrapper
├── .env                            # Configuration (git-ignored)
├── .env.example                    # Configuration template
└── package.json                    # Dependencies

src/                                # 📦 Frontend + Python scripts
├── index.html                      # Bengali UI (single-file HTML + JS)
├── whisper_transcribe.py           # Whisper.cpp STT engine (Bengali-optimized, Metal GPU)
├── server.py                       # Redirect server (optional, retained from original)
└── tts.py                          # Reference TTS (not used by proxy)

artifacts/                          # 📚 Original design docs (retained)
└── ...
```

---

## 🌐 Localization

This fork adapts every user-facing string from the original English/Indonesian codebase to natural Bengali.

| Location | Original | Adapted To |
|----------|----------|------------|
| HTML language | `en` | `bn` |
| Page title | `Parlor` | `পার্লর` |
| Status labels | `Disconnected` / `Connected` | `বিচ্ছিন্ন` / `সংযুক্ত` |
| State labels | `Listening` / `Thinking...` / `Speaking` | `শুনছি` / `ভাবছি...` / `বলছি` |
| Camera button | `Camera On` / `Camera Off` | `ক্যামেরা চালু` / `ক্যামেরা বন্ধ` |
| On-device pill | `On-device` | `ডিভাইসে চলছে` |
| LLM system prompt | English | Conversational Bengali |
| TTS voice | English (Kokoro) | `bn-BD-NabanitaNeural` (Bengali neural) |
| Bengali font | ❌ | `Hind Siliguri` added |
| Whisper.cpp STT | openai-whisper (PyTorch) | Whisper.cpp (GGML/Metal GPU) + Bengali validation |

All Bengali text uses natural, colloquial phrasing — not translated English.

---

## ⚙️ Configuration

```bash
cp proxy/.env.example proxy/.env
# Edit proxy/.env with your settings
```

### Core Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENROUTER_API_KEY` | — | OpenRouter API key for LLM |
| `AI_PROVIDER` | `openrouter` | Provider: `openrouter`, `groq`, or `gemini` |
| `LLM_MODEL` | per-provider default | Model for AI responses |
| `LLM_TEMPERATURE` | `0.7` | Creativity (0.0–2.0) |
| `LLM_MAX_TOKENS` | `512` | Max response length |

### STT Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `WHISPER_MODEL` | `large-v3-turbo` | Whisper.cpp model: `tiny` ⎮ `base` ⎮ `small` ⎮ `medium` ⎮ `large-v3-turbo` ⎮ `large-v3` |
| `FALLBACK_STT_API_KEY` | — | Cloud fallback API key (not needed for local STT) |
| `FALLBACK_STT_BASE_URL` | — | Cloud fallback endpoint (not needed for local STT) |
| `STT_MAX_RETRIES` | `2` | Retry attempts on empty transcription |

### TTS Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `TTS_VOICE` | `bn-BD-NabanitaNeural` | Bengali neural voice |
| `TTS_SAMPLE_RATE` | `24000` | Output sample rate |
| `TTS_CACHE_SIZE` | `100` | Max cached sentences |

---

## 📊 Performance

Measured on **Apple M4** with **Whisper.cpp** (Metal GPU acceleration):

| Stage | Time | Notes |
|-------|:----:|-------|
| Model load | ~1.7s | Metal shader compilation cached on subsequent runs |
| Transcription (3s audio) | ~2-4s | `large-v3-turbo` on Apple M4 Metal GPU |
| LLM inference | ~2-5s | Depends on model and network latency |
| TTS generation | ~2-4s | Per 1-3 sentences (edge-tts streaming) |
| **End-to-end** (first turn) | **~6-10s** | Includes Metal shader compilation |
| **End-to-end** (subsequent) | **~5-8s** | Model already loaded + shaders cached |

### Key Advantages over openai-whisper (PyTorch)

| Metric | openai-whisper (PyTorch) | Whisper.cpp (GGML/Metal) |
|--------|--------------------------|--------------------------|
| **Inference speed** | ~35s for 1s audio | ~3-4s for 1s audio (**~9x faster**) |
| **GPU acceleration** | MPS (unstable) | **Metal** (stable, native) |
| **Memory footprint** | ~3 GB + PyTorch overhead | ~1.5 GB (no PyTorch) |
| **Model format** | PyTorch checkpoints | GGML quantized (smaller/faster) |
| **Install size** | ~3 GB (torch + deps) | ~150 KB (Python stdlib only) |
| **Bengali accuracy** | Poor (frequent hallucinations) | **Excellent** (large-v3-turbo) |

### Whisper.cpp Model Comparison

| Model | Size | Load | Accuracy | Use Case |
|-------|:----:|:----:|:--------:|----------|
| `tiny` | 75 MB | ~0.3s | Low | Testing |
| `base` | 150 MB | ~0.5s | Fair | Quick demos |
| `small` | 460 MB | ~0.8s | Good | Balanced |
| `medium` | 1.5 GB | ~1s | Better | General use |
| `large-v3-turbo` | 1.5 GB | ~1.7s | **Great** | **Default (speed + accuracy)** |
| `large-v3` | 6 GB | ~3s | **Excellent** | Max Bengali accuracy |

---

## 🔧 Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| **whisper-cli not found** | Homebrew not installed | `brew install whisper-cpp` |
| **Missing API key error** | OpenRouter key not configured | Get key at [openrouter.ai](https://openrouter.ai/) |
| **WebSocket won't connect** | Wrong port | Open `http://localhost:3000` (not port 8000) |
| **No audio response** | `edge-tts` not installed | `pip install edge-tts` in venv |
| **Whisper returns empty** | Audio too short/quiet | Speak clearly for 1-2+ seconds |
| **"npm install" fails** | Wrong directory | Run from `proxy/` directory |
| **Camera not working** | Permissions not granted | Check browser site permissions |
| **Audio echo** | Speaker feedback | Use headphones |
| **Model download fails** | Network issue | Manually download from [HuggingFace](https://huggingface.co/ggerganov/whisper.cpp) to `~/.cache/whisper-cpp/` |
| **Poor Bengali accuracy** | Model too small | Use `large-v3` (full model) for best results |

---

## 📄 License

[Apache 2.0](LICENSE) — Original work by [fikrikarim/parlor](https://github.com/fikrikarim/parlor).

---

<p align="center">
  <sub>Built with 🟢 Node.js, 🐍 Python, and ❤️ for Bengali language technology</sub>
  <br>
  <sub>Forked from <a href="https://github.com/fikrikarim/parlor">fikrikarim/parlor</a></sub>
</p>
