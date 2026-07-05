"""Parlor — real-time multimodal AI (voice + vision) using Gemini & Groq APIs."""

import asyncio
import base64
import json
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

from dotenv import load_dotenv
load_dotenv()

PROXY_URL = os.environ.get("PROXY_URL", "http://localhost:3000")
SYSTEM_PROMPT = (
    "আপনি একজন বন্ধুত্বপূর্ণ এবং কথোপকথনমূলক AI সহায়ক। ব্যবহারকারী একটি মাইক্রোফোন এবং তাদের ক্যামেরা দিয়ে আপনার সাথে কথা বলছেন। "
    "সর্বদা বাংলায় সাড়া দিন এবং যা বলেছেন তা সংক্ষিপ্ত করুন। ১-৪ বাক্যে সীমাবদ্ধ থাকুন।"
)

http_client = None


@asynccontextmanager
async def lifespan(app):
    global http_client
    http_client = httpx.AsyncClient()
    print("✅ Backend initialized (Gemini + Groq via Proxy)")
    yield
    await http_client.aclose()


app = FastAPI(lifespan=lifespan)


@app.get("/")
async def root():
    return HTMLResponse(content=(Path(__file__).parent / "index.html").read_text())


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    conversation_history = [{"role": "system", "content": SYSTEM_PROMPT}]
    
    interrupted = asyncio.Event()
    msg_queue = asyncio.Queue()

    async def receiver():
        """Receive messages from WebSocket and route them."""
        try:
            while True:
                raw = await ws.receive_text()
                msg = json.loads(raw)
                if msg.get("type") == "interrupt":
                    interrupted.set()
                    print("Client interrupted")
                else:
                    await msg_queue.put(msg)
        except WebSocketDisconnect:
            await msg_queue.put(None)

    recv_task = asyncio.create_task(receiver())

    try:
        while True:
            msg = await msg_queue.get()
            if msg is None:
                break

            interrupted.clear()

            # Prepare request for proxy
            request_payload = {
                "type": "inference",
                "audio": msg.get("audio"),
                "image": msg.get("image"),
                "text": msg.get("text", ""),
                "conversation": conversation_history,
            }

            # Call proxy API for inference
            t0 = time.time()
            try:
                response = await http_client.post(
                    f"{PROXY_URL}/api/inference",
                    json=request_payload,
                    timeout=30.0
                )
                response.raise_for_status()
                result = response.json()
                llm_time = time.time() - t0
                
                transcription = result.get("transcription", "")
                text_response = result.get("response", "")
                
                print(f"LLM ({llm_time:.2f}s) heard: {transcription!r} → {text_response}")
            except Exception as e:
                print(f"Error calling proxy: {e}")
                await ws.send_text(json.dumps({
                    "type": "error",
                    "message": f"API error: {str(e)}"
                }))
                continue

            # Add to conversation history
            user_msg = transcription if transcription else msg.get("text", "")
            conversation_history.append({"role": "user", "content": user_msg})
            conversation_history.append({"role": "assistant", "content": text_response})

            if interrupted.is_set():
                print("Interrupted after LLM, skipping response")
                continue

            reply = {"type": "text", "text": text_response, "llm_time": round(llm_time, 2)}
            if transcription:
                reply["transcription"] = transcription
            await ws.send_text(json.dumps(reply))

            if interrupted.is_set():
                print("Interrupted before TTS, skipping audio")
                continue

            # Use proxy for TTS
            tts_start = time.time()
            try:
                tts_response = await http_client.post(
                    f"{PROXY_URL}/api/tts",
                    json={"text": text_response},
                    timeout=30.0
                )
                tts_response.raise_for_status()
                tts_result = tts_response.json()
                
                # Send audio chunks from proxy
                audio_data = tts_result.get("audio", "")
                if audio_data:
                    await ws.send_text(json.dumps({
                        "type": "audio_start",
                        "sample_rate": tts_result.get("sample_rate", 24000),
                        "sentence_count": 1,
                    }))
                    
                    await ws.send_text(json.dumps({
                        "type": "audio_chunk",
                        "audio": audio_data,
                        "index": 0,
                    }))
                    
                    await ws.send_text(json.dumps({
                        "type": "audio_end",
                        "tts_time": round(time.time() - tts_start, 2),
                    }))
                    print(f"TTS ({time.time() - tts_start:.2f}s): Bengali via Proxy")
            except Exception as e:
                print(f"TTS via proxy failed: {e}, skipping audio")

    except WebSocketDisconnect:
        print("Client disconnected")
    finally:
        recv_task.cancel()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
