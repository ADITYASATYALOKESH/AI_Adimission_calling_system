'use strict';

const c = {
  reset:   '\x1b[0m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
};

const TAG_COLOR = {
  RAG:      c.cyan,
  OLLAMA:   c.green,
  PIPELINE: c.magenta,
  MEMORY:   c.yellow,
  TIMING:   c.blue,
  ERROR:    c.red,
  SERVER:   c.white,
};

function ts() {
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
}

function fmt(tag, msg, data) {
  const color = TAG_COLOR[tag] || c.white;
  let line = `${c.dim}[${ts()}]${c.reset} ${color}[${tag}]${c.reset} ${msg}`;
  if (data !== undefined) {
    const str = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    line += `\n${c.dim}${str}${c.reset}`;
  }
  console.log(line);
}

module.exports = {
  rag:      (msg, data) => fmt('RAG',      msg, data),
  ollama:   (msg, data) => fmt('OLLAMA',   msg, data),
  pipeline: (msg, data) => fmt('PIPELINE', msg, data),
  memory:   (msg, data) => fmt('MEMORY',   msg, data),
  timing:   (label, ms) => fmt('TIMING',   `${label}: ${ms}ms`),
  error:    (msg, data) => fmt('ERROR',    msg, data),
  server:   (msg, data) => fmt('SERVER',   msg, data),
};
