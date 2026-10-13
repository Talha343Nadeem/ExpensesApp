import { Hono } from 'hono'
import { requireAuth, type AppVariables } from '../auth.ts'
import { pool } from '../db.ts'
import {
  getHeadsForUser,
  getLimitsForUser,
  monthLimitProgress,
  monthRange,
} from '../limits.ts'

export const monthRoutes = new Hono<{ Variables: AppVariables }>()

monthRoutes.use('*', requireAuth)

monthRoutes.get('/', async (c) => {
  const user = c.get('user')
  const year = Number(c.req.query('year'))
  const month = Number(c.req.query('month'))
  if (!year || !month || month < 1 || month > 12) {
    return c.json({ error: 'Provide year and month' }, 400)
  }

  const { start, end } = monthRange(year, month)
  const [heads, limits, expenseResult] = await Promise.all([
    getHeadsForUser(user.id),
    getLimitsForUser(user.id),
    pool.query<{
      id: string
      head_id: string
      amount: string
      spent_on: string
      note: string | null
      head_name: string
    }>(
      `SELECT e.id, e.head_id, e.amount::text, e.spent_on::text, e.note, h.name AS head_name
       FROM expenses e
       JOIN heads h ON h.id = e.head_id
       WHERE e.user_id = $1 AND e.spent_on >= $2 AND e.spent_on <= $3
       ORDER BY e.spent_on DESC, e.created_at DESC`,
      [user.id, start, end],
    ),
  ])

  const expenses = expenseResult.rows.map((row) => ({
    id: row.id,
    headId: row.head_id,
    headName: row.head_name,
    amount: Number(row.amount),
    spentOn: row.spent_on.slice(0, 10),
    note: row.note,
  }))

  const amountByHead = new Map<string, number>()
  for (const expense of expenses) {
    amountByHead.set(expense.headId, (amountByHead.get(expense.headId) ?? 0) + expense.amount)
  }

  const mains = heads.filter((h) => !h.parent_id)
  const totals = mains.map((main) => {
    const children = heads.filter((h) => h.parent_id === main.id)
    const childTotals = children.map((child) => ({
      headId: child.id,
      name: child.name,
      total: amountByHead.get(child.id) ?? 0,
    }))
    const own = amountByHead.get(main.id) ?? 0
    const total = own + childTotals.reduce((sum, c) => sum + c.total, 0)
    return {
      headId: main.id,
      name: main.name,
      total,
      own,
      children: childTotals.filter((c) => c.total > 0 || children.some((ch) => ch.id === c.headId)),
    }
  })

  const monthTotal = expenses.reduce((sum, e) => sum + e.amount, 0)
  const limitProgress = await monthLimitProgress(user.id, heads, limits, year, month)

  // Attach limit progress keyed by head for UI convenience
  const limitsByHead: Record<string, typeof limitProgress> = {}
  for (const item of limitProgress) {
    ;(limitsByHead[item.headId] ??= []).push(item)
  }

  // Also compute unused mains with 0 for display consistency — include all mains
  const allTotals = mains.map((main) => {
    const existing = totals.find((t) => t.headId === main.id)
    if (existing) return existing
    const children = heads.filter((h) => h.parent_id === main.id)
    return {
      headId: main.id,
      name: main.name,
      total: 0,
      own: 0,
      children: children.map((child) => ({
        headId: child.id,
        name: child.name,
        total: 0,
      })),
    }
  })

  return c.json({
    year,
    month,
    currencyCode: user.currency_code,
    monthTotal,
    totals: allTotals.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    expenses,
    limitProgress,
    limitsByHead,
  })
})
