const twilio = require('twilio');
const cfg = require('../config');
const logger = require('../utils/logger');

let _client = null;
function client() {
  if (!_client) {
    _client = twilio(cfg.twilio.accountSid, cfg.twilio.authToken);
  }
  return _client;
}

const { VoiceResponse } = twilio.twiml;

const twilioService = {
  /**
   * Generate TwiML that opens a bidirectional Media Stream WebSocket.
   * Twilio calls POST /voice → we return this TwiML → Twilio opens WS to /twilio-stream.
   */
  generateStreamTwiml() {
    const twiml = new VoiceResponse();
    const connect = twiml.connect();
    connect.stream({
      url:  `${cfg.server.url.replace(/^http/, 'ws')}/twilio-stream`,
      name: 'ai-voice-stream',
    });
    // Fallback pause keeps the call alive while the stream connects
    twiml.pause({ length: 60 });
    return twiml.toString();
  },

  /**
   * Initiate an outbound call to a phone number.
   * @param {string} to     - E.164 number to call
   * @param {string} [from] - Twilio number (defaults to config)
   */
  async makeCall(to, from = cfg.twilio.phoneNumber) {
    logger.call(`initiating outbound call → ${to}`);
    const call = await client().calls.create({
      to,
      from,
      url: `${cfg.server.url}/voice`,   // Twilio fetches TwiML from here
      statusCallback:      `${cfg.server.url}/call-status`,
      statusCallbackMethod:'POST',
    });
    logger.call(`call created  SID=${call.sid}  status=${call.status}`);
    return call;
  },

  /**
   * Send a "clear" event through a Media Stream to immediately stop audio playback.
   * This is the barge-in mechanism at the Twilio layer.
   * @param {object} ws        - WebSocket connected to Twilio
   * @param {string} streamSid
   */
  clearPlayback(ws, streamSid) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ event: 'clear', streamSid }));
    logger.playback(`[CLEAR] sent to Twilio stream ${streamSid}`);
  },

  /**
   * Send a mark event to track playback position.
   */
  sendMark(ws, streamSid, label) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ event: 'mark', streamSid, mark: { name: label } }));
  },

  /**
   * Hang up an active call.
   */
  async hangUp(callSid) {
    await client().calls(callSid).update({ status: 'completed' });
    logger.call(`hung up  SID=${callSid}`);
  },

  /**
   * Validate an incoming Twilio request signature.
   */
  validateSignature(url, params, signature) {
    return twilio.validateRequest(
      cfg.twilio.authToken, signature, url, params
    );
  },
};

module.exports = twilioService;
