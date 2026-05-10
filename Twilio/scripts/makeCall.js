#!/usr/bin/env node
/**
 * Console script: trigger an outbound call.
 *
 * Usage:
 *   node scripts/makeCall.js +91XXXXXXXXXX
 *   node scripts/makeCall.js                  ← prompts for number
 */
require('dotenv').config();

const http = require('http');

const C = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  bold:   '\x1b[1m',
};

// Always POST to the local server — no ngrok needed for triggering calls
const SERVER_URL = `http://localhost:${process.env.PORT || 3000}`;

async function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const payload = JSON.stringify(body);

    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || 80,
      path:     parsed.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (d) => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (_) { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function promptNumber() {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${C.cyan}Enter phone number (E.164, e.g. +91XXXXXXXXXX): ${C.reset}`, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function main() {
  console.log(`\n${C.bold}${C.cyan}══ REALTIME AI VOICE CALLER ══${C.reset}\n`);

  let number = process.argv[2];
  if (!number) number = await promptNumber();

  if (!number.startsWith('+')) {
    console.error(`${C.red}Error: phone number must be in E.164 format (+country code)${C.reset}`);
    process.exit(1);
  }

  console.log(`${C.yellow}Initiating call to ${number}…${C.reset}`);

  try {
    const { status, body } = await postJson(`${SERVER_URL}/call/outbound`, { to: number });

    if (status === 200 && body.success) {
      console.log(`\n${C.green}✓ Call initiated!${C.reset}`);
      console.log(`  CallSid : ${body.callSid}`);
      console.log(`  Status  : ${body.status}`);
      console.log(`\nMonitor: node scripts/monitor.js`);
    } else {
      console.error(`${C.red}✗ Failed (HTTP ${status}):${C.reset}`, body);
      process.exit(1);
    }
  } catch (err) {
    console.error(`${C.red}✗ Could not reach server at ${SERVER_URL}${C.reset}`);
    console.error(`  Make sure the server is running: npm start`);
    console.error(`  Error: ${err.message}`);
    process.exit(1);
  }
}

main();
