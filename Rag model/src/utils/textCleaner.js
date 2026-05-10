'use strict';

function cleanTranscript(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control chars
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanResponse(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isValidResponse(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (t.length < 3) return false;
  // Reject raw JSON error objects leaked into output
  if (t.startsWith('{') && t.includes('"error"')) return false;
  if (/^\{"error":/i.test(t)) return false;
  return true;
}

module.exports = { cleanTranscript, cleanResponse, isValidResponse };
