import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Users } from 'lucide-react'
import clsx from 'clsx'
import { backend } from '../backend'
import { useUser } from '../hooks/data'
import { errorMessage, shortDate } from '../lib/format'
import type { Member, Role } from '../lib/types'
import { EmptyState, ErrorState, Modal, Notice, SkeletonRows } from '../components/ui'

const ROLES: Array<{ value: Role; label: string; help: string }> = [
  { value: 'member', label: 'Member', help: 'Can search, request parts, and post in Community.' },
  { value: 'staff', label: 'Staff', help: 'Plus: edit inventory, handle requests, moderate posts.' },
  { value: 'admin', label: 'Admin', help: 'Plus: give or remove staff and admin access.' },
]

const ROLE_STYLE: Record<Role, string> = {
  member: 'bg-label text-ink-2',
  staff: 'bg-gold-tint text-gold-dark',
  admin: 'bg-maroon-tint text-maroon-dark',
}

export function AdminPeople() {
  const { data: me } = useUser()
  const { data: members, error, isLoading, refetch } = useQuery({ queryKey: ['members'], queryFn: () => backend.listMembers() })
  const [filter, setFilter] = useState('')
  const [changing, setChanging] = useState<{ member: Member; role: Role } | null>(null)

  const list = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const rank: Record<Role, number> = { admin: 0, staff: 1, member: 2 }
    return (members ?? [])
      .filter((m) => !f || m.email.includes(f) || m.displayName.toLowerCase().includes(f))
      .sort((a, b) => rank[a.role] - rank[b.role] || a.email.localeCompare(b.email))
  }, [members, filter])

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-maroon-tint text-maroon">
          <Users className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">People</h1>
          <p className="mt-1 text-ink-2">Everyone who has signed in with a BC email. Give staff or admin access here.</p>
        </div>
      </div>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <label htmlFor="people-filter" className="sr-only">Find a person</label>
        <input id="people-filter" type="search" className="field pl-10" placeholder="Search by email or name" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonRows count={4} />
      ) : list.length === 0 ? (
        <EmptyState title={filter ? 'Nobody matches' : 'No accounts yet'}>
          {!filter && 'People appear here after they sign in once with their BC email.'}
        </EmptyState>
      ) : (
        <ul className="card divide-y divide-line">
          {list.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-tint font-bold uppercase text-gold-dark" aria-hidden>
                {(m.displayName || m.email)[0]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">
                  {m.displayName || m.email.split('@')[0]}
                  {m.id === me?.id && <span className="ml-2 text-xs font-medium text-ink-3">(you)</span>}
                </span>
                <span className="block truncate text-sm text-ink-3">{m.email} · joined {shortDate(m.createdAt)}</span>
              </span>
              <label className="sr-only" htmlFor={`role-${m.id}`}>Role for {m.email}</label>
              <select
                id={`role-${m.id}`}
                className={clsx('field !min-h-10 !w-auto !rounded-xl !border-transparent !py-1.5 font-semibold', ROLE_STYLE[m.role])}
                value={m.role}
                disabled={m.id === me?.id}
                title={m.id === me?.id ? 'You can’t change your own role' : undefined}
                onChange={(e) => setChanging({ member: m, role: e.target.value as Role })}
              >
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </li>
          ))}
        </ul>
      )}

      <dl className="mt-6 grid gap-3 sm:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r.value} className="rounded-2xl border border-line bg-surface p-4">
            <dt><span className={clsx('rounded-lg px-2 py-0.5 text-xs font-bold', ROLE_STYLE[r.value])}>{r.label}</span></dt>
            <dd className="mt-2 text-sm text-ink-2">{r.help}</dd>
          </div>
        ))}
      </dl>

      {changing && <ConfirmRole change={changing} onClose={() => setChanging(null)} />}
    </div>
  )
}

function ConfirmRole({ change, onClose }: { change: { member: Member; role: Role }; onClose: () => void }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const label = ROLES.find((r) => r.value === change.role)!
  const save = async () => {
    setBusy(true)
    setErr(null)
    try {
      await backend.setMemberRole(change.member.id, change.role)
      await qc.invalidateQueries({ queryKey: ['members'] })
      onClose()
    } catch (e) {
      setErr(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title="Change access?">
      <p className="text-ink-2">
        Make <strong className="text-ink">{change.member.email}</strong> a <strong className="text-ink">{label.label.toLowerCase()}</strong>?
      </p>
      <p className="mt-2 text-sm text-ink-3">{label.help}</p>
      {err && <div className="mt-3"><Notice tone="error">{err}</Notice></div>}
      <div className="mt-5 flex gap-2">
        <button className="btn btn-primary flex-1" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Confirm'}</button>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}
