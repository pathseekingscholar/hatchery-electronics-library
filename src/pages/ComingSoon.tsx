import { Link } from 'react-router-dom'
import { Hourglass, Search } from 'lucide-react'
import { RELEASE } from '../lib/release'

/** Shown for features that need the shared database (not part of the public catalog demo). */
export function ComingSoon({ feature }: { feature: string }) {
  return (
    <div className="card mx-auto mt-4 max-w-lg p-8 text-center">
      <Hourglass className="mx-auto h-10 w-10 text-gold" aria-hidden />
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight">{feature} — coming soon</h1>
      <p className="mt-2 text-ink-2">
        Version {RELEASE.version} is the {RELEASE.name}: search the catalog and see which zone and drawer each part is in.
        Accounts, requests and the community will arrive in a later version.
      </p>
      <Link to="/" className="btn btn-primary mt-6">
        <Search className="h-4 w-4" aria-hidden /> Search parts
      </Link>
    </div>
  )
}
