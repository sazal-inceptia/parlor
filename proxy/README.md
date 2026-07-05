# Parlor Bengali Proxy Server

A Node.js WebSocket proxy that makes Parlor speak Bengali using free APIs:

- **STT** (Speech-to-Text): Groq Whisper API → Bengali transcription  
- **LLM** (Language Model): Google Gemini 2.0 Flash → Bengali understanding & response  
- **TTS** (Text-to-Speech): Microsoft edge-tts → Bengali speech (`bn-BD-NabanitaNeural`)

## Quick Start

### 1. Get API Keys

- **Google Gemini**: Free tier at https://aistudio.google.com/app/apikeys
- **Groq Whisper**: Free tier at https://console.groq.com/keys

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env and add your API keys:
#   GEMINI_API_KEY=<your_key>
#   GROQ_API_KEY=<your_key>
```

### 4. Run the Server

```bash
npm start
```

Server listens on `ws://localhost:3000/ws` by default.

## System Requirements

- Node.js 18+
- FFmpeg (for TTS MP3 → PCM conversion on macOS):
  ```bash
  brew install ffmpeg
  ```

## Protocol

Speaks the **exact same WebSocket protocol** as the Python backend:

### Client → Server
```json
{ "audio": "<base64_wav>", "image": "<base64_jpeg>" }
{ "type": "interrupt" }
```

### Server → Client
```json
{ "type": "text", "text": "বাংলা উত্তর", "llm_time": 2.14, "transcription": "ব্যবহারকারী যা বলেছেন" }
{ "type": "audio_start", "sample_rate": 24000, "sentence_count": 2 }
{ "type": "audio_chunk", "audio": "<base64_pcm_int16>", "index": 0 }
{ "type": "audio_end", "tts_time": 0.43 }
```

## Architecture

```
Frontend (localhost:8000)
    ↓ WebSocket
Node.js Proxy (localhost:3000)
    ├→ Groq API (whisper-large-v3, Bengali)
    ├→ Google Gemini API (gemini-2.0-flash)
    └→ Microsoft edge-tts (bn-BD-NabanitaNeural)
    ↓ WebSocket
Frontend (playback + transcript in বাংলা)
```

## Key Features

- ✅ **Bengali-native AI conversation** — All text localized
- ✅ **Real-time streaming TTS** — Sentence-by-sentence audio chunks
- ✅ **Barge-in support** — Interrupt the AI by speaking
- ✅ **Vision + audio** — Camera feed + speech input together
- ✅ **Free tier friendly** — Uses only free/cheap APIs

## Troubleshooting

| Issue | Solution |
|---|---|
| `GEMINI_API_KEY not set` | Add `GEMINI_API_KEY` to `.env` |
| `GROQ_API_KEY not set` | Add `GROQ_API_KEY` to `.env` |
| TTS hangs | Make sure FFmpeg is installed: `brew install ffmpeg` |
| WebSocket connection refused | Check proxy server is running on port 3000 |
| Bengali text garbled | Ensure terminal/browser supports UTF-8 |

## Development

Run with live reload:
```bash
npm run dev
```

## License

Apache 2.0 (same as Parlor)
