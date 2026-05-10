const router = require('express').Router()
const { v4: uuidv4 } = require('uuid')
const Call = require('../models/Call')
const Report = require('../models/Report')
const College = require('../models/College')
const { parseTranscript } = require('../services/gemini')
const { scheduleOne, dispatchOne } = require('../services/scheduler')
const { authenticate, scopeToCollege } = require('../middleware/auth')

/**
 * POST /api/calls/trigger
 * Launch a campaign — create a Call doc per contact, then either dispatch
 * immediately or hand the doc to the cron scheduler depending on settings.
 *
 * Body: { collegeId, contacts:[{phone,name}], settings:{ scheduleAt?, voice?, language?, course? } }
 */
router.post('/trigger', authenticate, scopeToCollege('body.collegeId'), async (req, res) => {
  try {
    const { collegeId, contacts, settings = {} } = req.body
    if (!collegeId || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ message: 'collegeId and contacts[] are required' })
    }

    const campaignId = uuidv4()
    const scheduledAt = settings.scheduleAt ? new Date(settings.scheduleAt) : new Date()
    const isFuture = scheduledAt.getTime() - Date.now() > 30_000

    const callDocs = contacts.map(c => ({
      collegeId,
      orgId: req.user.orgId,
      campaignId,
      phone: c.phone,
      name: c.name || 'Unknown',
      status: 'scheduled',
      scheduledAt,
    }))
    const calls = await Call.insertMany(callDocs)

    // Two paths:
    //   - Immediate (now or <30s): fire-and-forget dispatch each call. We
    //     don't await so the HTTP response stays snappy; the per-call status
    //     gets updated as the telephony provider responds (and via webhooks).
    //   - Future: register one-shot timers AND let the cron sweep be the
    //     safety net in case the process restarts before the timers fire.
    if (isFuture) {
      calls.forEach(scheduleOne)
    } else {
      const college = await College.findById(collegeId).lean()
      calls.forEach(call => { dispatchOne({ ...call.toObject(), college }) })
    }

    res.status(201).json({
      campaignId,
      total: calls.length,
      scheduledAt,
      mode: isFuture ? 'scheduled' : 'immediate',
      message: `Campaign ${campaignId} ${isFuture ? 'scheduled' : 'launched'} with ${calls.length} calls`,
    })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// GET /api/calls
router.get('/', authenticate, async (req, res) => {
  try {
    const { collegeId, campaignId, status, page = 1, limit = 50 } = req.query
    const filter = { orgId: req.user.orgId }
    if (collegeId) filter.collegeId = collegeId
    if (campaignId) filter.campaignId = campaignId
    if (status) filter.status = status

    // College admins can only see calls for the colleges they own.
    if (req.user.role === 'college_admin' && req.user.collegeIds?.length) {
      filter.collegeId = { $in: req.user.collegeIds }
    }

    const [calls, total] = await Promise.all([
      Call.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit)),
      Call.countDocuments(filter),
    ])
    res.json({ calls, total, page: Number(page), pages: Math.ceil(total / limit) })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// GET /api/calls/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const call = await Call.findById(req.params.id)
    if (!call) return res.status(404).json({ message: 'Call not found' })
    // RBAC — college admins can only fetch calls within their assigned colleges.
    if (req.user.role === 'college_admin' &&
        !req.user.collegeIds?.map(String).includes(String(call.collegeId))) {
      return res.status(403).json({ message: 'Forbidden' })
    }
    const report = await Report.findOne({ callId: call._id })
    res.json({ ...call.toObject(), report })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

/**
 * POST /api/calls/webhook
 * Public webhook — the AI calling provider posts here when a call ends.
 * We:
 *   1. Locate the matching Call doc (callId in URL/body, or phone+campaignId)
 *   2. Update status/duration/timestamps
 *   3. Hand the transcript to Gemini Flash for structured extraction
 *   4. Upsert the resulting Report
 *
 * Webhook auth: providers don't send our JWT — instead we verify a shared
 * secret header (TELEPHONY_WEBHOOK_SECRET). Skipped if no secret is set so
 * local development with curl still works.
 */
router.post('/webhook', async (req, res) => {
  try {
    if (process.env.TELEPHONY_WEBHOOK_SECRET) {
      const provided = req.headers['x-webhook-secret']
      if (provided !== process.env.TELEPHONY_WEBHOOK_SECRET) {
        return res.status(401).json({ message: 'Invalid webhook secret' })
      }
    }

    const callId = req.query.callId || req.body.callId
    const { phone, campaignId, status, duration, transcript = [], profile = {} } = req.body

    let call
    if (callId) call = await Call.findById(callId)
    else if (phone && campaignId) call = await Call.findOne({ phone, campaignId })

    // Fallback: AI-initiated call without prior scheduling (rare). Create
    // a stub so the report still has a foreign key to attach to.
    if (!call) {
      call = await Call.create({
        collegeId: req.body.collegeId,
        orgId: req.body.orgId,
        phone,
        name: profile?.name || 'Unknown',
        campaignId,
        status: 'completed',
      })
    }

    // Run Gemini extraction first so we can merge its sentiment/interested
    // fields onto the Call update in a single save.
    const reportData = await parseTranscript({ call, transcript, webhookPayload: req.body })
    const callPatch = reportData._callPatch || {}
    delete reportData._callPatch

    call.status   = status || 'completed'
    call.duration = duration || null
    call.sentiment  = callPatch.sentiment  ?? req.body.sentiment ?? null
    call.interested = callPatch.interested ?? req.body.interested ?? null
    call.startedAt  = req.body.startedAt ? new Date(req.body.startedAt) : call.startedAt
    call.endedAt    = req.body.endedAt   ? new Date(req.body.endedAt)   : new Date()
    if (reportData.profile?.name && reportData.profile.name !== 'Unknown') {
      call.name = reportData.profile.name
    }
    await call.save()

    const report = await Report.findOneAndUpdate(
      { callId: call._id },
      reportData,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )

    res.json({ message: 'Webhook processed', callId: call._id, reportId: report._id })
  } catch (err) {
    console.error('Webhook error:', err)
    res.status(500).json({ message: err.message })
  }
})

// GET /api/calls/export/csv
router.get('/export/csv', authenticate, async (req, res) => {
  try {
    const { collegeId, campaignId } = req.query
    const filter = { orgId: req.user.orgId }
    if (collegeId) filter.collegeId = collegeId
    if (campaignId) filter.campaignId = campaignId
    if (req.user.role === 'college_admin' && req.user.collegeIds?.length) {
      filter.collegeId = { $in: req.user.collegeIds }
    }

    const calls = await Call.find(filter).sort({ createdAt: -1 }).limit(5000)
    const header = 'Name,Phone,Status,Duration(s),Sentiment,Interested,Date\n'
    const rows = calls.map(c =>
      [c.name, c.phone, c.status, c.duration || '', c.sentiment || '', c.interested ?? '', c.createdAt.toISOString()].join(',')
    ).join('\n')
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename="calls-export.csv"')
    res.send(header + rows)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

module.exports = router
