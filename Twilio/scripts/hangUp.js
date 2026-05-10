#!/usr/bin/env node
/**
 * Console utility: hang up an active call by SID.
 *
 * Usage: node scripts/hangUp.js CA_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 */
require('dotenv').config();

const twilio = require('twilio');
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const callSid = process.argv[2];
if (!callSid) {
  console.error('Usage: node scripts/hangUp.js <CallSid>');
  process.exit(1);
}

client.calls(callSid)
  .update({ status: 'completed' })
  .then(c => console.log(`Hung up ${c.sid} — status: ${c.status}`))
  .catch(e => { console.error('Error:', e.message); process.exit(1); });
