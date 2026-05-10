const mongoose = require('mongoose')

const courseSchema = new mongoose.Schema({
  name: String,
  fee: Number,
  seats: Number,
  duration: String,
})

const collegeSchema = new mongoose.Schema({
  orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, uppercase: true, trim: true },
  location: { type: String, default: '' },
  courses: [courseSchema],
  isActive: { type: Boolean, default: true },
}, { timestamps: true })

module.exports = mongoose.model('College', collegeSchema)
