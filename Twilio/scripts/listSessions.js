#!/usr/bin/env node
/**
 * Console script: list all active sessions from Redis + in-memory store.
 *
 * Usage: node scripts/listSessions.js
 */
require('dotenv').config();

const http  = require('http');
const https = require('https');

// Always use localhost — SERVER_URL is the ngrok/public URL for Twilio only
const SERVER_URL = `http://localhost:${process.env.PORT || 3000}`;

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  bCyan:  '\x1b[96m',
};

function getJson(url) {
  return new Promise((resolve, reject) => {
    const parsed    = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    transport.get(
      { hostname: parsed.hostname, port: parsed.port || 80, path: parsed.pathname, timeout: 5000 },
      (res) => {
        let data = '';
        res.on('data', (d) => data += d);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (_) { reject(new Error('Invalid JSON')); }
        });
      }
    ).on('error', reject);
  });
}

async function main() {
  console.log(`\n${C.bold}${C.bCyan}ACTIVE SESSIONS — ${SERVER_URL}${C.reset}\n`);

  let data;
  try {
    data = await getJson(`${SERVER_URL}/status`);
  } catch (err) {
    console.error(`${C.red}Cannot reach server: ${err.message}${C.reset}`);
    process.exit(1);
  }

  const { sessions, activeCalls, uptime, wsClients } = data;

  console.log(`  Server uptime : ${Math.round(uptime)}s`);
  console.log(`  WS clients    : ${wsClients}`);
  console.log(`  Active calls  : ${sessions}`);
  console.log();

  if (!activeCalls || activeCalls.length === 0) {
    console.log(`  ${C.dim}No active calls.${C.reset}\n`);
    return;
  }

  for (const [i, c] of activeCalls.entries()) {
    console.log(`  ${C.bold}[${i + 1}] ${c.callSid}${C.reset}`);
    console.log(`      Stream    : ${c.streamSid}`);
    console.log(`      State     : ${C.cyan}${c.state}${C.reset}`);
    console.log(`      Duration  : ${Math.round(c.uptime / 1000)}s`);
    console.log(`      Turns     : ${c.historyTurns}`);
    console.log(`      Queued    : ${c.queuedAudio} audio chunks`);
    console.log(`      Metrics   :`, JSON.stringify(c.metrics));
    console.log();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
