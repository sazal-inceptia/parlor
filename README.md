# Parlor

On-device, real-time multimodal AI. Have natural voice and vision conversations with an AI that runs entirely on your machine.

Parlor uses [Gemma 4 E2B](https://huggingface.co/google/gemma-4-E2B-it) for understanding speech and vision, and [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) for text-to-speech. You talk, show your camera, and it talks back, all locally.

https://github.com/user-attachments/assets/cb0ffb2e-f84f-48e7-872c-c5f7b5c6d51f

> **Research preview.** This is an early experiment. Expect rough edges and bugs.

# Why?

I'm [self-hosting a totally free voice AI](https://www.fikrikarim.com/bule-ai-initial-release/) on my home server to help people learn speaking English. It has hundreds of monthly active users, and I've been thinking about how to keep it free while making it sustainable.

The obvious answer: run everything on-device, eliminating any server cost. Six months ago I needed an RTX 5090 to run just the voice models in real-time.

Google just released a super capable small model that I can run on my M3 Pro in real-time, with vision too! Sure you can't do agentic coding with this, but it is a game-changer for people learning a new language. Imagine a few years from now that people can run this locally on their phones. They can point their camera at objects and talk about them. And this model is multi-lingual, so people can always fallback to their native language if they want. This is essentially what OpenAI demoed a few years ago.

## How it works

```
Browser (mic + camera)
    │
    │  WebSocket (audio PCM + JPEG frames)
    ▼
FastAPI server
    ├── Gemma 4 E2B via LiteRT-LM (GPU)  →  understands speech + vision
    └── Kokoro TTS (MLX on Mac, ONNX on Linux)  →  speaks back
    │
    │  WebSocket (streamed audio chunks)
    ▼
Browser (playback + transcript)
```

- **Voice Activity Detection** in the browser ([Silero VAD](https://github.com/ricky0123/vad)). Hands-free, no push-to-talk.
- **Barge-in.** Interrupt the AI mid-sentence by speaking.
- **Sentence-level TTS streaming.** Audio starts playing before the full response is generated.

## Requirements

- Python 3.12+
- macOS with Apple Silicon, or Linux with a supported GPU
- ~3 GB free RAM for the model

## Quick start

```bash
git clone https://github.com/fikrikarim/parlor.git
cd parlor

# Install uv if you don't have it
curl -LsSf https://astral.sh/uv/install.sh | sh

cd src
uv sync
uv run server.py
```

Open [http://localhost:8000](http://localhost:8000), grant camera and microphone access, and start talking.

Models are downloaded automatically on first run (~2.6 GB for Gemma 4 E2B, plus TTS models).

## Bengali Localization

This project includes a **Bengali-language variant** powered by a Node.js proxy server that integrates free APIs for multilingual support. The UI, AI prompts, and TTS are all configured for Bengali.

### Bengali Quick Start

You'll need **two API keys** (both free tier available):

1. **Google Gemini API** — Get a free key at https://aistudio.google.com/app/apikeys
2. **Groq Whisper API** — Get a free key at https://console.groq.com/keys

Then:

```bash
# Terminal 1: Start the Python backend (serves HTML + static files)
cd src
uv run server.py
# → Listens on http://localhost:8000

# Terminal 2: Start the Node.js proxy (Bengali STT/LLM/TTS)
cd proxy
npm install
cp .env.example .env
# Edit .env with your API keys:
#   GEMINI_API_KEY=...
#   GROQ_API_KEY=...
npm start
# → Listens on ws://localhost:3000/ws
```

Open [http://localhost:8000](http://localhost:8000) and start speaking **Bengali** to the AI. It will:
- **Transcribe** your Bengali speech (Groq Whisper)
- **Understand** context from your camera (Google Gemini 2.0 Flash)
- **Respond** in Bengali with natural, conversational phrasing
- **Speak back** in Bengali (Microsoft Text-to-Speech: `bn-BD-NabanitaNeural`)

**Note:** Bengali audio TTS requires `edge-tts` (free, no API key). On macOS, also install FFmpeg to convert MP3 → PCM:
```bash
brew install ffmpeg
```

#### Bengali Architecture

```
Browser (বাংলায় কথা বলুন)
    │
    ├─ WebSocket (16kHz Bengali audio + JPEG)
    ▼
Node.js Proxy (port 3000)
    ├── Groq Whisper  → Bengali transcription
    ├── Google Gemini → Bengali understanding + response
    └── edge-tts      → Bengali audio output
    │
    ├─ WebSocket (streamed Bengali audio)
    ▼
Browser playback + Bengali transcript
```

All Bengali text is professionally translated, not robotic or literal — designed to sound natural to native speakers.

## Configuration

| Variable     | Default                        | Description                                    |
| ------------ | ------------------------------ | ---------------------------------------------- |
| `MODEL_PATH` | auto-download from HuggingFace | Path to a local `gemma-4-E2B-it.litertlm` file |
| `PORT`       | `8000`                         | Server port                                    |
| `PROXY_PORT` | `3000`                         | Node.js Bengali proxy port                     |

## Performance (Apple M3 Pro)

| Stage                            | Time          |
| -------------------------------- | ------------- |
| Speech + vision understanding    | ~1.8-2.2s     |
| Response generation (~25 tokens) | ~0.3s         |
| Text-to-speech (1-3 sentences)   | ~0.3-0.7s     |
| **Total end-to-end**             | **~2.5-3.0s** |

Decode speed: ~83 tokens/sec on GPU (Apple M3 Pro).

## Project structure

```
src/
├── server.py              # FastAPI WebSocket server + Gemma 4 inference
├── tts.py                 # Platform-aware TTS (MLX on Mac, ONNX on Linux)
├── index.html             # Frontend UI (VAD, camera, audio playback)
├── pyproject.toml         # Dependencies
└── benchmarks/
    ├── bench.py           # End-to-end WebSocket benchmark
    └── benchmark_tts.py   # TTS backend comparison
```

## Acknowledgments

- [Gemma 4](https://ai.google.dev/gemma) by Google DeepMind
- [LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM) by Google AI Edge
- [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) TTS by Hexgrad
- [Silero VAD](https://github.com/snakers4/silero-vad) for browser voice activity detection

## License

[Apache 2.0](LICENSE)
