# 🎙️ পার্লর (Parlor) — Bengali Voice AI

[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js)](https://nodejs.org)
[![Python](https://img.shields.io/badge/python-%3E%3D3.12-3776AB?logo=python)](https://python.org)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![OpenRouter](https://img.shields.io/badge/LLM-OpenRouter-FF6B6B)](#configuration)

> **A fork of [fikrikarim/parlor](https://github.com/fikrikarim/parlor) — adapted from an Indonesian-language Python/FastAPI on-device multimodal AI into a Bengali voice AI with a Node.js proxy layer, cloud LLM integration, and local Whisper STT with automatic cloud fallback.**

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
# ── Install Node.js dependencies ──
cd proxy
npm install

# ── Create Python virtual environment for Whisper STT + edge-tts TTS ──
python3 -m venv .venv
source .venv/bin/activate
pip install openai-whisper edge-tts

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

> ⏳ **First run:** Whisper model downloads automatically (~1.5 GB for `medium`) to `~/.cache/whisper/`. Model load takes ~5–10s on first call, then subsequent transcriptions are instant.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎤 **Hands-free voice** | Silero VAD in the browser — no push-to-talk, just speak naturally |
| 🎯 **Bengali-first** | Full Bengali UI, Whisper ASR optimized for Bengali, Microsoft Bengali neural TTS voice |
| 📷 **Camera vision** | AI can see your webcam feed and reference it in conversation |
| ⚡ **Streaming TTS** | Sentence-level streaming — audio starts playing before the LLM finishes generating |
| 🚫 **Barge-in** | Interrupt the AI mid-response by speaking (with echo suppression) |
| 🔁 **Resilient STT** | Local Whisper (GPU) with automatic cloud fallback if local fails |
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
│  │  │ Local   │   │       │  │  Provider    │  │                 │
│  │  │ Whisper │◄──┤       │  │  Factory     │  │                 │
│  │  │ (GPU)   │   │       │  │  (openrouter │  │                 │
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
Audio → [1: STT] Local Whisper (GPU/MPS) → Bengali text
                  ↳ On failure: cloud API fallback

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
├── whisper-service.js              # Low-level Whisper subprocess wrapper
├── .env                            # Configuration (git-ignored)
├── .env.example                    # Configuration template
└── package.json                    # Dependencies

src/                                # 📦 Frontend + Python scripts
├── index.html                      # Bengali UI (single-file HTML + JS)
├── whisper_transcribe.py           # Local Whisper STT engine (Bengali-optimized)
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
| Whisper STT | Generic | Bengali language forcing + hallucination rejection |

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
| `WHISPER_MODEL` | `medium` | Size: `tiny` ⎮ `base` ⎮ `small` ⎮ `medium` ⎮ `large` |
| `FALLBACK_STT_API_KEY` | `OPENROUTER_API_KEY` | Cloud fallback API key |
| `FALLBACK_STT_BASE_URL` | `https://api.openai.com/v1` | Cloud fallback endpoint |
| `STT_MAX_RETRIES` | `2` | Retry attempts on empty transcription |

### TTS Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `TTS_VOICE` | `bn-BD-NabanitaNeural` | Bengali neural voice |
| `TTS_SAMPLE_RATE` | `24000` | Output sample rate |
| `TTS_CACHE_SIZE` | `100` | Max cached sentences |

---

## 📊 Performance

Measured on **Apple M3 Pro (18 GB unified memory)** with `medium` Whisper model:

| Stage | Time | Notes |
|-------|:----:|-------|
| Whisper model load (first) | ~6–8s | Cached, subsequent calls are instant |
| Transcription (3s audio) | ~3–6s | `medium` model on Apple Silicon GPU (MPS) |
| LLM inference | ~2–4s | Depends on model and network |
| TTS generation | ~2–4s | Per 1–3 sentences |
| **End-to-end** (first turn) | **~7–14s** | Includes model load |
| **End-to-end** (subsequent) | **~5–8s** | Model already loaded |

### Whisper Model Comparison

| Model | RAM | Load | Accuracy | Use Case |
|-------|:---:|:----:|:--------:|----------|
| `tiny` | 75 MB | ~2s | Low | Testing, low-RAM |
| `base` | 150 MB | ~3s | Fair | Quick demos |
| `small` | 460 MB | ~2s | Good | Balanced |
| `medium` | 1.5 GB | ~5-8s | **Best** | **Default** |
| `large` | 3 GB | ~10s | Excellent | Max accuracy |

---

## 🔧 Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| **Server crashes (OOM)** | Whisper model too large | Set `WHISPER_MODEL=small` in `.env` |
| **Missing API key error** | OpenRouter key not configured | Get key at [openrouter.ai](https://openrouter.ai/) |
| **WebSocket won't connect** | Wrong port | Open `http://localhost:3000` (not port 8000) |
| **No audio response** | `edge-tts` not installed | `pip install edge-tts` in venv |
| **Whisper returns empty** | Synthetic audio; try real speech | Real human voice gives 90–95%+ accuracy |
| **"npm install" fails** | Wrong directory | Run from `proxy/` directory |
| **Camera not working** | Permissions not granted | Check browser site permissions |
| **Audio echo** | Speaker feedback | Use headphones |

---

## 📄 License

[Apache 2.0](LICENSE) — Original work by [fikrikarim/parlor](https://github.com/fikrikarim/parlor).

---

<p align="center">
  <sub>Built with 🟢 Node.js, 🐍 Python, and ❤️ for Bengali language technology</sub>
  <br>
  <sub>Forked from <a href="https://github.com/fikrikarim/parlor">fikrikarim/parlor</a></sub>
</p>
