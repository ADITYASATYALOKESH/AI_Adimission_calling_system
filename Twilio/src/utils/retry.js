const logger = require('./logger');

/**
 * Retry an async function with exponential backoff.
 * @param {Function} fn          - Async function to retry
 * @param {object}   opts
 * @param {number}   opts.maxAttempts   - Max total attempts (default 3)
 * @param {number}   opts.baseDelayMs   - Base delay in ms (default 200)
 * @param {number}   opts.maxDelayMs    - Max delay cap in ms (default 5000)
 * @param {string}   opts.label         - Name shown in logs
 * @param {Function} opts.shouldRetry   - (err) => bool; return false to abort early
 */
async function retry(fn, opts = {}) {
  const {
    maxAttempts = 3,
    baseDelayMs = 200,
    maxDelayMs  = 5000,
    label       = 'operation',
    shouldRetry = () => true,
  } = opts;

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !shouldRetry(err)) {
        logger.error(`${label} failed after ${attempt} attempt(s):`, err.message);
        throw err;
      }
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      logger.retry(`${label} attempt ${attempt}/${maxAttempts} failed — retrying in ${delay}ms: ${err.message}`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = { retry, sleep };
