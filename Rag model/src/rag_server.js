'use strict';

const express = require('express');
const cors    = require('cors');
const http    = require('http');
const axios   = require('axios');
const { search, buildContext, init } = require('./rag_search');

const app = express();
app.use(cors());
app.use(express.json());

const MODEL_HOST = 'localhost';
const MODEL_PORT = 5000;
const MODEL_PATH = '/chat';
const PORT       = 3001;

// Pre-load chunks on startup
init();

function queryFineTunedModel(prompt) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify({ message: prompt });
    const options = {
      hostname: MODEL_HOST,
      port:     MODEL_PORT,
      path:     MODEL_PATH,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const reply  =
            parsed.response ||
            parsed.reply    ||
            parsed.answer   ||
            parsed.message  ||
            parsed.text     ||
            data;
          resolve(reply);
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', model: `http://${MODEL_HOST}:${MODEL_PORT}${MODEL_PATH}` });
});

// Main RAG endpoint
app.post('/ask', async (req, res) => {
  try {
    const userMessage = req.body.message || req.body.question;

    if (!userMessage) {
      return res.status(400).json({ error: 'Message required' });
    }

    // STEP 1: Retrieve relevant chunks
    const results = search(userMessage, 3);
    const context = buildContext(results);

    console.log('CONTEXT:\n', context);

    // STEP 2: Build strict RAG prompt
    const prompt = `You are a precise admission counselor. Answer using ONLY the exact data from the context below.

STRICT RULES:
- Copy numbers, fees, and values EXACTLY as they appear in the context (e.g., ₹2,75,000 per year)
- NEVER use placeholders like [Annual Fee], [amount], [value], or [fee]
- NEVER say "check brochure", "contact us", or add disclaimers
- NEVER add information not present in the context
- DO NOT include website links or notes
- Answer in 1-2 short sentences only

Context:
${context}

Question: ${userMessage}

Answer (use exact figures from context):`;

    // STEP 3: Flush SSE headers immediately so browser knows connection is alive
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();

    // STEP 4: Call Ollama
    let ollamaResponse;
    try {
      ollamaResponse = await axios.post(
        'http://localhost:11434/api/chat',
        {
          model:    'admissionmodel',
          messages: [
            {
              role:    'system',
              content: 'You are a factual admission assistant. You MUST use the exact fee amounts and data from the user\'s context. Never substitute real values with placeholders like [Annual Fee] or [amount]. If the context says ₹2,75,000, output ₹2,75,000 exactly.',
            },
            { role: 'user', content: prompt },
          ],
          stream:  true,
          options: { temperature: 0 },
        },
        { responseType: 'stream' }
      );
    } catch (err) {
      console.error('Ollama connection error:', err.message);
      res.write('data: [ERROR] Model unavailable\n\n');
      res.end();
      return;
    }

    // STEP 5: Pipe Ollama stream to client
    ollamaResponse.data.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          const token  = parsed.message?.content || parsed.response || '';
          if (token) res.write(`data: ${token}\n\n`);
          if (parsed.done) {
            res.write('data: [DONE]\n\n');
            res.end();
          }
        } catch (err) {
          console.error('Stream parse error:', err.message);
        }
      }
    });

    ollamaResponse.data.on('end', () => res.end());

    ollamaResponse.data.on('error', (err) => {
      console.error('Stream error:', err.message);
      res.write('data: [ERROR] Stream failed\n\n');
      res.end();
    });

  } catch (error) {
    console.error('FULL ERROR:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to get answer', details: error.message });
    } else {
      res.write('data: [ERROR] Server error\n\n');
      res.end();
    }
  }
});

app.listen(PORT, () => {
  console.log(`[RAG Server] Running on http://localhost:${PORT}`);
  console.log(`[RAG Server] Fine-tuned model: http://${MODEL_HOST}:${MODEL_PORT}${MODEL_PATH}`);
});
