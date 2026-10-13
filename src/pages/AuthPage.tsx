import { type FormEvent, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'

export function AuthPage() {
  const { user, loading, setUser } = useAuth()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!loading && user) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const result =
        mode === 'login'
          ? await api.login(email, password)
          : await api.signup(email, password)
      setUser(result.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(74,122,99,0.22),transparent_50%),radial-gradient(ellipse_at_bottom_right,rgba(196,140,74,0.18),transparent_45%)]" />
      <div className="relative mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
        <div className="mb-8">
          <p className="font-[family-name:var(--font-display)] text-4xl tracking-tight text-[var(--ink)]">
            Ledger
          </p>
          <p className="mt-2 text-[var(--muted)]">
            Track spending by head, keep the same numbers on your phone and laptop.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)]/80 p-5 shadow-[0_20px_50px_-30px_rgba(28,40,34,0.45)] backdrop-blur"
        >
          <div className="flex rounded-xl bg-[var(--panel)] p-1">
            {(['login', 'signup'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 rounded-lg py-2 text-sm font-medium capitalize transition ${
                  mode === m
                    ? 'bg-[var(--ink)] text-[var(--paper)]'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
                {m === 'login' ? 'Log in' : 'Sign up'}
              </button>
            ))}
          </div>

          <label className="block space-y-1.5">
            <span className="text-sm text-[var(--muted)]">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm text-[var(--muted)]">Password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field"
            />
          </label>

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
          ) : null}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}
