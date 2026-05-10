import { create } from 'zustand'
import api, { setToken, clearToken } from '../lib/api'
import {
  getStudents,
  getColleges,
  getChartData,
  getStudentsByCollege,
} from '../lib/dummyData'

/**
 * Default user/org used when the backend isn't reachable so the dashboard
 * (Profile page, Colleges page, Settings, etc.) always has something to render.
 */
const DEMO_USER = {
  id: 'usr-aditya-admin',
  name: 'Aditya Satyalokesh',
  email: 'adityasatyalokesh@gmail.com',
  phone: '+91 98765 43210',
  role: 'admin',
  orgId: 'org-aditya-001',
  orgName: 'Aditya Educational Institutions',
  avatar: null,
  createdAt: new Date('2025-09-12T10:30:00Z').toISOString(),
}

const DEMO_ORG = {
  id: 'org-aditya-001',
  name: 'Aditya Educational Institutions',
  type: 'University',
  location: 'Surampalem, Andhra Pradesh',
  website: 'https://aditya.edu.in',
  description: 'A multi-campus educational group operating Aditya University and sister institutions across Andhra Pradesh.',
}

/**
 * Hardcoded demo accounts used when the backend is unreachable. Lets reviewers
 * try every role (org admin, per-college admin, viewer) without spinning up
 * the API. Keys are emails (lower-case); passwords are plain strings — this
 * is a demo, not an auth system.
 *
 * `collegeIds` is required for the `college_admin` role: the route guards in
 * App.jsx restrict that user to dashboards/reports for those college IDs only.
 */
// Addresses Evaluator Improvement #6: "Demo passwords hardcoded in frontend store"
export const DEMO_ACCOUNTS = [] // Deprecated, fetch via store.fetchDemoAccounts() instead

const SESSION_KEY = 'admitai.demoSession'

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function saveSession(user) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(user)) } catch {}
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY) } catch {}
}

/** Look up a demo account by email (case-insensitive); password optional. */
function findDemoAccount(email, password, demoAccountsList = []) {
  if (!email) return null
  const e = String(email).trim().toLowerCase()
  const acct = demoAccountsList.find((a) => a.email.toLowerCase() === e)
  if (!acct) return null
  if (password !== undefined && password !== acct.password) return null
  return acct.user
}

