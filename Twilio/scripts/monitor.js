#!/usr/bin/env node
/**
 * Live console dashboard — polls the LOCAL server status endpoint.
 *
 * Always connects to http://localhost:PORT directly (not through ngrok).
 * The SERVER_URL / ngrok URL is for Twilio webhooks only.
 *
 * Usage:
 *   node scripts/monitor.js           ← polls every 2s
 *   node scripts/monitor.js 5000      ← polls every 5s
 */
require('dotenv').config();

const http    = require('http');
const POLL_MS = parseInt(process.argv[2] ?? '2000', 10);
const PORT    = parseInt(process.env.PORT ?? '3000', 10);
const BASE    = `http://localhost:${PORT}`;

const C = {
  reset:    '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red:      '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue:     '\x1b[34m', cyan: '\x1b[36m',
  bGreen:   '\x1b[92m', bCyan: '\x1b[96m', bYellow: '\x1b[93m',
  clear:    '\x1b[2J', home: '\x1b[H',
};

function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: 'localhost', port: PORT, path, timeout: 4000 },
      (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (_) { reject(new Error('invalid JSON from server')); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function bar(used, total, width = 20) {
  const filled = Math.min(width, Math.round((used / (total || 1)) * width));
  return `[${'█'.repeat(filled)}${' '.repeat(width - filled)}]`;
}
function mb(b) { return (b / 1024 / 1024).toFixed(1) + 'MB'; }

function stateColor(s) {
  return ({
    IDLE:                C.dim,
    LISTENING:           C.bGreen,
    PROCESSING:          C.yellow,
    RAG_STREAMING:       `\x1b[35m`,
    SENTENCE_AGGREGATION:C.cyan,
    TTS_GENERATION:      C.blue,
    PLAYBACK:            C.bCyan,
    INTERRUPTED:         C.red,
    ERROR:               C.red,
  }[s] || '') + s + C.reset;
}

let iteration = 0;

async function render() {
  let data;
  try {
    data = await getJson('/status');
  } catch (err) {
    process.stdout.write(`${C.clear}${C.home}`);
    console.log(`\n${C.red}⚠  Cannot reach server at ${BASE}${C.reset}`);
    console.log(`   ${err.message}`);
    console.log(`\n   Make sure ${C.yellow}npm start${C.reset} is running in another terminal.`);
    return;
  }

  const { uptime, sessions, wsClients, activeCalls, memory } = data;
  const h = Math.floor(uptime / 3600);
  const m = Math.floor((uptime % 3600) / 60);
  const s = Math.floor(uptime % 60);
  const heapUsed  = memory?.heapUsed  || 0;
  const heapTotal = memory?.heapTotal || 1;

  process.stdout.write(`${C.clear}${C.home}`);
  console.log(`${C.bold}${C.bCyan}╔══════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.bCyan}║   REALTIME AI VOICE SYSTEM  ·  LIVE MONITOR      ║${C.reset}`);
  console.log(`${C.bold}${C.bCyan}╚══════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  Server  : ${C.dim}${BASE}${C.reset}`);
  console.log(`  Uptime  : ${h}h ${m}m ${s}s        Poll #${++iteration}`);
  console.log(`  Heap    : ${bar(heapUsed, heapTotal)} ${mb(heapUsed)} / ${mb(heapTotal)}`);
  console.log();
  console.log(`  ${C.bGreen}Active calls : ${sessions}${C.reset}    ${C.cyan}WS clients : ${wsClients}${C.reset}`);
  console.log();

  if (!activeCalls || activeCalls.length === 0) {
    console.log(`  ${C.dim}No active calls — waiting for incoming/outbound calls.${C.reset}`);
  } else {
    console.log(`  ${'─'.repeat(52)}`);
    for (const call of activeCalls) {
      const dur = Math.round(call.uptime / 1000);
      const min = Math.floor(dur / 60), sec = dur % 60;
      console.log(`  ${C.bold}${call.callSid}${C.reset}`);
      console.log(`    State      : ${stateColor(call.state)}`);
      console.log(`    Duration   : ${min}m ${sec}s`);
      console.log(`    Turns      : ${call.historyTurns}`);
      console.log(`    Audio queue: ${call.queuedAudio} chunks`);
      const m = call.metrics || {};
      console.log(`    Utterances : ${m.totalUtterances ?? 0}   Barge-ins: ${m.totalBargeIns ?? 0}   Errors: ${m.totalErrors ?? 0}`);
      console.log(`  ${'─'.repeat(52)}`);
    }
  }

  console.log(`\n  ${C.dim}Ctrl+C to stop.  Polling every ${POLL_MS}ms from ${BASE}.${C.reset}`);
}

console.log(`\nMonitor starting — connecting to ${BASE}  (poll: ${POLL_MS}ms)\n`);

render();
const timer = setInterval(render, POLL_MS);

process.on('SIGINT', () => {
  clearInterval(timer);
  process.stdout.write('\x1b[0m\n');
  console.log('Monitor stopped.');
  process.exit(0);
});
