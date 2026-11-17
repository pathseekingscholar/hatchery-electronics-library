import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useUser } from '../hooks/data'
import { SignInForm } from '../components/SignInForm'
import { Spinner } from '../components/ui'
import { Logo } from '../components/AppShell'

/** /admin: BC sign-in, then admin tools if this account has been given staff or admin access. */
export function StaffLogin() {
  const { data: user, isLoading } = useUser()
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/admin/inventory'

  if (isLoading) return <Spinner className="py-10" />
  if (user && user.role !== 'member') return <Navigate to={from} replace />

  return (
    <div className="mx-auto mt-4 max-w-md">
      <div className="card p-6 sm:p-8">
        {user ? (
          <div className="text-center">
            <ShieldAlert className="mx-auto h-10 w-10 text-gold" aria-hidden />
            <h1 className="mt-3 text-xl font-extrabold tracking-tight">No admin access yet</h1>
            <p className="mt-2 text-ink-2">
              You’re signed in as <strong className="text-ink">{user.email}</strong>, but this account isn’t staff. Ask a Hatchery admin to give you access on their People page.
            </p>
            <Link to="/" className="btn btn-secondary mt-5">Back to search</Link>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-3">
              <Logo size={44} />
              <div>
                <h1 className="text-xl font-extrabold tracking-tight">Admin sign-in</h1>
                <p className="text-sm text-ink-2">For Hatchery electronics staff. Use your BC email.</p>
              </div>
            </div>
            <SignInForm onSignedIn={(u) => u.role !== 'member' && navigate(from, { replace: true })} />
          </>
        )}
      </div>
    </div>
  )
}
