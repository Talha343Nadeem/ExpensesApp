import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, type AppVariables } from '../auth.ts'
import { pool } from '../db.ts'

export const debtsRoutes = new Hono<{ Variables: AppVariables }>()

debtsRoutes.use('*', requireAuth)

type DebtRow = {
  id: string
  person_name: string
  direction: 'owed_to_me' | 'i_owe'
  note: string | null
  recorded_on: string
  settled_at: string | null
}

type ItemRow = {
  id: string
  debt_id: string
  amount: string
  description: string
  recorded_on: string
}

function serializeItem(row: ItemRow) {
  return {
    id: row.id,
    amount: Number(row.amount),
    description: row.description,
    recordedOn: row.recorded_on.slice(0, 10),
  }
}

function serializeDebt(row: DebtRow, items: ReturnType<typeof serializeItem>[]) {
  const amount = items.reduce((sum, item) => sum + item.amount, 0)
  return {
    id: row.id,
    personName: row.person_name,
    direction: row.direction,
    note: row.note,
    recordedOn: row.recorded_on.slice(0, 10),
    settledAt: row.settled_at,
    amount,
    items,
  }
}

async function loadItems(debtIds: string[]) {
  if (!debtIds.length) return new Map<string, ReturnType<typeof serializeItem>[]>()
  const result = await pool.query<ItemRow>(
    `SELECT id, debt_id, amount::text, description, recorded_on::text
     FROM debt_items
     WHERE debt_id = ANY($1::uuid[])
     ORDER BY recorded_on DESC, created_at DESC`,
    [debtIds],
  )
  const map = new Map<string, ReturnType<typeof serializeItem>[]>()
  for (const row of result.rows) {
    const list = map.get(row.debt_id) ?? []
    list.push(serializeItem(row))
    map.set(row.debt_id, list)
  }
  return map
}

async function getOwnedDebt(userId: string, debtId: string) {
  const result = await pool.query<DebtRow>(
    `SELECT id, person_name, direction, note, recorded_on::text, settled_at::text
     FROM debts WHERE id = $1 AND user_id = $2`,
    [debtId, userId],
  )
  return result.rows[0] ?? null
}