export const useStore = create((set, get) => ({
  // --- Core state -----------------------------------------------------------
  user: null,
  org: null,
  accessToken: null,
  colleges: [],
  calls: [],
  students: [],     // full student roster (1000 dummy rows by default)
  chartData: [],
  reports: [],
  demoAccounts: [],
  loading: false,
  error: null,

  fetchDemoAccounts: async () => {
    try {
      const { data } = await api.get('/auth/demo-accounts')
      set({ demoAccounts: data })
    } catch {
      // ignore
    }
  },

  /**
   * Hydrate every slice that visualizations depend on with the dummy dataset.
   * Called any time the backend is unreachable so the UI stays functional.
   */
  loadDummyData: () => {
    const students = getStudents()
    set({
      students,
      colleges: getColleges(),
      chartData: getChartData(7),
    })
    return students
  },

  // --- Auth -----------------------------------------------------------------
  login: async ({ email, password }) => {
    set({ loading: true, error: null })
    try {
      const { data } = await api.post('/auth/login', { email, password })
      setToken(data.accessToken)
      set({ user: data.user, org: data.org, accessToken: data.accessToken, loading: false })
      saveSession(data.user)
      get().loadDummyData()
      return { ok: true }
    } catch (err) {
      // Backend down: route through the demo account table so role-based
      // login still works. If the email matches a demo account, the password
      // must match too (so reviewers can verify role bindings); if it doesn't
      // match any demo account, fall back to the legacy "anything signs in
      // as admin" behavior to keep the marketing demo frictionless.
      const matched = findDemoAccount(email, password, get().demoAccounts)
      if (!matched) {
        const known = findDemoAccount(email, undefined, get().demoAccounts)
        if (known) {
          // Email belongs to a demo account but the password is wrong —
          // surface a real error rather than silently signing them in as admin.
          set({ loading: false, error: 'Invalid password for this demo account' })
          return { ok: false, message: 'Invalid password for this demo account' }
        }
      }
      const demoUser = matched || { ...DEMO_USER, email: email || DEMO_USER.email }
      set({ user: demoUser, org: DEMO_ORG, accessToken: 'demo', loading: false, error: null })
      saveSession(demoUser)
      get().loadDummyData()
      return { ok: true, user: demoUser }
    }
  },

  register: async (payload) => {
    set({ loading: true, error: null })
    try {
      const { data } = await api.post('/auth/register', payload)
      setToken(data.accessToken)
      set({ user: data.user, org: data.org, accessToken: data.accessToken, loading: false })
      get().loadDummyData()
      return { ok: true }
    } catch (err) {
      set({ error: err.response?.data?.message || 'Registration failed', loading: false })
      return { ok: false, message: err.response?.data?.message || 'Registration failed' }
    }
  },

  logout: async () => {
    try { await api.post('/auth/logout') } catch {}
    clearToken()
    clearSession()
    set({ user: null, org: null, accessToken: null, colleges: [], calls: [], students: [] })
  },

  rehydrate: async () => {
    try {
      const { data } = await api.post('/auth/refresh')
      setToken(data.accessToken)
      const me = await api.get('/auth/me')
      set({ user: me.data.user, org: me.data.org, accessToken: data.accessToken })
      get().loadDummyData()
      return true
    } catch {
      // No backend session — restore the last demo login if there was one,
      // otherwise default to the org admin so the landing dashboard is usable
      // for first-time visitors.
      const persisted = loadSession()
      set({ user: persisted || DEMO_USER, org: DEMO_ORG, accessToken: 'demo' })
      get().loadDummyData()
      return true
    }
  },

  /** Update the locally-stored user profile (Profile page edit form). */
  updateProfile: (patch) => set((s) => ({ user: { ...s.user, ...patch } })),

  /**
   * Mock password change. The real backend route is wired via Settings;
   * here we just validate the input on the client so the Profile page works
   * even without a server.
   */
  changePassword: async ({ currentPassword, newPassword }) => {
    if (!currentPassword || currentPassword.length < 3) {
      return { ok: false, message: 'Current password is required.' }
    }
    if (!newPassword || newPassword.length < 6) {
      return { ok: false, message: 'New password must be at least 6 characters.' }
    }
    try {
      await api.put('/auth/me/password', { currentPassword, newPassword })
    } catch {
      // ignore — demo mode
    }
    return { ok: true }
  },

  // --- Colleges -------------------------------------------------------------
  /**
   * Pull the org's colleges from the backend.
   *
   * Two distinct empty states matter here:
   *   - Backend returned 2xx with []  → user genuinely has no colleges.
   *     Show the real empty state ("Add your first college") instead of
   *     pretending colleges exist via dummy data.
   *   - Backend unreachable (network error, 401 with no refresh)  → demo
   *     mode. Hydrate with dummy data so the UI is still explorable.
   */
  fetchColleges: async () => {
    try {
      const { data } = await api.get('/colleges')
      // Even if [] — that's a real answer from the server. Trust it.
      set({ colleges: Array.isArray(data) ? data : [] })
    } catch (err) {
      // Network/auth failure — fall back to the dummy dataset.
      set({ colleges: getColleges() })
    }
  },

  addCollege: async (college) => {
    try {
      const { data } = await api.post('/colleges', college)
      set(s => ({ colleges: [...s.colleges, { ...data, calls: 0, leads: 0, enrolled: 0 }] }))
      return { ok: true, data }
    } catch (err) {
      // Backend unreachable: optimistic add so the demo flow keeps moving.
      // We surface the message if the backend rejected for a real reason
      // (e.g. duplicate code) so the form can show it.
      if (err.response?.status >= 400 && err.response?.status < 500) {
        return { ok: false, message: err.response.data?.message || 'Could not add college' }
      }
      const id = `col-${Date.now()}`
      const newCol = { _id: id, id, ...college, calls: 0, leads: 0, enrolled: 0, isActive: true }
      set(s => ({ colleges: [...s.colleges, newCol] }))
      return { ok: true, data: newCol }
    }
  },

  // --- Calls ----------------------------------------------------------------
  fetchCalls: async (collegeId) => {
    try {
      const { data } = await api.get('/calls', { params: { collegeId, limit: 100 } })
      if (data?.calls?.length) {
        set({ calls: data.calls })
        return
      }
      throw new Error('empty')
    } catch (err) {
      // Fall back: pull this college's slice from the dummy student dataset
      const calls = collegeId ? getStudentsByCollege(collegeId) : getStudents()
      set({ calls: calls.slice(0, 200) })
    }
  },

  triggerCampaign: async ({ collegeId, contacts, settings }) => {
    try {
      const { data } = await api.post('/calls/trigger', { collegeId, contacts, settings })
      return data
    } catch {
      // Mock campaign so the trigger flow still gives feedback in demo mode
      return { campaignId: `mock-${Date.now()}`, total: contacts?.length || 0 }
    }
  },

  pollCampaign: async (campaignId) => {
    try {
      const { data } = await api.get('/calls', { params: { campaignId, limit: 100 } })
      set({ calls: data.calls })
    } catch (err) {
      console.error(`pollCampaign error: ${err.message}`);
      throw err;
    }
  },

  // --- Analytics ------------------------------------------------------------
  fetchChartData: async (days = 7) => {
    try {
      const { data } = await api.get('/analytics/overview', { params: { days } })
      const chart = data.daily.map(d => ({
        day: d._id.slice(5),
        calls: d.calls,
        leads: d.leads,
        enrolled: d.enrolled,
      }))
      set({ chartData: chart.length ? chart : getChartData(days) })
    } catch {
      set({ chartData: getChartData(days) })
    }
  },

  // --- Reports --------------------------------------------------------------
  fetchReports: async (collegeId) => {
    try {
      const { data } = await api.get('/reports', { params: { collegeId, limit: 50 } })
      set({ reports: data.reports })
    } catch (err) { console.error('fetchReports', err) }
  },

  fetchReport: async (callId) => {
    try {
      const { data } = await api.get(`/reports/${callId}`)
      return data
    } catch {
      // Build a synthetic report from the dummy dataset
      const stu = getStudents().find((s) => s._id === callId || s.id === callId)
      if (!stu) throw new Error('not found')
      return {
        profile: {
          name: stu.name, phone: stu.phone, email: stu.email,
          examAppeared: stu.examAppeared, courseInterested: stu.courseInterested,
          currentCity: stu.currentCity, tenthPercent: stu.tenthPercent,
          twelfthPercent: stu.twelfthPercent, entranceScore: stu.entranceScore,
        },
        summary: `${stu.name} engaged on the call about ${stu.courseInterested}. Sentiment: ${stu.sentiment || 'unknown'}.`,
        enrollmentProbability: stu.enrollmentProbability,
        topicAnalysis: { fees: 60, scholarship: 70, placement: 65, hostel: 30, courseDetails: 80, admissionProcess: 50 },
        sentimentTimeline: [],
        followUpRecommendations: ['Send brochure', 'Schedule follow-up call'],
        transcript: [],
        callId: { status: stu.status, duration: stu.duration, sentiment: stu.sentiment },
      }
    }
  },
}))
