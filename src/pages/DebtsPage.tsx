import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { formatMoney, todayISO } from '../lib/format'
import type { Debt } from '../types'

export function DebtsPage() {
  const { user } = useAuth()
  const currency = user?.currencyCode ?? 'PKR'
  const [debts, setDebts] = useState<Debt[]>([])
  const [summary, setSummary] = useState({ owedToMe: 0, iOwe: 0, net: 0 })
  const [showSettled, setShowSettled] = useState(false)
  const [error, setError] = useState('')
  const [personName, setPersonName] = useState('')
  const [direction, setDirection] = useState<'owed_to_me' | 'i_owe'>('owed_to_me')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [recordedOn, setRecordedOn] = useState(todayISO())
  const [busy, setBusy] = useState(false)
  const [itemDrafts, setItemDrafts] = useState<
    Record<string, { amount: string; description: string; recordedOn: string }>
  >({})

  const load = useCallback(async () => {
    setError('')
    try {
      const data = await api.debts(showSettled)
      setDebts(data.debts)
      setSummary(data.summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load owing list')
    }
  }, [showSettled])

  useEffect(() => {
    void load()
  }, [load])

  function draftFor(debtId: string) {
    return (
      itemDrafts[debtId] ?? {
        amount: '',
        description: '',
        recordedOn: todayISO(),
      }
    )
  }

  function setDraft(
    debtId: string,
    patch: Partial<{ amount: string; description: string; recordedOn: string }>,
  ) {
    setItemDrafts((prev) => ({
      ...prev,
      [debtId]: { ...draftFor(debtId), ...patch },
    }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const value = Number(amount)
    if (!personName.trim() || !(value > 0) || !description.trim()) {
      setError('Enter a person, amount, and description')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api.createDebt({
        personName: personName.trim(),
        direction,
        amount: value,
        description: description.trim(),
        recordedOn,
      })
      setPersonName('')
      setAmount('')
      setDescription('')
      setRecordedOn(todayISO())
      setDirection('owed_to_me')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  async function addItem(debtId: string) {
    const draft = draftFor(debtId)
    const value = Number(draft.amount)
    if (!(value > 0) || !draft.description.trim()) {
      setError('Enter an amount and description for the new item')
      return
    }
    setError('')
    try {
      await api.addDebtItem(debtId, {
        amount: value,
        description: draft.description.trim(),
        recordedOn: draft.recordedOn,
      })
      setItemDrafts((prev) => {
        const next = { ...prev }
        delete next[debtId]
        return next
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add item')
    }
  }

  async function removeItem(debtId: string, itemId: string) {
    try {
      await api.deleteDebtItem(debtId, itemId)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete item')
    }
  }

  async function settle(id: string, settled: boolean) {
    try {
      await api.updateDebt(id, { settled })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update')
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this person and all their items?')) return
    try {
      await api.deleteDebt(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl tracking-tight">
          Owing
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Add multiple amounts with descriptions under each person — not part of expense heads
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)]/70 p-4">
          <p className="text-sm text-[var(--muted)]">Owed to me</p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-2xl tabular-nums text-[var(--accent)]">
            {formatMoney(summary.owedToMe, currency)}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)]/70 p-4">
          <p className="text-sm text-[var(--muted)]">I owe</p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-2xl tabular-nums">
            {formatMoney(summary.iOwe, currency)}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)]/70 p-4">
          <p className="text-sm text-[var(--muted)]">Net</p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-2xl tabular-nums">
            {formatMoney(summary.net, currency)}
          </p>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)]/70 p-5"
      >
        <p className="font-medium">Add item</p>

        <div className="flex rounded-xl bg-[var(--panel)] p-1">
          <button
            type="button"
            onClick={() => setDirection('owed_to_me')}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
              direction === 'owed_to_me'
                ? 'bg-[var(--ink)] text-[var(--paper)]'
                : 'text-[var(--muted)] hover:text-[var(--ink)]'
            }`}
          >
            They owe me
          </button>
          <button
            type="button"
            onClick={() => setDirection('i_owe')}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
              direction === 'i_owe'
                ? 'bg-[var(--ink)] text-[var(--paper)]'
                : 'text-[var(--muted)] hover:text-[var(--ink)]'
            }`}
          >
            I owe them
          </button>
        </div>

        <label className="block space-y-1.5">
          <span className="text-sm text-[var(--muted)]">Person</span>
          <input
            value={personName}
            onChange={(e) => setPersonName(e.target.value)}
            className="field"
            placeholder="e.g. Ali"
            required
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-sm text-[var(--muted)]">Amount</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="field"
              inputMode="decimal"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm text-[var(--muted)]">Date</span>
            <input
              type="date"
              required
              value={recordedOn}
              onChange={(e) => setRecordedOn(e.target.value)}
              className="field"
            />
          </label>
        </div>

        <label className="block space-y-1.5">
          <span className="text-sm text-[var(--muted)]">Description</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="field"
            placeholder="e.g. Lunch, Uber, Movie tickets"
            required
          />
        </label>

        <p className="text-xs text-[var(--muted)]">
          Same person + same direction adds another line under them.
        </p>

        <button type="submit" disabled={busy} className="btn-primary w-full sm:w-auto">
          {busy ? 'Saving…' : 'Save item'}
        </button>
      </form>

      <div className="flex items-center justify-between gap-3">
        <h2 className="font-[family-name:var(--font-display)] text-xl">People</h2>
        <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <input
            type="checkbox"
            checked={showSettled}
            onChange={(e) => setShowSettled(e.target.checked)}
          />
          Show settled
        </label>
      </div>

      <div className="space-y-3">
        {debts.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--line)] px-4 py-8 text-center text-sm text-[var(--muted)]">
            No entries yet.
          </p>
        ) : (
          debts.map((debt) => {
            const draft = draftFor(debt.id)
            return (
              <div
                key={debt.id}
                className={`rounded-2xl border border-[var(--line)] bg-[var(--paper)]/60 p-4 ${
                  debt.settledAt ? 'opacity-60' : ''
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{debt.personName}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {debt.direction === 'owed_to_me' ? 'Owes you' : 'You owe'}
                      {debt.settledAt ? ' · Settled' : ''}
                    </p>
                  </div>
                  <p className="tabular-nums font-medium">
                    {formatMoney(debt.amount, currency)}
                  </p>
                </div>

                <ul className="mt-3 space-y-2 border-t border-[var(--line)] pt-3">
                  {(debt.items ?? []).map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-start justify-between gap-2 text-sm"
                    >
                      <div>
                        <p>{item.description}</p>
                        <p className="text-xs text-[var(--muted)]">{item.recordedOn}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums font-medium">
                          {formatMoney(item.amount, currency)}
                        </span>
                        {!debt.settledAt ? (
                          <button
                            type="button"
                            className="btn-ghost text-red-700"
                            onClick={() => void removeItem(debt.id, item.id)}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>

                {!debt.settledAt ? (
                  <div className="mt-3 grid gap-2 border-t border-[var(--line)] pt-3 sm:grid-cols-[1fr_1fr_auto]">
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="Amount"
                      value={draft.amount}
                      onChange={(e) => setDraft(debt.id, { amount: e.target.value })}
                      className="field"
                      inputMode="decimal"
                    />
                    <input
                      placeholder="Description"
                      value={draft.description}
                      onChange={(e) => setDraft(debt.id, { description: e.target.value })}
                      className="field"
                    />
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => void addItem(debt.id)}
                    >
                      Add
                    </button>
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-1">
                  {debt.settledAt ? (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => void settle(debt.id, false)}
                    >
                      Reopen
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => void settle(debt.id, true)}
                    >
                      Mark settled
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-ghost text-red-700"
                    onClick={() => void remove(debt.id)}
                  >
                    Delete all
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
