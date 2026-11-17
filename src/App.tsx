import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { RequireAdmin, RequireStaff } from './components/staff'
import { EmptyState } from './components/ui'
import { Home } from './pages/Home'
import { PartPage } from './pages/PartPage'
import { LocationsPage } from './pages/LocationsPage'
import { StaffLogin } from './pages/StaffLogin'
import { StaffInventory } from './pages/StaffInventory'
import { PartEditor } from './pages/PartEditor'
import { StaffRequests } from './pages/StaffRequests'
import { StaffLocations } from './pages/StaffLocations'
import { StaffImport } from './pages/StaffImport'
import { Community } from './pages/Community'
import { AdminCommunity } from './pages/AdminCommunity'
import { RequestPart } from './pages/RequestPart'
import { SignIn } from './pages/SignIn'
import { Account } from './pages/Account'
import { AdminPeople } from './pages/AdminPeople'
import { AdminReview, ReviewLocation } from './pages/AdminReview'
import { ComingSoon } from './pages/ComingSoon'
import { CATALOG_ONLY } from './lib/release'

/** Old /staff/* links from the first version keep working. */
function StaffRedirect() {
  const { pathname, search } = useLocation()
  return <Navigate to={pathname.replace(/^\/staff/, '/admin') + search} replace />
}

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/part/:id" element={<PartPage />} />
        <Route path="/locations" element={<LocationsPage />} />
        <Route path="/locations/:id" element={<LocationsPage />} />
        <Route path="/community" element={CATALOG_ONLY ? <ComingSoon feature="Community" /> : <Community />} />
        <Route path="/request" element={CATALOG_ONLY ? <ComingSoon feature="Part requests" /> : <RequestPart />} />
        <Route path="/signin" element={CATALOG_ONLY ? <ComingSoon feature="Sign-in" /> : <SignIn />} />
        <Route path="/account" element={CATALOG_ONLY ? <ComingSoon feature="Accounts" /> : <Account />} />
        <Route path="/admin" element={CATALOG_ONLY ? <ComingSoon feature="Staff tools" /> : <StaffLogin />} />
        <Route path="/admin/people" element={CATALOG_ONLY ? <ComingSoon feature="Staff tools" /> : <RequireAdmin><AdminPeople /></RequireAdmin>} />
        <Route path="/admin/review" element={CATALOG_ONLY ? <ComingSoon feature="Staff tools" /> : <RequireStaff><AdminReview /></RequireStaff>} />
        <Route path="/admin/review/:id" element={CATALOG_ONLY ? <ComingSoon feature="Staff tools" /> : <RequireStaff><ReviewLocation /></RequireStaff>} />
        <Route path="/admin/community" element={CATALOG_ONLY ? <ComingSoon feature="Staff tools" /> : <RequireStaff><AdminCommunity /></RequireStaff>} />
        <Route path="/staff/*" element={<StaffRedirect />} />
        <Route path="/staff" element={<StaffRedirect />} />
        <Route path="/admin/inventory" element={CATALOG_ONLY ? <ComingSoon feature="Staff tools" /> : <RequireStaff><StaffInventory /></RequireStaff>} />
        <Route path="/admin/parts/new" element={CATALOG_ONLY ? <ComingSoon feature="Staff tools" /> : <RequireStaff><PartEditor /></RequireStaff>} />
        <Route path="/admin/parts/:id" element={CATALOG_ONLY ? <ComingSoon feature="Staff tools" /> : <RequireStaff><PartEditor /></RequireStaff>} />
        <Route path="/admin/requests" element={CATALOG_ONLY ? <ComingSoon feature="Staff tools" /> : <RequireStaff><StaffRequests /></RequireStaff>} />
        <Route path="/admin/locations" element={CATALOG_ONLY ? <ComingSoon feature="Staff tools" /> : <RequireStaff><StaffLocations /></RequireStaff>} />
        <Route path="/admin/import" element={CATALOG_ONLY ? <ComingSoon feature="Staff tools" /> : <RequireStaff><StaffImport /></RequireStaff>} />
        <Route
          path="*"
          element={
            <EmptyState title="Page not found">
              <Link to="/" className="font-semibold text-maroon underline">Search the catalog</Link>
            </EmptyState>
          }
        />
      </Routes>
    </AppShell>
  )
}
