import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import Landing from './pages/Landing'
import CreateOrg from './pages/CreateOrg'
import Login from './pages/Login'
import OrgDashboard from './pages/OrgDashboard'
import CollegeDashboard from './pages/CollegeDashboard'
import StudentReport from './pages/StudentReport'
import Analytics from './pages/Analytics'
import Team from './pages/Team'
import Settings from './pages/Settings'
import Profile from './pages/Profile'
import Colleges from './pages/Colleges'
import CollegeDetail from './pages/CollegeDetail'
import LiveMonitoring from './pages/LiveMonitoring'
import { useStore } from './store/useStore'

/**
 * Lightweight auth guard. The store's rehydrate() always falls back to a
 * demo user so this only redirects in the rare case where logout() has
 * cleared user state explicitly.
 */
function ProtectedRoute({ children }) {
  const user = useStore((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  return children
}

/**
 * Org-scope guard. Routes that show data across the whole organisation
 * (the main dashboard, the all-colleges grid, org-wide analytics, the team
 * page, etc.) are off-limits to a college_admin — they're sandboxed to
 * their assigned college(s). We bounce them straight to that college.
 */
function OrgOnlyRoute({ children }) {
  const user = useStore((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'college_admin') {
    const homeId = user.collegeIds?.[0]
    return <Navigate to={homeId ? `/dashboard/college/${homeId}` : '/login'} replace />
  }
  return children
}

/**
 * Per-college guard. A college_admin can only open dashboards/reports for a
 * college in their `collegeIds` allowlist. Anyone else (admin/officer/viewer)
 * passes through unchanged.
 *
 * collegeIdParam lets us reuse the same guard for both the /college/:id and
 * /college/:collegeId/report/:callId routes, which use different param names.
 */
function CollegeScopedRoute({ children, collegeIdParam = 'id' }) {
  const user = useStore((s) => s.user)
  const params = useParams()
  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'college_admin') {
    const owned = (user.collegeIds || []).map(String)
    const requested = String(params[collegeIdParam] || '')
    if (!owned.includes(requested)) {
      // Send them to their own college rather than a hard 403 — keeps the
      // UX gentle if they bookmarked or pasted the wrong URL.
      const homeId = owned[0]
      return <Navigate to={homeId ? `/dashboard/college/${homeId}` : '/login'} replace />
    }
  }
  return children
}

export default function App() {
  const { user, rehydrate } = useStore()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    rehydrate().finally(() => setChecking(false))
  }, [])

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 40, height: 40, border: '3px solid #E0E9DA', borderTopColor: '#7D9B76', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ color: '#7A7A7A', fontSize: 14, fontWeight: 500 }}>Loading AdmitAI...</p>
        </div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/create-org" element={<CreateOrg />} />
        <Route path="/login" element={<Login />} />

        {/* Org-wide views — admin / officer / viewer only */}
        <Route path="/dashboard"             element={<OrgOnlyRoute><OrgDashboard /></OrgOnlyRoute>} />
        <Route path="/dashboard/colleges"    element={<OrgOnlyRoute><Colleges /></OrgOnlyRoute>} />
        <Route path="/dashboard/colleges/:id" element={<OrgOnlyRoute><CollegeDetail /></OrgOnlyRoute>} />
        <Route path="/dashboard/analytics"   element={<OrgOnlyRoute><Analytics /></OrgOnlyRoute>} />
        <Route path="/dashboard/live"        element={<OrgOnlyRoute><LiveMonitoring /></OrgOnlyRoute>} />
        <Route path="/dashboard/team"        element={<OrgOnlyRoute><Team /></OrgOnlyRoute>} />

        {/* Per-college views — college_admin restricted to their own */}
        <Route path="/dashboard/college/:id" element={
          <CollegeScopedRoute><CollegeDashboard /></CollegeScopedRoute>
        } />
        <Route path="/dashboard/college/:collegeId/report/:callId" element={
          <CollegeScopedRoute collegeIdParam="collegeId"><StudentReport /></CollegeScopedRoute>
        } />

        {/* Personal — every signed-in user */}
        <Route path="/dashboard/profile"  element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        <Route path="/dashboard/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
