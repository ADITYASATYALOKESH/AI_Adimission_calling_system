/**
 * Thin wrapper around the external AI calling backend.
 *
 * The actual telephony stack (Twilio + a hosted voice-agent like Vapi/Bland/
 * Retell) lives in another service. From AdmitAI's perspective it's just a
 * REST endpoint that takes a phone number + a webhook URL and starts the call.
 *
 * We keep this in its own file so swapping providers later is a one-file
 * change. All credentials come from the .env so nothing is committed.
 */
const axios = require('axios')

// Reusable axios instance — keeps connection pool warm across many calls
// in a campaign and centralises auth + base URL.
const client = axios.create({
  baseURL: process.env.TELEPHONY_API_URL,
  timeout: 15000,
  headers: {
    Authorization: `Bearer ${process.env.TELEPHONY_API_KEY}`,
    'Content-Type': 'application/json',
  },
})

/**
 * Dispatch a single call to the external AI calling provider.
 * Returns the provider's call reference id so we can correlate webhooks
 * back to the Mongo Call document if the upstream id arrives later.
 */
async function dispatchCall({ call, college, settings = {} }) {
  // Webhook URL is passed per-call so the provider knows exactly where to
  // POST the transcript. We tag callId in the URL to avoid relying on the
  // provider to echo our metadata cleanly.
  const webhookUrl = `${process.env.PUBLIC_BACKEND_URL}/api/calls/webhook?callId=${call._id}`

  // In dev / when no provider key is set we no-op and pretend the call was
  // accepted. This lets the rest of the pipeline (cron → status updates →
  // webhook processing) be exercised without external dependencies.
  if (!process.env.TELEPHONY_API_URL || !process.env.TELEPHONY_API_KEY) {
    console.warn('[telephony] No TELEPHONY_API_URL/KEY set — running in mock mode')
    return { providerCallId: `mock-${call._id}`, mock: true }
  }

  const payload = {
    to: call.phone,
    from: process.env.TELEPHONY_FROM_NUMBER,
    voice: settings.voice || 'admitbot-v3',
    language: settings.language || 'en-IN',
    metadata: {
      callId: String(call._id),
      campaignId: call.campaignId,
      collegeId: String(call.collegeId),
      collegeName: college?.name,
    },
    // First-message script template — provider substitutes student name.
    firstMessage: `Hi {{name}}, this is the admission desk from ${college?.name || 'AdmitAI'}. Do you have a minute to talk about ${settings.course || 'our programs'}?`,
    webhookUrl,
  }

  const { data } = await client.post('/calls', payload)
  return { providerCallId: data.id || data.callId, raw: data }
}

module.exports = { dispatchCall }
