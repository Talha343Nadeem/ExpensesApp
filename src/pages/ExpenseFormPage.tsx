import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { todayISO } from '../lib/format'
import type { Expense, Head, LimitWarning } from '../types'

export function ExpenseFormPage() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as
    | { expense?: Expense; warnings?: LimitWarning[] }
    | null
  const existing = locationState?.expense

  const [heads, setHeads] = useState<Head[]>([])
  const [mainId, setMainId] = useState('')
  const [subId, setSubId] = useState('')
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '')
  const [spentOn, setSpentOn] = useState(existing?.spentOn ?? todayISO())
  const [note, setNote] = useState(existing?.note ?? '')
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<LimitWarning[]>(locationState?.warnings ?? [])
  const [busy, setBusy] = useState(false)
  const [loadedExpense, setLoadedExpense] = useState<Expense | null>(existing ?? null)

  const mains = useMemo(() => heads.filter((h) => !h.parentId), [heads])
  const subs = useMemo(
    () => heads.filter((h) => h.parentId === mainId),
    [heads, mainId],
  )

  useEffect(() => {
    void (async () => {
      try {
        const { heads: next } = await api.heads()
        setHeads(next)

        let expense = existing ?? null
        if (!isNew && !expense && id) {
          const fetched = await api.getExpense(id)
          expense = fetched.expense
        }

        if (expense) {
          setLoadedExpense(expense)
          setAmount(String(expense.amount))
          setSpentOn(expense.spentOn)
          setNote(expense.note ?? '')
          const head = next.find((h) => h.id === expense!.headId)
          if (head?.parentId) {
            setMainId(head.parentId)
            setSubId(head.id)
          } else if (head) {
            setMainId(head.id)
            setSubId('')
          }
        } else if (isNew && next.length) {
          const firstMain = next.find((h) => !h.parentId)
          if (firstMain) setMainId(firstMain.id)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load form')
      }
    })()
  }, [existing, id, isNew])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setWarnings([])
    const headId = subId || mainId
    const value = Number(amount)
    if (!headId || !(value > 0)) {
      setError('Choose a head and enter an amount')
      return
    }
    setBusy(true)
    try {
      const payload = {
        headId,
        amount: value,
        spentOn,
        note: note.trim() || null,
      }
      const result = isNew
        ? await api.createExpense(payload)
        : await api.updateExpense(id!, payload)
      if (result.warnings.length) {
        setWarnings(result.warnings)
        setLoadedExpense(result.expense)
        if (isNew) {
          navigate(`/expenses/${result.expense.id}`, {
            replace: true,
            state: { expense: result.expense, warnings: result.warnings },
          })
        }
      } else {
        navigate('/')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  async function onDelete() {
    if (!id || isNew) return
    if (!confirm('Delete this expense?')) return
    setBusy(true)
    try {
      await api.deleteExpense(id)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete')
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <Link to="/" className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">
          ← Back
        </Link>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl tracking-tight">
          {isNew ? 'Add expense' : 'Edit expense'}
        </h1>
      </div>

      {warnings.length ? (
        <div className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="font-medium text-amber-950">Saved — you are over a limit</p>
          {warnings.map((w) => (
            <p key={`${w.headId}-${w.kind}`} className="text-sm text-amber-900">
              {w.message}
            </p>
          ))}
          <button type="button" className="btn-primary mt-2" onClick={() => navigate('/')}>
            Back to month
          </button>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)]/70 p-5">
        <label className="block space-y-1.5">
          <span className="text-sm text-[var(--muted)]">Amount</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="field text-lg"
            inputMode="decimal"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm text-[var(--muted)]">Date</span>
          <input
            type="date"
            required
            value={spentOn}
            onChange={(e) => setSpentOn(e.target.value)}
            className="field"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm text-[var(--muted)]">Main head</span>
          <select
            required
            value={mainId}
            onChange={(e) => {
              setMainId(e.target.value)
              setSubId('')
            }}
            className="field"
          >
            <option value="" disabled>
              Choose…
            </option>
            {mains.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm text-[var(--muted)]">Sub-head (optional)</span>
          <select
            value={subId}
            onChange={(e) => setSubId(e.target.value)}
            className="field"
            disabled={!subs.length}
          >
            <option value="">None — log on main head</option>
            {subs.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm text-[var(--muted)]">Note</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="field"
            placeholder="Optional"
          />
        </label>

        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
        ) : null}

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Saving…' : 'Save expense'}
        </button>

        {!isNew && loadedExpense ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onDelete()}
            className="w-full rounded-xl px-4 py-3 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Delete expense
          </button>
        ) : null}
      </form>
    </div>
  )
}
