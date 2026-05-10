// ANSI colour codes — no external deps
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  // foregrounds
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  magenta:'\x1b[35m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
  gray:   '\x1b[90m',
  bRed:   '\x1b[91m',
  bGreen: '\x1b[92m',
  bYellow:'\x1b[93m',
  bBlue:  '\x1b[94m',
  bMagenta:'\x1b[95m',
  bCyan:  '\x1b[96m',
};

const TAG = {
  CALL:     `${C.bCyan}[CALL]${C.reset}    `,
  WS:       `${C.blue}[WS]${C.reset}      `,
  STT:      `${C.green}[STT]${C.reset}     `,
  USER:     `${C.bYellow}[USER]${C.reset}    `,
  RAG:      `${C.magenta}[RAG]${C.reset}     `,
  AI:       `${C.bCyan}[AI]${C.reset}      `,
  TTS:      `${C.bBlue}[TTS]${C.reset}     `,
  PLAYBACK: `${C.bGreen}[PLAYBACK]${C.reset}`,
  BARGE_IN: `${C.bRed}[BARGE-IN]${C.reset}`,
  STATE:    `${C.bMagenta}[STATE]${C.reset}   `,
  LATENCY:  `${C.bYellow}[LATENCY]${C.reset} `,
  SESSION:  `${C.gray}[SESSION]${C.reset} `,
  AUDIO:    `${C.white}[AUDIO]${C.reset}   `,
  VAD:      `${C.cyan}[VAD]${C.reset}     `,
  ERROR:    `${C.bRed}[ERROR]${C.reset}   `,
  WARN:     `${C.yellow}[WARN]${C.reset}    `,
  RETRY:    `${C.yellow}[RETRY]${C.reset}   `,
  REDIS:    `${C.gray}[REDIS]${C.reset}   `,
  SERVER:   `${C.bGreen}[SERVER]${C.reset}  `,
};

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const cfg = require('../config');
const activeLevel = LEVELS[cfg.log.level] ?? LEVELS.INFO;

function ts() {
  return `${C.dim}${new Date().toISOString()}${C.reset}`;
}

function emit(level, tag, ...args) {
  if (LEVELS[level] < activeLevel) return;
  const out = level === 'ERROR' ? process.stderr : process.stdout;
  const parts = args.map(a =>
    typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
  );
  out.write(`${ts()} ${tag} ${parts.join(' ')}\n`);
}

const logger = {
  call:     (...a) => emit('INFO',  TAG.CALL,     ...a),
  ws:       (...a) => emit('INFO',  TAG.WS,       ...a),
  stt:      (...a) => emit('INFO',  TAG.STT,      ...a),
  user:     (...a) => emit('INFO',  TAG.USER,     ...a),
  rag:      (...a) => emit('INFO',  TAG.RAG,      ...a),
  ai:       (...a) => emit('INFO',  TAG.AI,       ...a),
  tts:      (...a) => emit('INFO',  TAG.TTS,      ...a),
  playback: (...a) => emit('INFO',  TAG.PLAYBACK, ...a),
  bargeIn:  (...a) => emit('WARN',  TAG.BARGE_IN, ...a),
  state:    (...a) => emit('INFO',  TAG.STATE,    ...a),
  latency:  (...a) => emit('INFO',  TAG.LATENCY,  ...a),
  session:  (...a) => emit('INFO',  TAG.SESSION,  ...a),
  audio:    (...a) => emit('DEBUG', TAG.AUDIO,    ...a),
  vad:      (...a) => emit('DEBUG', TAG.VAD,      ...a),
  error:    (...a) => emit('ERROR', TAG.ERROR,    ...a),
  warn:     (...a) => emit('WARN',  TAG.WARN,     ...a),
  retry:    (...a) => emit('WARN',  TAG.RETRY,    ...a),
  redis:    (...a) => emit('DEBUG', TAG.REDIS,    ...a),
  server:   (...a) => emit('INFO',  TAG.SERVER,   ...a),

  // Direct write for banners
  raw: (msg) => process.stdout.write(msg + '\n'),

  banner() {
    this.raw(`\n${C.bCyan}${'═'.repeat(60)}${C.reset}`);
    this.raw(`${C.bold}${C.bCyan}  REALTIME AI VOICE CALLING SYSTEM${C.reset}`);
    this.raw(`${C.bCyan}${'═'.repeat(60)}${C.reset}\n`);
  },
};

module.exports = logger;
