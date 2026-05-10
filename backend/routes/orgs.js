const router = require('express').Router()
const bcrypt = require('bcryptjs')
const Organization = require('../models/Organization')
const User = require('../models/User')
const { authenticate, requireRole } = require('../middleware/auth')

// GET /api/orgs/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const org = await Organization.findById(req.params.id)
    if (!org) return res.status(404).json({ message: 'Organisation not found' })
    res.json(org)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// PUT /api/orgs/:id
router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const org = await Organization.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
    res.json(org)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// GET /api/orgs/:id/users
router.get('/:id/users', authenticate, async (req, res) => {
  try {
    const users = await User.find({ orgId: req.params.id, isActive: true }).select('-passwordHash -refreshToken')
    res.json(users)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// POST /api/orgs/:id/users
router.post('/:id/users', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, email, role, phone, password } = req.body
    if (await User.findOne({ email })) return res.status(409).json({ message: 'Email already exists' })
    const user = await User.create({ orgId: req.params.id, name, email, passwordHash: password || 'changeme123', role: role || 'viewer', phone })
    res.status(201).json({ id: user._id, name: user.name, email: user.email, role: user.role })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// PUT /api/orgs/:id/users/:userId
router.put('/:id/users/:userId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.userId, { role: req.body.role, isActive: req.body.isActive }, { new: true }).select('-passwordHash -refreshToken')
    res.json(user)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// DELETE /api/orgs/:id/users/:userId
router.delete('/:id/users/:userId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.userId, { isActive: false })
    res.json({ message: 'User removed' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

module.exports = router
