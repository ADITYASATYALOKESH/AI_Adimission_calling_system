require('dotenv').config()
const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const morgan = require('morgan')
const connectDB = require('./config/db')
const errorHandler = require('./middleware/errorHandler')
const { startScheduler } = require('./services/scheduler')

const app = express()

// Connect DB, then start the cron scheduler. The scheduler relies on the
// DB connection so we kick it off only after connectDB resolves.
connectDB().then(() => startScheduler()).catch(err => console.error(err))

// Middleware
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }))
app.use(express.json({ limit: '2mb' })) // larger body — webhook transcripts can be ~100KB+
app.use(cookieParser())
app.use(morgan('dev'))

// Routes
app.use('/api/auth', require('./routes/auth'))
app.use('/api/orgs', require('./routes/orgs'))
app.use('/api/colleges', require('./routes/colleges'))
app.use('/api/calls', require('./routes/calls'))
app.use('/api/reports', require('./routes/reports'))
app.use('/api/analytics', require('./routes/analytics'))

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }))

// Error handler
app.use(errorHandler)

const PORT = process.env.PORT || 5000
app.listen(PORT, () => console.log(`AdmitAI backend running on port ${PORT}`))
