"""
Parlor — redirect server.

Redirects visitors to the Node.js proxy on port 3000, which serves the
actual app (HTML + WebSocket for STT/LLM/TTS).

Usage:
    cd proxy && npm start
    Open http://localhost:3000
"""

import os

from fastapi import FastAPI
from fastapi.responses import RedirectResponse

PROXY_PORT = int(os.environ.get("PROXY_PORT", "3000"))
REDIRECT_URL = f"http://localhost:{PROXY_PORT}"

app = FastAPI()


@app.get("/")
async def root():
    return RedirectResponse(url=REDIRECT_URL)


@app.get("/{path:path}")
async def catch_all(path: str):
    return RedirectResponse(url=f"{REDIRECT_URL}/{path}")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8000"))
    print(f"🔄 Python server at http://0.0.0.0:{port} → redirecting to {REDIRECT_URL}")
    uvicorn.run(app, host="0.0.0.0", port=port)
