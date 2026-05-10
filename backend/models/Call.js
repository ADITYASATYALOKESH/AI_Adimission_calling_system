const mongoose = require('mongoose')

const callSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
  campaignId: { type: String, index: true },
  phone: { type: String, required: true },
  name: { type: String, default: 'Unknown' },
  status: {
    type: String,
    enum: ['scheduled', 'in_progress', 'completed', 'failed', 'no_answer'],
    default: 'scheduled',
  },
  duration: { type: Number, default: null },
  sentiment: { type: String, enum: ['positive', 'neutral', 'negative', null], default: null },
  interested: { type: Boolean, default: null },
  scheduledAt: { type: Date, default: Date.now },
  startedAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },
}, { timestamps: true })

module.exports = mongoose.model('Call', callSchema)
