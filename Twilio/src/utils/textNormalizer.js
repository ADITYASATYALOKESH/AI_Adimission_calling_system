/**
 * Pre-TTS text normalizer for Indian admissions context.
 * Converts numbers, currency, and percentages to spoken English
 * so the TTS engine never reads digits letter-by-letter.
 */

const ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function numToWords(n) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'zero';

  const parts = [];

  if (n >= 10000000) { parts.push(numToWords(Math.floor(n / 10000000)) + ' crore'); n %= 10000000; }
  if (n >= 100000)   { parts.push(numToWords(Math.floor(n / 100000))   + ' lakh');  n %= 100000;   }
  if (n >= 1000)     { parts.push(numToWords(Math.floor(n / 1000))     + ' thousand'); n %= 1000;   }
  if (n >= 100)      { parts.push(ONES[Math.floor(n / 100)] + ' hundred'); n %= 100; }
  if (n >= 20)       { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '')); }
  else if (n > 0)    { parts.push(ONES[n]); }

  return parts.join(' ');
}

/**
 * Convert a numeric string (with or without commas) to spoken words.
 * Handles both Indian (1,00,000) and Western (1,000,000) comma styles.
 */
function numStringToWords(raw) {
  const n = parseInt(raw.replace(/,/g, ''), 10);
  return isNaN(n) ? raw : numToWords(n);
}

/**
 * Normalize text for natural speech synthesis.
 * Should be called on every sentence before sending to TTS.
 */
function normalizeForSpeech(text) {
  if (!text) return text;

  // ₹1,00,000  /  ₹ 50000  → "one lakh rupees" / "fifty thousand rupees"
  text = text.replace(/₹\s*([\d,]+)/g, (_, raw) => {
    const n = parseInt(raw.replace(/,/g, ''), 10);
    return isNaN(n) ? '₹' + raw : numToWords(n) + ' rupees';
  });

  // Numbers with commas: 1,00,000  /  1,000  /  10,00,000
  text = text.replace(/\b(\d{1,3}(?:,\d{2,3})+)\b/g, (match) => {
    const n = parseInt(match.replace(/,/g, ''), 10);
    return isNaN(n) || n < 100 ? match : numToWords(n);
  });

  // Large plain numbers 5+ digits (fees, counts) — skip 4-digit years
  text = text.replace(/\b(\d{5,})\b/g, (match) => {
    const n = parseInt(match, 10);
    return isNaN(n) ? match : numToWords(n);
  });

  // Percentages: 95.5% → "ninety five point five percent"
  text = text.replace(/(\d+)(?:\.(\d+))?%/g, (_, whole, dec) => {
    let spoken = numToWords(parseInt(whole, 10));
    if (dec) spoken += ' point ' + [...dec].map(d => ONES[+d] || 'zero').join(' ');
    return spoken + ' percent';
  });

  // Decimal amounts without currency: 1.5 lakh, 2.5 crore (already in text)
  // Leave these — they read fine as-is with enable_preprocessing

  return text.replace(/\s{2,}/g, ' ').trim();
}

module.exports = { normalizeForSpeech, numToWords };
