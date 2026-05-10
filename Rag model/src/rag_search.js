'use strict';

const fs   = require('fs');
const path = require('path');

const CHUNKS_DIR = path.join(__dirname, '..', 'chunks');

function loadAllChunks() {
  const allChunks = [];
  const files = fs.readdirSync(CHUNKS_DIR).filter(f => f.endsWith('_chunks.json'));
  for (const file of files) {
    const chunks = JSON.parse(fs.readFileSync(path.join(CHUNKS_DIR, file), 'utf-8'));
    chunks.forEach(chunk => allChunks.push(chunk));
  }
  return allChunks;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function computeTF(tokens) {
  const tf    = {};
  const total = tokens.length || 1;
  for (const token of tokens) tf[token] = (tf[token] || 0) + 1;
  for (const token in tf) tf[token] /= total;
  return tf;
}

function computeIDF(chunks) {
  const docCount = chunks.length;
  const df       = {};
  for (const chunk of chunks) {
    const tokens = new Set(tokenize(chunk.text || chunk.content || ''));
    for (const token of tokens) df[token] = (df[token] || 0) + 1;
  }
  const idf = {};
  for (const token in df) {
    idf[token] = Math.log((docCount + 1) / (df[token] + 1)) + 1;
  }
  return idf;
}

function tfidfVector(tokens, idf) {
  const tf  = computeTF(tokens);
  const vec = {};
  for (const token in tf) {
    vec[token] = tf[token] * (idf[token] || Math.log(2));
  }
  return vec;
}

function cosineSimilarity(vecA, vecB) {
  let dot = 0, magA = 0, magB = 0;
  for (const key in vecA) {
    dot  += (vecA[key] || 0) * (vecB[key] || 0);
    magA += vecA[key] ** 2;
  }
  for (const key in vecB) magB += vecB[key] ** 2;
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

let _chunks    = null;
let _idf       = null;
let _chunkVecs = null;

function init() {
  if (_chunks) return;
  _chunks    = loadAllChunks();
  _idf       = computeIDF(_chunks);
  _chunkVecs = _chunks.map(chunk => {
    const tokens = tokenize(chunk.text || chunk.content || '');
    return tfidfVector(tokens, _idf);
  });
  console.log(`[RAG] Loaded ${_chunks.length} chunks from ${CHUNKS_DIR}`);
}

function search(query, topK = 5) {
  init();
  const queryTokens = tokenize(query);
  const queryVec    = tfidfVector(queryTokens, _idf);

  const scored = _chunks.map((chunk, i) => ({
    chunk,
    score: cosineSimilarity(queryVec, _chunkVecs[i]),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).filter(r => r.score > 0);
}

function buildContext(results) {
  if (results.length === 0) return 'No relevant information found.';
  return results
    .map((r, i) => {
      const text     = r.chunk.text || r.chunk.content || '';
      const category = r.chunk.category || r.chunk.metadata?.category || '';
      return `[Source ${i + 1} | ${category}]\n${text.trim()}`;
    })
    .join('\n\n---\n\n');
}

module.exports = { search, buildContext, init };
