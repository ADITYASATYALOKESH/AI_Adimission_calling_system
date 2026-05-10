'use strict';

const { fetchRAGContext }                        = require('./ragClient');
const { streamOllamaResponse, SYSTEM_PROMPT }    = require('./ollamaClient');
const { SentenceAggregator }                     = require('./aggregator');
const { MemoryManager }                          = require('../memory/sessionMemory');
const { cleanTranscript, cleanResponse, isValidResponse } = require('../utils/textCleaner');
const logger                                     = require('../utils/logger');

const memoryManager = new MemoryManager();

/**
 * Main pipeline orchestrator.
 * Async generator — yields pipeline events:
 *   { type: 'token',  text: string }   — a finalized sentence ready to stream
 *   { type: 'error',  text: string }   — a human-readable error
 *   { type: 'done',   sessionId }      — stream complete
 *
 * @param {string}      userMessage
 * @param {string}      sessionId
 * @param {AbortSignal} signal
 */
async function* runPipeline(userMessage, sessionId, signal) {
  const t0 = Date.now();
  logger.pipeline('▶ start', { sessionId, message: userMessage });

  // ── 1. Sanitise input ─────────────────────────────────────────────────────
  const cleaned = cleanTranscript(userMessage);
  if (!cleaned) {
    yield { type: 'error', text: 'Empty message received.' };
    return;
  }

  // ── 2. RAG retrieval ──────────────────────────────────────────────────────
  logger.pipeline('fetching RAG context…');
  const ragCtx = await fetchRAGContext(cleaned, signal);
  if (signal?.aborted) return;

  // ── 3. Build conversation messages ────────────────────────────────────────
  const session = memoryManager.getSession(sessionId);
  const history = session.getHistory();

  logger.memory('injecting context', {
    sessionId,
    historyMsgs:   history.length,
    historyTokens: session.estimatedTokens(),
    ragLength:     ragCtx.length,
  });

  const systemContent = ragCtx
    ? `${SYSTEM_PROMPT}\n\n--- Knowledge Base Context ---\n${ragCtx}\n---`
    : SYSTEM_PROMPT;

  const messages = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user',   content: cleaned },
  ];

  logger.ollama('payload', {
    model:       'admissionmodel',
    totalMsgs:   messages.length,
    tokensEst:   Math.ceil(messages.reduce((s, m) => s + m.content.length, 0) / 4),
  });

  // ── 4. Stream Ollama + sentence aggregation ───────────────────────────────
  const agg          = new SentenceAggregator();
  let   fullResponse = '';
  let   firstToken   = true;
  let   sentIdx      = 0;
  const ollamaStart  = Date.now();

  try {
    for await (const { token, done } of streamOllamaResponse(messages, signal)) {
      if (signal?.aborted) return;
      if (done) break;
      if (!token) continue;

      if (firstToken) {
        logger.timing('Ollama first token', Date.now() - ollamaStart);
        firstToken = false;
      }

      fullResponse += token;

      // Sentence-boundary aggregation
      for (const sentence of agg.feed(token)) {
        const clean = cleanResponse(sentence);
        if (isValidResponse(clean)) {
          sentIdx++;
          logger.pipeline(`sentence finalized [${sentIdx}]:`, clean);
          yield { type: 'token', text: clean + ' ' };
        }
      }
    }

    // Flush aggregator remainder
    for (const sentence of agg.flush()) {
      const clean = cleanResponse(sentence);
      if (isValidResponse(clean)) {
        yield { type: 'token', text: clean };
      }
    }

    // ── 5. Validate ───────────────────────────────────────────────────────
    const finalText = cleanResponse(fullResponse);
    if (!isValidResponse(finalText)) {
      logger.error('Response validation failed — sending fallback');
      yield { type: 'error', text: 'Sorry, I could not process your request. Please try again.' };
      return;
    }

    // ── 6. Update memory ──────────────────────────────────────────────────
    session.push('user',      cleaned);
    session.push('assistant', finalText);

    logger.pipeline('▶ final response:', finalText);
    logger.timing('total pipeline',    Date.now() - t0);
    logger.memory('updated', {
      messages: session.messages.length,
      tokens:   session.estimatedTokens(),
    });

    yield { type: 'done', sessionId };

  } catch (err) {
    const cancelled = err.code === 'ERR_CANCELED' || err.name === 'CanceledError';
    if (cancelled || signal?.aborted) {
      logger.pipeline('pipeline cancelled by client');
      return;
    }
    logger.error('pipeline error:', err.message);
    yield { type: 'error', text: 'Sorry, I encountered an error. Please try again.' };
  }
}

module.exports = { runPipeline, memoryManager };