const itemInput = z.object({
  amount: z.number().positive(),
  description: z.string().trim().min(1).max(500),
  recordedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const createDebtInput = z.object({
  personName: z.string().trim().min(1).max(80),
  direction: z.enum(['owed_to_me', 'i_owe']),
  note: z.string().trim().max(500).nullable().optional(),
  amount: z.number().positive(),
  description: z.string().trim().min(1).max(500),
  recordedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

debtsRoutes.get('/', async (c) => {
  const user = c.get('user')
  const includeSettled = c.req.query('includeSettled') === '1'
  const result = await pool.query<DebtRow>(
    `SELECT id, person_name, direction, note, recorded_on::text, settled_at::text
     FROM debts
     WHERE user_id = $1
       AND ($2::boolean OR settled_at IS NULL)
     ORDER BY
       CASE WHEN settled_at IS NULL THEN 0 ELSE 1 END,
       recorded_on DESC,
       created_at DESC`,
    [user.id, includeSettled],
  )

  const itemsByDebt = await loadItems(result.rows.map((r) => r.id))
  const debts = result.rows.map((row) => serializeDebt(row, itemsByDebt.get(row.id) ?? []))
  const open = debts.filter((d) => !d.settledAt)
  const owedToMe = open
    .filter((d) => d.direction === 'owed_to_me')
    .reduce((sum, d) => sum + d.amount, 0)
  const iOwe = open
    .filter((d) => d.direction === 'i_owe')
    .reduce((sum, d) => sum + d.amount, 0)

  return c.json({
    debts,
    summary: {
      owedToMe,
      iOwe,
      net: owedToMe - iOwe,
    },
  })
})

debtsRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = createDebtInput.safeParse(await c.req.json())
  if (!body.success) {
    return c.json({ error: 'Enter a person, amount, and description' }, 400)
  }

  const recordedOn = body.data.recordedOn ?? null
  const personName = body.data.personName
  const direction = body.data.direction

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Reuse an open entry for the same person + direction so you can keep adding items
    const existing = await client.query<DebtRow>(
      `SELECT id, person_name, direction, note, recorded_on::text, settled_at::text
       FROM debts
       WHERE user_id = $1
         AND lower(person_name) = lower($2)
         AND direction = $3
         AND settled_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [user.id, personName, direction],
    )

    let debt = existing.rows[0]
    if (!debt) {
      const created = await client.query<DebtRow>(
        `INSERT INTO debts (user_id, person_name, direction, note, recorded_on)
         VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE))
         RETURNING id, person_name, direction, note, recorded_on::text, settled_at::text`,
        [user.id, personName, direction, body.data.note?.trim() || null, recordedOn],
      )
      debt = created.rows[0]
    }

    await client.query(
      `INSERT INTO debt_items (debt_id, amount, description, recorded_on)
       VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE))`,
      [debt.id, body.data.amount, body.data.description, recordedOn],
    )

    await client.query('COMMIT')

    const items = await loadItems([debt.id])
    return c.json({ debt: serializeDebt(debt, items.get(debt.id) ?? []) }, 201)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

debtsRoutes.post('/:id/items', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = itemInput.safeParse(await c.req.json())
  if (!body.success) {
    return c.json({ error: 'Enter an amount and description' }, 400)
  }

  const debt = await getOwnedDebt(user.id, id)
  if (!debt) {
    return c.json({ error: 'Entry not found' }, 404)
  }
  if (debt.settled_at) {
    return c.json({ error: 'Reopen this entry before adding more' }, 400)
  }

  await pool.query(
    `INSERT INTO debt_items (debt_id, amount, description, recorded_on)
     VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE))`,
    [id, body.data.amount, body.data.description, body.data.recordedOn ?? null],
  )

  const items = await loadItems([id])
  return c.json({ debt: serializeDebt(debt, items.get(id) ?? []) }, 201)
})

debtsRoutes.delete('/:id/items/:itemId', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const itemId = c.req.param('itemId')

  const debt = await getOwnedDebt(user.id, id)
  if (!debt) {
    return c.json({ error: 'Entry not found' }, 404)
  }

  const result = await pool.query(`DELETE FROM debt_items WHERE id = $1 AND debt_id = $2`, [
    itemId,
    id,
  ])
  if (!result.rowCount) {
    return c.json({ error: 'Item not found' }, 404)
  }

  const remaining = await loadItems([id])
  const items = remaining.get(id) ?? []
  if (!items.length) {
    await pool.query(`DELETE FROM debts WHERE id = $1 AND user_id = $2`, [id, user.id])
    return c.json({ ok: true, deletedDebt: true })
  }

  return c.json({ debt: serializeDebt(debt, items) })
})

debtsRoutes.patch('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = z
    .object({
      personName: z.string().trim().min(1).max(80).optional(),
      direction: z.enum(['owed_to_me', 'i_owe']).optional(),
      note: z.string().trim().max(500).nullable().optional(),
      settled: z.boolean().optional(),
    })
    .safeParse(await c.req.json())
  if (!body.success || Object.keys(body.data).length === 0) {
    return c.json({ error: 'Nothing to update' }, 400)
  }

  const current = await getOwnedDebt(user.id, id)
  if (!current) {
    return c.json({ error: 'Entry not found' }, 404)
  }

  const personName = body.data.personName ?? current.person_name
  const direction = body.data.direction ?? current.direction
  const note = body.data.note === undefined ? current.note : body.data.note?.trim() || null
  let settledAt: string | null = current.settled_at
  if (body.data.settled === true) settledAt = new Date().toISOString()
  if (body.data.settled === false) settledAt = null

  const result = await pool.query<DebtRow>(
    `UPDATE debts
     SET person_name = $1, direction = $2, note = $3, settled_at = $4
     WHERE id = $5 AND user_id = $6
     RETURNING id, person_name, direction, note, recorded_on::text, settled_at::text`,
    [personName, direction, note, settledAt, id, user.id],
  )

  const items = await loadItems([id])
  return c.json({ debt: serializeDebt(result.rows[0], items.get(id) ?? []) })
})

debtsRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const result = await pool.query(`DELETE FROM debts WHERE id = $1 AND user_id = $2`, [
    id,
    user.id,
  ])
  if (!result.rowCount) {
    return c.json({ error: 'Entry not found' }, 404)
  }
  return c.json({ ok: true })
})
