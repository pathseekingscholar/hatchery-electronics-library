import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Mail } from 'lucide-react'
import { backend, isDemo } from '../backend'
import { DEMO_ACCOUNTS } from '../backend/demo'
import { isAllowedEmail } from '../lib/bcEmail'
import { errorMessage } from '../lib/format'
import type { AppUser } from '../lib/types'
import { Notice } from './ui'

/**
 * Passwordless sign-in: enter a @bc.edu email, get a 6-digit code by email, type it here.
 * Getting the code proves the person controls that BC inbox.
 */
export function SignInForm({ onSignedIn }: { onSignedIn: (user: AppUser) => void }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [demoCode, setDemoCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()

  const sendCode = async (e?: FormEvent, override?: string) => {
    e?.preventDefault()
    const addr = (override ?? email).trim()
    setError(null)
    if (!isAllowedEmail(addr)) return setError('Use your Boston College email (ending in @bc.edu).')
    setBusy(true)
    try {
      const r = await backend.sendSignInCode(addr)
      setEmail(addr)
      setDemoCode(r.demoCode ?? null)
      setCode('')
      setStep('code')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const verify = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const user = await backend.verifySignInCode(email, code)
      await qc.invalidateQueries()
      onSignedIn(user)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  if (step === 'code') {
    return (
      <form onSubmit={verify} className="space-y-4">
        <div className="flex items-start gap-3 rounded-2xl bg-gold-tint p-4 text-sm text-gold-dark">
          <Mail className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>
            We sent a 6-digit code to <strong className="text-ink">{email}</strong>. It can take a minute — check Junk too.
          </p>
        </div>
        {demoCode && (
          <Notice tone="info">
            Demo mode doesn’t send email. Your code is <strong className="font-mono">{demoCode}</strong>.
          </Notice>
        )}
        <div>
          <label className="label" htmlFor="signin-code">Code from the email</label>
          <input
            id="signin-code"
            className="field text-center font-mono text-2xl tracking-[0.4em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <button className="btn btn-primary w-full" disabled={busy || code.length < 6}>{busy ? 'Checking…' : 'Sign in'}</button>
        <div className="flex items-center justify-between text-sm">
          <button type="button" className="inline-flex items-center gap-1 font-semibold text-ink-2 hover:text-ink" onClick={() => setStep('email')}>
            <ArrowLeft className="h-4 w-4" aria-hidden /> Different email
          </button>
          <button type="button" className="font-semibold text-maroon hover:underline" disabled={busy} onClick={() => sendCode()}>
            Send a new code
          </button>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={sendCode} className="space-y-4">
      <div>
        <label className="label" htmlFor="signin-email">BC email</label>
        <input
          id="signin-email"
          className="field"
          type="email"
          autoComplete="email"
          required
          placeholder="eagle@bc.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in code'}</button>
      <p className="text-center text-xs text-ink-3">No password needed. First time? This creates your account.</p>
      {isDemo && (
        <div className="border-t border-line pt-4">
          <p className="mb-2 text-sm font-semibold">Demo accounts</p>
          <div className="flex flex-wrap gap-2">
            {DEMO_ACCOUNTS.map((a) => (
              <button key={a.email} type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => sendCode(undefined, a.email)}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </form>
  )
}
