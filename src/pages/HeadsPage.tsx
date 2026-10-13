import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { Head } from '../types'

type LimitDraft = {
  enabled: boolean
  cap: string
  period: 'week' | 'month'
}

function emptyDraft(): LimitDraft {
  return { enabled: false, cap: '', period: 'week' }
}

function fromHead(head: Head) {
  return {
    count: head.limits.count
      ? { enabled: true, cap: String(head.limits.count.cap), period: head.limits.count.period }
      : emptyDraft(),
    money: head.limits.money
      ? { enabled: true, cap: String(head.limits.money.cap), period: head.limits.money.period }
      : emptyDraft(),
  }
}

export function HeadsPage() {
  const [heads, setHeads] = useState<Head[]>([])
  const [error, setError] = useState('')
  const [mainName, setMainName] = useState('')
  const [subName, setSubName] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [limitFor, setLimitFor] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, ReturnType<typeof fromHead>>>({})

  const load = useCallback(async () => {
    setError('')
    try {
      const { heads: next } = await api.heads()
      setHeads(next)
      const nextDrafts: Record<string, ReturnType<typeof fromHead>> = {}
      for (const head of next) nextDrafts[head.id] = fromHead(head)
      setDrafts(nextDrafts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load heads')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const mains = heads.filter((h) => !h.parentId)
  const childrenOf = (id: string) => heads.filter((h) => h.parentId === id)

  async function addMain(e: FormEvent) {
    e.preventDefault()
    if (!mainName.trim()) return
    try {
      await api.createHead(mainName.trim())
      setMainName('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add head')
    }
  }

  async function addSub(parentId: string) {
    const name = (subName[parentId] ?? '').trim()
    if (!name) return
    try {
      await api.createHead(name, parentId)
      setSubName((prev) => ({ ...prev, [parentId]: '' }))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add sub-head')
    }
  }

  async function saveRename(id: string) {
    if (!editName.trim()) return
    try {
      await api.renameHead(id, editName.trim())
      setEditing(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename')
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteHead(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete')
    }
  }

  async function saveLimits(head: Head) {
    const draft = drafts[head.id] ?? fromHead(head)
    if (draft.count.enabled && !(Number(draft.count.cap) > 0)) {
      setError('Count limit needs a number greater than zero')
      return
    }
    if (draft.money.enabled && !(Number(draft.money.cap) > 0)) {
      setError('Money limit needs an amount greater than zero')
      return
    }
    try {
      await api.setLimits(head.id, {
        count: draft.count.enabled
          ? { cap: Number(draft.count.cap), period: draft.count.period }
          : null,
        money: draft.money.enabled
          ? { cap: Number(draft.money.cap), period: draft.money.period }
          : null,
      })
      setLimitFor(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save limits')
    }
  }

  function LimitEditor({ head }: { head: Head }) {
    const draft = drafts[head.id] ?? fromHead(head)
    function update(kind: 'count' | 'money', patch: Partial<LimitDraft>) {
      setDrafts((prev) => ({
        ...prev,
        [head.id]: {
          ...draft,
          [kind]: { ...draft[kind], ...patch },
        },
      }))
    }

    return (
      <div className="mt-3 space-y-3 rounded-xl bg-[var(--panel)] p-3">
        {(['count', 'money'] as const).map((kind) => (
          <div key={kind} className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={draft[kind].enabled}
                onChange={(e) => update(kind, { enabled: e.target.checked })}
              />
              {kind === 'count' ? 'Count limit' : 'Money limit'}
            </label>
            {draft[kind].enabled ? (
              <div className="flex flex-wrap gap-2">
                <input
                  type="number"
                  min="0.01"
                  step={kind === 'count' ? '1' : '0.01'}
                  placeholder={kind === 'count' ? 'e.g. 1' : 'e.g. 2000'}
                  value={draft[kind].cap}
                  onChange={(e) => update(kind, { cap: e.target.value })}
                  className="field w-28"
                />
                <select
                  value={draft[kind].period}
                  onChange={(e) =>
                    update(kind, { period: e.target.value as 'week' | 'month' })
                  }
                  className="field"
                >
                  <option value="week">per week</option>
                  <option value="month">per month</option>
                </select>
              </div>
            ) : null}
          </div>
        ))}
        <div className="flex gap-2">
          <button type="button" className="btn-primary" onClick={() => void saveLimits(head)}>
            Save limits
          </button>
          <button type="button" className="btn-ghost" onClick={() => setLimitFor(null)}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  function HeadRow({ head, nested = false }: { head: Head; nested?: boolean }) {
    const isEditing = editing === head.id
    const showLimits = limitFor === head.id
    return (
      <div className={`rounded-xl border border-[var(--line)] bg-[var(--paper)]/70 p-3 ${nested ? 'ml-4' : ''}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {isEditing ? (
            <div className="flex flex-1 flex-wrap gap-2">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="field flex-1"
              />
              <button type="button" className="btn-primary" onClick={() => void saveRename(head.id)}>
                Save
              </button>
              <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              <div>
                <p className="font-medium">{head.name}</p>
                <p className="text-xs text-[var(--muted)]">
                  {[
                    head.limits.count
                      ? `${head.limits.count.cap}× / ${head.limits.count.period}`
                      : null,
                    head.limits.money
                      ? `money ${head.limits.money.cap} / ${head.limits.money.period}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'No limits'}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setLimitFor(showLimits ? null : head.id)
                    setDrafts((prev) => ({ ...prev, [head.id]: fromHead(head) }))
                  }}
                >
                  Limits
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setEditing(head.id)
                    setEditName(head.name)
                  }}
                >
                  Rename
                </button>
                <button type="button" className="btn-ghost text-red-700" onClick={() => void remove(head.id)}>
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
        {showLimits ? <LimitEditor head={head} /> : null}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl tracking-tight">Heads</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Main heads and sub-heads, plus count or money limits
        </p>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      <form onSubmit={addMain} className="flex flex-wrap gap-2">
        <input
          value={mainName}
          onChange={(e) => setMainName(e.target.value)}
          placeholder="New main head, e.g. Drinks"
          className="field flex-1 min-w-[12rem]"
        />
        <button type="submit" className="btn-primary">
          Add main head
        </button>
      </form>

      <div className="space-y-4">
        {mains.map((main) => (
          <div key={main.id} className="space-y-2">
            <HeadRow head={main} />
            {childrenOf(main.id).map((child) => (
              <HeadRow key={child.id} head={child} nested />
            ))}
            <div className="ml-4 flex flex-wrap gap-2">
              <input
                value={subName[main.id] ?? ''}
                onChange={(e) => setSubName((prev) => ({ ...prev, [main.id]: e.target.value }))}
                placeholder={`Sub-head under ${main.name}`}
                className="field flex-1 min-w-[12rem]"
              />
              <button type="button" className="btn-ghost" onClick={() => void addSub(main.id)}>
                Add sub-head
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
