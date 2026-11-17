import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useUser } from '../hooks/data'
import { SignInForm } from '../components/SignInForm'
import { Spinner } from '../components/ui'
import { Logo } from '../components/AppShell'

/** Only allow in-app redirects after sign-in. */
export function safeNext(next: string | null, fallback: string) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback
}

export function SignIn() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'), '/community')
  const { data: user, isLoading } = useUser()
  const navigate = useNavigate()
  if (isLoading) return <Spinner className="py-10" />
  if (user) return <Navigate to={next} replace />
  return (
    <div className="mx-auto mt-4 max-w-md">
      <div className="card p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <Logo size={44} />
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">Sign in with your BC email</h1>
            <p className="text-sm text-ink-2">Needed to post in Community. Searching never needs an account.</p>
          </div>
        </div>
        <SignInForm onSignedIn={() => navigate(next, { replace: true })} />
      </div>
      <p className="mt-4 text-center text-sm text-ink-3">
        Just looking for a part? <Link to="/" className="font-semibold text-maroon hover:underline">Search without signing in</Link>
      </p>
    </div>
  )
}
