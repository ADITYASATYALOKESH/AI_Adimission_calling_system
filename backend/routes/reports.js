const router = require('express').Router()
const Report = require('../models/Report')
const { authenticate } = require('../middleware/auth')

// GET /api/reports — paginated list
router.get('/', authenticate, async (req, res) => {
  try {
    const { collegeId, minProbability, maxProbability, interested, page = 1, limit = 20 } = req.query
    const filter = { orgId: req.user.orgId }
    if (collegeId) filter.collegeId = collegeId
    if (minProbability || maxProbability) {
      filter.enrollmentProbability = {}
      if (minProbability) filter.enrollmentProbability.$gte = Number(minProbability)
      if (maxProbability) filter.enrollmentProbability.$lte = Number(maxProbability)
    }
    if (interested === 'true') filter['profile.courseInterested'] = { $ne: '' }

    const [reports, total] = await Promise.all([
      Report.find(filter).populate('callId', 'status duration sentiment').sort({ enrollmentProbability: -1 }).skip((page - 1) * limit).limit(Number(limit)),
      Report.countDocuments(filter),
    ])
    res.json({ reports, total, page: Number(page), pages: Math.ceil(total / limit) })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// GET /api/reports/:callId
router.get('/:callId', authenticate, async (req, res) => {
  try {
    const report = await Report.findOne({ callId: req.params.callId }).populate('callId')
    if (!report) return res.status(404).json({ message: 'Report not found' })
    res.json(report)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// GET /api/reports/export/:callId
router.get('/export/:callId', authenticate, async (req, res) => {
  try {
    const report = await Report.findOne({ callId: req.params.callId }).populate('callId')
    if (!report) return res.status(404).json({ message: 'Report not found' })
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="report-${req.params.callId}.json"`)
    res.json(report)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

module.exports = router
