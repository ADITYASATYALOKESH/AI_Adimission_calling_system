#!/usr/bin/env node
/**
 * Pre-flight health check — run before starting the server.
 * Verifies: Redis, Ollama, RAG endpoint, Sarvam API key, Twilio credentials.
 *
 * Usage: node scripts/checkHealth.js
 */
require('dotenv').config();

const http  = require('http');
const https = require('https');
const net   = require('net');

const C = {
  reset:  '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', bCyan: '\x1b[96m',
};

const ok   = (label) => console.log(`  ${C.green}✓${C.reset} ${label}`);
const fail = (label, hint = '') => {
  console.log(`  ${C.red}✗${C.reset} ${label}${hint ? C.dim + '  ← ' + hint + C.reset : ''}`);
  allOk = false;
};
const warn = (label, hint = '') =>
  console.log(`  ${C.yellow}⚠${C.reset} ${label}${hint ? C.dim + '  (' + hint + ')' + C.reset : ''}`);

let allOk = true;

function getUrl(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const parsed    = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.get(
      { hostname: parsed.hostname, port: parsed.port || (parsed.protocol==='https:'?443:80),
        path: parsed.pathname + (parsed.search || ''), timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => resolve({ ok: true, status: res.statusCode, body }));
      }
    );
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

function tcpReachable(host, port, ms = 2000) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port, timeout: ms });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error',   () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

async function checkEnvVar(key, hint = '') {
  const val = process.env[key];
  if (!val || val.startsWith('your_') || val === 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx') {
    fail(`${key} not set`, hint || 'add to .env');
  } else {
    ok(`${key} is set (${val.slice(0, 6)}…)`);
  }
}

async function main() {
  console.log(`\n${C.bold}${C.bCyan}═══ SYSTEM HEALTH CHECK ═══${C.reset}\n`);

  // ── Env vars ──────────────────────────────────────────────────────────────
  console.log(`${C.bold}Environment${C.reset}`);
  await checkEnvVar('TWILIO_ACCOUNT_SID',  'get from twilio.com/console');
  await checkEnvVar('TWILIO_AUTH_TOKEN',   'get from twilio.com/console');
  await checkEnvVar('TWILIO_PHONE_NUMBER', 'buy a number in Twilio console');
  await checkEnvVar('SARVAM_API_KEY',      'get from sarvam.ai');
  await checkEnvVar('SERVER_URL',          'use ngrok or a public URL');

  // ── Redis ─────────────────────────────────────────────────────────────────
  console.log(`\n${C.bold}Redis${C.reset}`);
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  try {
    const u = new URL(redisUrl);
    const reachable = await tcpReachable(u.hostname, u.port || 6379);
    if (reachable) ok(`Redis reachable at ${redisUrl}`);
    else warn(`Redis not reachable at ${redisUrl}`, 'system will run without persistence');
  } catch { warn('Invalid REDIS_URL', 'system will run without persistence'); }

  // ── Ollama ────────────────────────────────────────────────────────────────
  console.log(`\n${C.bold}Ollama${C.reset}`);
  const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
  const ollamaModel = process.env.OLLAMA_MODEL || 'admissionmodel';
  const ollamaRes = await getUrl(`${ollamaHost}/api/tags`);
  if (!ollamaRes.ok) {
    warn(`Ollama not reachable at ${ollamaHost}`, 'will not be available as RAG fallback');
  } else {
    ok(`Ollama is running at ${ollamaHost}`);
    try {
      const tags = JSON.parse(ollamaRes.body);
      const models = (tags.models || []).map(m => m.name);
      if (models.some(m => m.includes(ollamaModel))) {
        ok(`Model "${ollamaModel}" is available`);
      } else {
        warn(`Model "${ollamaModel}" not found`, `available: ${models.join(', ') || 'none'}`);
        warn(`Run: ollama pull ${ollamaModel}`);
      }
    } catch { warn('Could not parse Ollama model list'); }
  }

  // ── RAG endpoint ──────────────────────────────────────────────────────────
  console.log(`\n${C.bold}RAG Endpoint${C.reset}`);
  const ragEndpoint = process.env.RAG_ENDPOINT || 'http://localhost:3001/ask';
  try {
    const ragUrl  = new URL(ragEndpoint);
    const reachable = await tcpReachable(ragUrl.hostname, ragUrl.port || 80);
    if (reachable) ok(`RAG server reachable at ${ragEndpoint}`);
    else fail(`RAG server not reachable at ${ragEndpoint}`, 'start your RAG server on port 3001');
  } catch { fail('Invalid RAG_ENDPOINT in .env'); }

  // ── Sarvam API (connectivity only) ────────────────────────────────────────
  console.log(`\n${C.bold}Sarvam AI${C.reset}`);
  const sarvamReachable = await tcpReachable('api.sarvam.ai', 443);
  if (sarvamReachable) ok('api.sarvam.ai is reachable (HTTPS 443)');
  else fail('api.sarvam.ai not reachable', 'check internet connectivity');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(40)}`);
  if (allOk) {
    console.log(`${C.green}${C.bold}All checks passed.${C.reset} Start with: ${C.cyan}npm start${C.reset}\n`);
  } else {
    console.log(`${C.yellow}Some checks failed.${C.reset} Fix the issues above before starting.\n`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
