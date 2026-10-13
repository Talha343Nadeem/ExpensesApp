import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, type AppVariables } from '../auth.ts'
import { pool } from '../db.ts'
import {
  checkLimitsForDate,
  getHeadsForUser,
  getLimitsForUser,
  monthRange,
} from '../limits.ts'

export const expensesRoutes = new Hono<{ Variables: AppVariables }>()

expensesRoutes.use('*', requireAuth)

const expenseInput = z.object({
  headId: z.string().uuid(),
  amount: z.number().positive(),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).nullable().optional(),
})

function serializeExpense(row: {
  id: string
  head_id: string
  amount: string
  spent_on: Date | string
  note: string | null
  head_name?: string
}) {
  const spentOn =
    typeof row.spent_on === 'string'
      ? row.spent_on.slice(0, 10)
      : row.spent_on.toISOString().slice(0, 10)
  return {
    id: row.id,
    headId: row.head_id,
    headName: row.head_name,
    amount: Number(row.amount),
    spentOn,
    note: row.note,
  }
}

async function assertOwnedHead(userId: string, headId: string) {
  const result = await pool.query(`SELECT id FROM heads WHERE id = $1 AND user_id = $2`, [
    headId,
    userId,
  ])
  return Boolean(result.rowCount)
}

expensesRoutes.get('/', async (c) => {
  const user = c.get('user')
  const year = Number(c.req.query('year'))
  const month = Number(c.req.query('month'))
  if (!year || !month || month < 1 || month > 12) {
    return c.json({ error: 'Provide year and month' }, 400)
  }
  const { start, end } = monthRange(year, month)
  const result = await pool.query<{
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
  )
  return c.json({ expenses: result.rows.map(serializeExpense) })
})

expensesRoutes.get('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const result = await pool.query<{
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
     WHERE e.id = $1 AND e.user_id = $2`,
    [id, user.id],
  )
  if (!result.rowCount) {
    return c.json({ error: 'Expense not found' }, 404)
  }
  return c.json({ expense: serializeExpense(result.rows[0]) })
})

expensesRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = expenseInput.safeParse(await c.req.json())
  if (!body.success) {
    return c.json({ error: 'Enter amount, date, and a head' }, 400)
  }
  if (!(await assertOwnedHead(user.id, body.data.headId))) {
    return c.json({ error: 'Head not found' }, 404)
  }

  const result = await pool.query<{
    id: string
    head_id: string
    amount: string
    spent_on: string
    note: string | null
  }>(
    `INSERT INTO expenses (user_id, head_id, amount, spent_on, note)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, head_id, amount::text, spent_on::text, note`,
    [
      user.id,
      body.data.headId,
      body.data.amount,
      body.data.spentOn,
      body.data.note?.trim() || null,
    ],
  )

  const [heads, limits] = await Promise.all([getHeadsForUser(user.id), getLimitsForUser(user.id)])
  const warnings = await checkLimitsForDate(user.id, heads, limits, body.data.spentOn)
  return c.json({ expense: serializeExpense(result.rows[0]), warnings }, 201)
})

expensesRoutes.patch('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = expenseInput.partial().safeParse(await c.req.json())
  if (!body.success || Object.keys(body.data).length === 0) {
    return c.json({ error: 'Nothing to update' }, 400)
  }
  if (body.data.headId && !(await assertOwnedHead(user.id, body.data.headId))) {
    return c.json({ error: 'Head not found' }, 404)
  }

  const existing = await pool.query<{
    id: string
    head_id: string
    amount: string
    spent_on: string
    note: string | null
  }>(
    `SELECT id, head_id, amount::text, spent_on::text, note FROM expenses WHERE id = $1 AND user_id = $2`,
    [id, user.id],
  )
  if (!existing.rowCount) {
    return c.json({ error: 'Expense not found' }, 404)
  }

  const current = existing.rows[0]
  const headId = body.data.headId ?? current.head_id
  const amount = body.data.amount ?? Number(current.amount)
  const spentOn = body.data.spentOn ?? current.spent_on.slice(0, 10)
  const note =
    body.data.note === undefined ? current.note : body.data.note?.trim() || null

  const result = await pool.query<{
    id: string
    head_id: string
    amount: string
    spent_on: string
    note: string | null
  }>(
    `UPDATE expenses
     SET head_id = $1, amount = $2, spent_on = $3, note = $4
     WHERE id = $5 AND user_id = $6
     RETURNING id, head_id, amount::text, spent_on::text, note`,
    [headId, amount, spentOn, note, id, user.id],
  )

  const [heads, limits] = await Promise.all([getHeadsForUser(user.id), getLimitsForUser(user.id)])
  const warnings = await checkLimitsForDate(user.id, heads, limits, spentOn)
  return c.json({ expense: serializeExpense(result.rows[0]), warnings })
})

expensesRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const result = await pool.query(`DELETE FROM expenses WHERE id = $1 AND user_id = $2`, [
    id,
    user.id,
  ])
  if (!result.rowCount) {
    return c.json({ error: 'Expense not found' }, 404)
  }
  return c.json({ ok: true })
})
