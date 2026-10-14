import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { formatMoney, monthLabel, shiftMonth } from '../lib/format'
import type { DebtSummary, MonthSummary } from '../types'

export function MonthPage() {
  const { user, setUser } = useAuth()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [data, setData] = useState<MonthSummary | null>(null)
  const [debtSummary, setDebtSummary] = useState<DebtSummary | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [currencyDraft, setCurrencyDraft] = useState(user?.currencyCode ?? 'PKR')
  const [savingCurrency, setSavingCurrency] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const [summary, debts] = await Promise.all([api.month(year, month), api.debts(false)])
      setData(summary)
      setDebtSummary(debts.summary)
      setCurrencyDraft(summary.currencyCode)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load month')
    }
  }, [year, month])

  useEffect(() => {
    void load()
  }, [load])

  function move(delta: number) {
    const next = shiftMonth(year, month, delta)
    setYear(next.year)
    setMonth(next.month)
  }

  async function saveCurrency() {
    if (!currencyDraft.trim()) return
    setSavingCurrency(true)
    try {
      const { user: updated } = await api.updateCurrency(currencyDraft.trim())
      setUser(updated)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update currency')
    } finally {
      setSavingCurrency(false)
    }
  }

  const currency = data?.currencyCode ?? user?.currencyCode ?? 'PKR'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost" onClick={() => move(-1)} aria-label="Previous month">
              ‹
            </button>
            <h1 className="font-[family-name:var(--font-display)] text-3xl tracking-tight">
              {monthLabel(year, month)}
            </h1>
            <button type="button" className="btn-ghost" onClick={() => move(1)} aria-label="Next month">
              ›
            </button>
          </div>
          <p className="mt-1 text-sm text-[var(--muted)]">Totals by head, with limit progress</p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--muted)]">Currency</span>
          <input
            value={currencyDraft}
            onChange={(e) => setCurrencyDraft(e.target.value.toUpperCase())}
            className="field w-20 py-1.5 text-center"
            maxLength={8}
          />
          <button
            type="button"
            className="btn-ghost"
            disabled={savingCurrency || currencyDraft === currency}
            onClick={() => void saveCurrency()}
          >
            Save
          </button>
        </label>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-4">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)]/70 p-5">
            <p className="text-sm text-[var(--muted)]">Spent this month</p>
            <p className="mt-1 font-[family-name:var(--font-display)] text-4xl tracking-tight">
              {formatMoney(data?.monthTotal ?? 0, currency)}
            </p>
          </div>

          <Link
            to="/owing"
            className="block rounded-2xl border border-[var(--line)] bg-[var(--paper)]/70 p-4 transition hover:border-[var(--accent)]"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">Owing</p>
              <span className="text-sm text-[var(--muted)]">Open →</span>
            </div>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Owed to you {formatMoney(debtSummary?.owedToMe ?? 0, currency)}
              {' · '}
              You owe {formatMoney(debtSummary?.iOwe ?? 0, currency)}
            </p>
          </Link>

          <div className="space-y-2">
            {(data?.totals ?? []).map((total) => {
              const open = expanded[total.headId] ?? total.total > 0
              const headLimits = data?.limitsByHead[total.headId] ?? []
              return (
                <div
                  key={total.headId}
                  className="rounded-2xl border border-[var(--line)] bg-[var(--paper)]/60"
                >
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    onClick={() =>
                      setExpanded((prev) => ({ ...prev, [total.headId]: !open }))
                    }
                  >
                    <div>
                      <p className="font-medium">{total.name}</p>
                      {headLimits.length ? (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {headLimits.map((lim) => (
                            <span
                              key={`${lim.headId}-${lim.kind}`}
                              className={`badge ${lim.over ? 'badge-warn' : 'badge-ok'}`}
                            >
                              {lim.kind === 'count'
                                ? `${lim.used}/${lim.cap}× ${lim.period}`
                                : `${formatMoney(lim.used, currency)} / ${formatMoney(lim.cap, currency)} ${lim.period}`}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <p className="shrink-0 font-medium tabular-nums">
                      {formatMoney(total.total, currency)}
                    </p>
                  </button>
                  {open ? (
                    <div className="space-y-1 border-t border-[var(--line)] px-4 py-3">
                      {total.own > 0 ? (
                        <div className="flex justify-between text-sm text-[var(--muted)]">
                          <span>Logged on {total.name}</span>
                          <span className="tabular-nums">{formatMoney(total.own, currency)}</span>
                        </div>
                      ) : null}
                      {total.children.map((child) => {
                        const childLimits = data?.limitsByHead[child.headId] ?? []
                        return (
                          <div key={child.headId} className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span>{child.name}</span>
                              <span className="tabular-nums">
                                {formatMoney(child.total, currency)}
                              </span>
                            </div>
                            {childLimits.map((lim) => (
                              <p
                                key={`${lim.headId}-${lim.kind}`}
                                className={`text-xs ${lim.over ? 'text-amber-800' : 'text-[var(--muted)]'}`}
                              >
                                Limit:{' '}
                                {lim.kind === 'count'
                                  ? `${lim.used} of ${lim.cap} per ${lim.period}`
                                  : `${formatMoney(lim.used, currency)} of ${formatMoney(lim.cap, currency)} per ${lim.period}`}
                                {lim.overWeeks?.length
                                  ? ` · ${lim.overWeeks.length} week(s) over`
                                  : ''}
                              </p>
                            ))}
                          </div>
                        )
                      })}
                      {!total.children.length && total.own === 0 ? (
                        <p className="text-sm text-[var(--muted)]">No spending yet</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-[family-name:var(--font-display)] text-xl">Expenses</h2>
            <Link to="/expenses/new" className="btn-primary hidden md:inline-flex">
              Add expense
            </Link>
          </div>
          <div className="space-y-2">
            {(data?.expenses ?? []).length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[var(--line)] px-4 py-8 text-center text-sm text-[var(--muted)]">
                No expenses this month yet.
              </p>
            ) : (
              data?.expenses.map((expense) => (
                <Link
                  key={expense.id}
                  to={`/expenses/${expense.id}`}
                  state={{ expense, year, month }}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--paper)]/60 px-4 py-3 transition hover:border-[var(--accent)]"
                >
                  <div>
                    <p className="font-medium">{expense.headName}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {expense.spentOn}
                      {expense.note ? ` · ${expense.note}` : ''}
                    </p>
                  </div>
                  <p className="tabular-nums font-medium">
                    {formatMoney(expense.amount, currency)}
                  </p>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>

      <Link
        to="/expenses/new"
        className="btn-primary fixed bottom-5 right-5 z-30 shadow-lg md:hidden"
      >
        Add expense
      </Link>
    </div>
  )
}
