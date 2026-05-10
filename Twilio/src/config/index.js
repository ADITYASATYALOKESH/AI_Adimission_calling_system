require('dotenv').config();

const required = (key) => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
};

const optional = (key, def) => process.env[key] ?? def;

module.exports = {
  server: {
    port: parseInt(optional('PORT', '3000'), 10),
    url: optional('SERVER_URL', 'http://localhost:3000'),
    nodeEnv: optional('NODE_ENV', 'development'),
  },

  twilio: {
    accountSid: required('TWILIO_ACCOUNT_SID'),
    authToken: required('TWILIO_AUTH_TOKEN'),
    phoneNumber: required('TWILIO_PHONE_NUMBER'),
  },

  sarvam: {
    apiKey: optional('SARVAM_API_KEY', ''),
    stt: {
      model: optional('SARVAM_STT_MODEL', 'saarika:v2.5'),
      language: optional('SARVAM_STT_LANGUAGE', 'en-IN'),
      endpoint: 'https://api.sarvam.ai/speech-to-text',
    },
    tts: {
      speaker: optional('SARVAM_TTS_SPEAKER', 'anushka'),
      language: optional('SARVAM_TTS_LANGUAGE', 'en-IN'),
      model: optional('SARVAM_TTS_MODEL', 'bulbul:v2'),
      sampleRate: parseInt(optional('SARVAM_TTS_SAMPLE_RATE', '8000'), 10),
      endpoint: 'https://api.sarvam.ai/text-to-speech',
    },
  },

  rag: {
    endpoint: optional('RAG_ENDPOINT', 'http://localhost:3001/ask'),
    timeoutMs: 30000,
  },

  ollama: {
    host: optional('OLLAMA_HOST', 'http://localhost:11434'),
    model: optional('OLLAMA_MODEL', 'admissionmodel'),
    timeoutMs: 30000,
  },

  redis: {
    url: optional('REDIS_URL', 'redis://localhost:6379'),
    ttlSeconds: parseInt(optional('REDIS_TTL_SECONDS', '3600'), 10),
  },

  vad: {
    silenceEnergyThreshold: parseInt(optional('SILENCE_ENERGY_THRESHOLD', '200'), 10),
    silenceChunkCount: parseInt(optional('SILENCE_CHUNK_COUNT', '75'), 10),
    minSpeechChunks: parseInt(optional('MIN_SPEECH_CHUNKS', '15'), 10),
  },

  sentence: {
    minWordsForTts: parseInt(optional('MIN_WORDS_FOR_TTS', '8'), 10),
    maxSentenceChars: parseInt(optional('MAX_SENTENCE_CHARS', '300'), 10),
  },

  latency: {
    targetSttMs: parseInt(optional('TARGET_STT_MS', '500'), 10),
    targetRagFirstTokenMs: parseInt(optional('TARGET_RAG_FIRST_TOKEN_MS', '500'), 10),
    targetSentenceDetectMs: parseInt(optional('TARGET_SENTENCE_DETECT_MS', '300'), 10),
    targetTtsMs: parseInt(optional('TARGET_TTS_MS', '800'), 10),
    targetBargeInMs: parseInt(optional('TARGET_BARGE_IN_MS', '150'), 10),
  },

  log: {
    level: optional('LOG_LEVEL', 'INFO'),
  },
};
