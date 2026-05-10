const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const userSchema = new mongoose.Schema({
  orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  // 'admin'         — org-wide access (super admin / org owner)
  // 'college_admin' — restricted to specific colleges via collegeIds
  // 'officer'       — read/write within the org but no admin actions
  // 'viewer'        — read-only
  role: { type: String, enum: ['admin', 'college_admin', 'officer', 'viewer'], default: 'officer' },
  collegeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'College' }],
  phone: String,
  refreshToken: { type: String, default: null },
  isActive: { type: Boolean, default: true },
}, { timestamps: true })

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash)
}

userSchema.pre('save', async function () {
  if (!this.isModified('passwordHash')) return
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12)
})

module.exports = mongoose.model('User', userSchema)
