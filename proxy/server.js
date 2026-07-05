/**
 * Parlor Bengali Proxy Server
 * 
 * WebSocket server that speaks the same protocol as the Python backend,
 * but integrates with free-tier APIs: Groq Whisper (STT), Groq Llama (LLM), Microsoft edge-tts (TTS).
 */

require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { Groq } = require('groq-sdk');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── Configuration ───
const PORT = process.env.PROXY_PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
  console.warn('⚠️  GROQ_API_KEY not set. Set it in .env');
}

// ─── Initialize API clients ───
const groqClient = new Groq({ apiKey: GROQ_API_KEY });

// ─── Express app + WebSocket ───
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb' }));

// Serve static files (fallback to Python server in production)
app.get('/', (req, res) => {
  res.send('<h1>Parlor Proxy Server</h1><p>WebSocket endpoint ready at ws://localhost:' + PORT + '/ws</p>');
});

// ─── REST API: Inference (audio/image processing + LLM response) ───
app.post('/api/inference', async (req, res) => {
  try {
    const { audio, image, text, conversation } = req.body;
    
    let transcription = '';
    let userMessage = text;
    
    // Step 1: Transcribe audio if provided
    if (audio) {
      try {
        const audioBuffer = Buffer.from(audio, 'base64');
        const tempAudioPath = path.join(os.tmpdir(), `audio_${Date.now()}.wav`);
        fs.writeFileSync(tempAudioPath, audioBuffer);
        
        // Use Groq for transcription
        const transcriptionResp = await groqClient.audio.transcriptions.create({
          file: fs.createReadStream(tempAudioPath),
          model: 'whisper-large-v3-turbo',
          language: 'bn',
        });
        
        transcription = transcriptionResp.text;
        userMessage = transcription;
        fs.unlinkSync(tempAudioPath);
        console.log(`[Groq STT] ${transcription}`);
      } catch (err) {
        console.error('[Groq STT] Error:', err.message);
        transcription = '[Error transcribing audio]';
      }
    }
    
    // Step 2: Get AI response from Groq Llama
    let aiResponse = '';
    try {
      // Format conversation history for Groq
      const messages = (conversation || []).map(msg => ({
        role: msg.role,
        content: msg.content,
      }));
      
      messages.push({
        role: 'user',
        content: userMessage,
      });
      
      const response = await groqClient.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: messages,
        temperature: 0.7,
        max_tokens: 500,
      });
      
      aiResponse = response.choices[0]?.message?.content || 'কোন প্রতিক্রিয়া পাওয়া যায়নি।';
      console.log(`[Groq LLM] Response: ${aiResponse.substring(0, 100)}...`);
    } catch (err) {
      console.error('[Groq LLM] Error:', err.message);
      aiResponse = 'দুঃখিত, একটি ত্রুটি ঘটেছে।';
    }
    
    res.json({
      transcription,
      response: aiResponse,
      status: 'ok'
    });
  } catch (err) {
    console.error('[API] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── REST API: TTS (Bengali text-to-speech) ───
app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    const audioBuffer = await generateBengaliAudio(text);
    
    res.json({
      audio: audioBuffer.toString('base64'),
      sample_rate: 24000,
      status: 'ok'
    });
  } catch (err) {
    console.error('[TTS API] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── WebSocket Handler ───
wss.on('connection', (ws, req) => {
  console.log(`[Client] Connected from ${req.socket.remoteAddress}`);
  
  // Per-connection state
  let toolResult = {};
  let conversationHistory = [
    {
      role: 'system',
      content: 'আপনি একজন বন্ধুত্বপূর্ণ এবং কথোপকথনমূলক AI সহায়ক। সর্বদা বাংলায় সাড়া দিন এবং ১-৪ বাক্যে সীমাবদ্ধ থাকুন।'
    }
  ];

  ws.on('message', async (rawData) => {
    try {
      const msg = JSON.parse(rawData);

      if (msg.type === 'interrupt') {
        console.log('[Client] Interrupt signal received');
        return;
      }

      // User sent audio/image
      if (msg.audio || msg.image) {
        console.log(`[Server] Received: audio=${!!msg.audio}, image=${!!msg.image}`);

        // ─── Step 1: Transcribe audio (Groq Whisper) ───
        let transcription = '';
        if (msg.audio) {
          console.log('[STT] Calling Groq Whisper...');
          try {
            transcription = await transcribeAudio(msg.audio);
            console.log(`[STT] Result: "${transcription}"`);
          } catch (err) {
            console.error('[STT] Error:', err.message);
            transcription = '[অডিও বোঝা যায়নি]';
          }
        }

        // ─── Step 2: Process with LLM (Groq Llama) ───
        console.log('[LLM] Processing with Groq Llama...');
        const llmStartTime = Date.now();

        try {
          let aiResponse = '';
          
          // Add transcription to conversation history
          if (transcription) {
            conversationHistory.push({
              role: 'user',
              content: transcription
            });
          }
          
          // Call Groq Llama
          const response = await groqClient.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: conversationHistory,
            temperature: 0.7,
            max_tokens: 500,
          });
          
          aiResponse = response.choices[0]?.message?.content || 'কোন প্রতিক্রিয়া পাওয়া যায়নি।';
          conversationHistory.push({
            role: 'assistant',
            content: aiResponse
          });

          const llmTime = ((Date.now() - llmStartTime) / 1000).toFixed(2);
          console.log(`[LLM] Completed in ${llmTime}s`);

          // Extract response
          const finalTranscription = transcription;

          // ─── Step 3: Send text response to client ───
          const textMsg = {
            type: 'text',
            text: aiResponse,
            llm_time: parseFloat(llmTime),
          };
          if (finalTranscription) {
            textMsg.transcription = finalTranscription;
          }
          ws.send(JSON.stringify(textMsg));
          console.log(`[WebSocket] Sent text response`);

          // ─── Step 4: Generate TTS and stream ───
          await streamTTS(ws, aiResponse);

        } catch (err) {
          console.error('[LLM] Error:', err.message);
          ws.send(JSON.stringify({
            type: 'text',
            text: 'দুঃখিত, একটি ত্রুটি ঘটেছে।',
            llm_time: ((Date.now() - llmStartTime) / 1000).toFixed(2)
          }));
        }
      }

    } catch (err) {
      console.error('[WebSocket] Message parse error:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('[Client] Disconnected');
  });

  ws.on('error', (err) => {
    console.error('[WebSocket] Error:', err.message);
  });
});

// ─── STT: Transcribe audio using Groq Whisper ───
async function transcribeAudio(base64Audio) {
  // Decode base64 → WAV buffer
  const audioBuffer = Buffer.from(base64Audio, 'base64');
  
  // Create a temporary file
  const tempPath = path.join(os.tmpdir(), `audio_${Date.now()}.wav`);
  fs.writeFileSync(tempPath, audioBuffer);

  try {
    const transcription = await groqClient.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: 'whisper-large-v3',
      language: 'bn',
      response_format: 'json'
    });
    return transcription.text || '';
  } finally {
    try { fs.unlinkSync(tempPath); } catch {}
  }
}

// ─── TTS: Generate Bengali audio using edge-tts (Python CLI) ───
async function generateBengaliAudio(text) {
  const tempDir = os.tmpdir();
  const outputPath = path.join(tempDir, `tts_${Date.now()}.mp3`);

  try {
    // Use edge-tts command line (requires: pip install edge-tts)
    // Command: edge-tts --text "বাংলা পাঠ্য" --voice bn-BD-NabanitaNeural --write-media output.mp3
    
    // Escape quotes in text
    const escapedText = text.replace(/"/g, '\\"').replace(/\$/g, '\\$');
    const command = `edge-tts --text "${escapedText}" --voice bn-BD-NabanitaNeural --write-media "${outputPath}" 2>/dev/null`;
    
    try {
      execSync(command, { encoding: 'utf8', timeout: 15000 });
    } catch (err) {
      console.warn('[TTS] edge-tts CLI failed. Make sure to install: pip install edge-tts');
      console.warn('[TTS] Error:', err.message);
      // Return silence as fallback
      return generateMockAudio(text);
    }

    // Check if file was created
    if (!fs.existsSync(outputPath)) {
      console.warn('[TTS] Output file not created');
      return generateMockAudio(text);
    }

    // Read the generated MP3
    const audioBuffer = fs.readFileSync(outputPath);
    
    // Return as base64 (browser will handle MP3 decoding, or we can transcode with ffmpeg)
    return audioBuffer.toString('base64');
  } catch (err) {
    console.error('[TTS] Error generating audio:', err.message);
    return generateMockAudio(text);
  } finally {
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
  }
}

// ─── Helper: Generate mock audio for fallback ───
function generateMockAudio(text) {
  // Create a minimal PCM buffer (int16, mono, 24kHz)
  // For demo: just silence with duration proportional to text length
  const estimatedDuration = Math.max(0.5, text.length / 15); // ~15 chars per second
  const sampleCount = 24000 * estimatedDuration;
  const pcm = Buffer.alloc(sampleCount * 2);
  pcm.fill(0); // Silence
  return pcm.toString('base64');
}

// ─── TTS: Stream Bengali audio chunks ───
async function streamTTS(ws, text) {
  const sentences = splitSentences(text);

  ws.send(JSON.stringify({
    type: 'audio_start',
    sample_rate: 24000,
    sentence_count: sentences.length
  }));

  const ttsStartTime = Date.now();

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    if (!sentence.trim()) continue;

    console.log(`[TTS] Generating sentence ${i + 1}/${sentences.length}: "${sentence.substring(0, 50)}..."`);

    try {
      // Generate audio for this sentence
      const audioBase64 = await generateBengaliAudio(sentence);
      
      ws.send(JSON.stringify({
        type: 'audio_chunk',
        audio: audioBase64,
        index: i
      }));
    } catch (err) {
      console.error(`[TTS] Error generating sentence ${i + 1}:`, err.message);
    }
  }

  const ttsTime = ((Date.now() - ttsStartTime) / 1000).toFixed(2);
  ws.send(JSON.stringify({
    type: 'audio_end',
    tts_time: parseFloat(ttsTime)
  }));

  console.log(`[TTS] Completed in ${ttsTime}s`);
}

// ─── Helper: Split Bengali text into sentences ───
function splitSentences(text) {
  // Bengali sentence delimiters: দণ্ড (।), দ্বিদণ্ড (॥), and English punctuation
  const regex = /(?<=[।॥!?])\s+/;
  return text.split(regex).filter(s => s.trim());
}

// ─── Start server ───
server.listen(PORT, () => {
  console.log(`\n🎙️  Parlor Bengali Proxy Server`);
  console.log(`📡 WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`✅ Ready to accept connections\n`);
});
