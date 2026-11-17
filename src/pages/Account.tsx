import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { LogOut } from 'lucide-react'
import { backend } from '../backend'
import { useUser } from '../hooks/data'
import { errorMessage } from '../lib/format'
import { Notice, Spinner } from '../components/ui'

const ROLE_LABEL = { member: 'Member', staff: 'Staff', admin: 'Admin' } as const

export function Account() {
  const { data: user, isLoading } = useUser()
  const [name, setName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const qc = useQueryClient()
  const navigate = useNavigate()

  if (isLoading) return <Spinner className="py-10" />
  if (!user) return <Navigate to="/signin?next=/account" replace />
  const value = name ?? user.displayName

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      await backend.updateDisplayName(value)
      await qc.invalidateQueries({ queryKey: ['user'] })
      setMsg({ tone: 'ok', text: 'Saved.' })
    } catch (err) {
      setMsg({ tone: 'error', text: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-5 text-2xl font-extrabold tracking-tight">Your account</h1>
      <div className="card space-y-5 p-6">
        <div>
          <p className="label">BC email</p>
          <p className="font-semibold">{user.email}</p>
        </div>
        <div>
          <p className="label">Access</p>
          <p>{ROLE_LABEL[user.role]}</p>
        </div>
        <form onSubmit={save} className="space-y-3">
          <div>
            <label className="label" htmlFor="acct-name">Display name</label>
            <input id="acct-name" className="field" maxLength={60} value={value} onChange={(e) => setName(e.target.value)} />
            <p className="mt-1 text-xs text-ink-3">Shown to admins, and suggested as your name on Community posts.</p>
          </div>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save name'}</button>
        </form>
        <button
          className="btn btn-ghost w-full"
          onClick={async () => {
            await backend.signOut()
            navigate('/')
          }}
        >
          <LogOut className="h-4 w-4" aria-hidden /> Sign out
        </button>
      </div>
    </div>
  )
}
