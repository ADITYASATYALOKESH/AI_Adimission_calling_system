const router = require('express').Router()
const { body, validationResult } = require('express-validator')
const bcrypt = require('bcryptjs')
const User = require('../models/User')
const Organization = require('../models/Organization')
const { signAccess, signRefresh, verifyRefresh, setRefreshCookie } = require('../utils/tokenUtils')
const { authenticate } = require('../middleware/auth')

function tokenPayload(user) {
  // collegeIds is included so RBAC checks don't need a DB round-trip per
  // request. It's a small array (a college admin owns 1-5 colleges typically).
  return {
    userId: user._id,
    orgId: user.orgId,
    role: user.role,
    collegeIds: (user.collegeIds || []).map(String),
  }
}

// POST /api/auth/register
router.post('/register',
  body('orgName').trim().notEmpty(),
  body('location').trim().notEmpty(),
  body('name').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    const { orgName, orgType, location, website, description, name, email, password, phone } = req.body
    try {
      if (await User.findOne({ email })) return res.status(409).json({ message: 'Email already registered' })

      const org = await Organization.create({ name: orgName, type: orgType, location, website, description })
      const user = await User.create({ orgId: org._id, name, email, passwordHash: password, role: 'admin', phone })

      const payload = tokenPayload(user)
      const accessToken = signAccess(payload)
      const refreshToken = signRefresh(payload)
      user.refreshToken = refreshToken
      await user.save()
      setRefreshCookie(res, refreshToken)

      res.status(201).json({ accessToken, user: { id: user._id, name: user.name, email: user.email, role: user.role }, org: { id: org._id, name: org.name } })
    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)

// POST /api/auth/login
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    try {
      const user = await User.findOne({ email: req.body.email, isActive: true })
      if (!user || !(await user.comparePassword(req.body.password))) {
        return res.status(401).json({ message: 'Invalid email or password' })
      }

      const org = await Organization.findById(user.orgId)
      const payload = tokenPayload(user)
      const accessToken = signAccess(payload)
      const refreshToken = signRefresh(payload)
      user.refreshToken = refreshToken
      await user.save()
      setRefreshCookie(res, refreshToken)

      res.json({ accessToken, user: { id: user._id, name: user.name, email: user.email, role: user.role }, org: { id: org?._id, name: org?.name } })
    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  const token = req.cookies?.refreshToken
  if (!token) return res.status(401).json({ message: 'No refresh token' })
  try {
    const decoded = verifyRefresh(token)
    const user = await User.findById(decoded.userId)
    if (!user || user.refreshToken !== token) return res.status(401).json({ message: 'Invalid refresh token' })

    const payload = tokenPayload(user)
    const accessToken = signAccess(payload)
    const newRefresh = signRefresh(payload)
    user.refreshToken = newRefresh
    await user.save()
    setRefreshCookie(res, newRefresh)
    res.json({ accessToken })
  } catch {
    res.status(401).json({ message: 'Invalid or expired refresh token' })
  }
})

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.userId, { refreshToken: null })
    res.clearCookie('refreshToken')
    res.json({ message: 'Logged out' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-passwordHash -refreshToken')
    const org = await Organization.findById(user.orgId)
    res.json({ user, org })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// PUT /api/auth/me/password
router.put('/me/password', authenticate,
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 }),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
    try {
      const user = await User.findById(req.user.userId)
      if (!(await user.comparePassword(req.body.currentPassword))) {
        return res.status(400).json({ message: 'Current password is incorrect' })
      }
      user.passwordHash = req.body.newPassword
      await user.save()
      res.json({ message: 'Password updated' })
    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)

module.exports = router
