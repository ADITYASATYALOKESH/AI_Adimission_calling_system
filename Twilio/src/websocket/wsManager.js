const { WebSocketServer } = require('ws');
const { handleTwilioWebSocket } = require('./twilioWsHandler');
const logger = require('../utils/logger');

let wss = null;

const wsManager = {
  /**
   * Attach a WebSocket server to an existing HTTP server.
   * Twilio will upgrade requests to /twilio-stream via WS.
   */
  attach(httpServer) {
    wss = new WebSocketServer({
      server:    httpServer,
      path:      '/twilio-stream',
      perMessageDeflate: false,    // Twilio doesn't support compression
      maxPayload: 1024 * 64,       // 64 KB max message
    });

    wss.on('connection', (ws, req) => {
      handleTwilioWebSocket(ws, req);
    });

    wss.on('error', (err) => {
      logger.error(`WSS error: ${err.message}`);
    });

    logger.server(`WebSocket server attached on /twilio-stream`);
    return wss;
  },

  stats() {
    if (!wss) return { clients: 0 };
    return { clients: wss.clients.size };
  },

  close() {
    return new Promise((resolve) => {
      if (!wss) return resolve();
      wss.close(resolve);
    });
  },
};

module.exports = wsManager;
