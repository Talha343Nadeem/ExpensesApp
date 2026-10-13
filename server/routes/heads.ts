import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, type AppVariables } from '../auth.ts'
import { pool } from '../db.ts'
import { getHeadsForUser, getLimitsForUser } from '../limits.ts'

export const headsRoutes = new Hono<{ Variables: AppVariables }>()

headsRoutes.use('*', requireAuth)

function serializeHead(
  head: { id: string; name: string; parent_id: string | null },
  limits: Array<{ head_id: string; kind: string; cap: string; period: string; id: string }>,
) {
  const headLimits = limits.filter((l) => l.head_id === head.id)
  const count = headLimits.find((l) => l.kind === 'count')
  const money = headLimits.find((l) => l.kind === 'money')
  return {
    id: head.id,
    name: head.name,
    parentId: head.parent_id,
    limits: {
      count: count
        ? { id: count.id, cap: Number(count.cap), period: count.period as 'week' | 'month' }
        : null,
      money: money
        ? { id: money.id, cap: Number(money.cap), period: money.period as 'week' | 'month' }
        : null,
    },
  }
}

headsRoutes.get('/', async (c) => {
  const user = c.get('user')
  const [heads, limits] = await Promise.all([getHeadsForUser(user.id), getLimitsForUser(user.id)])
  return c.json({ heads: heads.map((h) => serializeHead(h, limits)) })
})

headsRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = z
    .object({
      name: z.string().trim().min(1).max(80),
      parentId: z.string().uuid().nullable().optional(),
    })
    .safeParse(await c.req.json())
  if (!body.success) {
    return c.json({ error: 'Enter a head name' }, 400)
  }

  const parentId = body.data.parentId ?? null
  if (parentId) {
    const parent = await pool.query<{ parent_id: string | null }>(
      `SELECT parent_id FROM heads WHERE id = $1 AND user_id = $2`,
      [parentId, user.id],
    )
    if (!parent.rowCount) {
      return c.json({ error: 'Parent head not found' }, 404)
    }
    if (parent.rows[0].parent_id) {
      return c.json({ error: 'Sub-heads can only sit under a main head' }, 400)
    }
  }

  const result = await pool.query<{ id: string; name: string; parent_id: string | null }>(
    `INSERT INTO heads (user_id, name, parent_id) VALUES ($1, $2, $3)
     RETURNING id, name, parent_id`,
    [user.id, body.data.name, parentId],
  )
  return c.json({ head: serializeHead(result.rows[0], []) }, 201)
})

headsRoutes.patch('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(await c.req.json())
  if (!body.success) {
    return c.json({ error: 'Enter a head name' }, 400)
  }
  const result = await pool.query<{ id: string; name: string; parent_id: string | null }>(
    `UPDATE heads SET name = $1 WHERE id = $2 AND user_id = $3
     RETURNING id, name, parent_id`,
    [body.data.name, id, user.id],
  )
  if (!result.rowCount) {
    return c.json({ error: 'Head not found' }, 404)
  }
  const limits = await getLimitsForUser(user.id)
  return c.json({ head: serializeHead(result.rows[0], limits) })
})

headsRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const head = await pool.query<{ id: string }>(
    `SELECT id FROM heads WHERE id = $1 AND user_id = $2`,
    [id, user.id],
  )
  if (!head.rowCount) {
    return c.json({ error: 'Head not found' }, 404)
  }

  const children = await pool.query(`SELECT id FROM heads WHERE parent_id = $1 AND user_id = $2`, [
    id,
    user.id,
  ])
  if (children.rowCount) {
    return c.json({ error: 'Remove sub-heads first' }, 400)
  }

  const expenses = await pool.query(`SELECT id FROM expenses WHERE head_id = $1 AND user_id = $2 LIMIT 1`, [
    id,
    user.id,
  ])
  if (expenses.rowCount) {
    return c.json({ error: 'This head still has expenses' }, 400)
  }

  await pool.query(`DELETE FROM heads WHERE id = $1 AND user_id = $2`, [id, user.id])
  return c.json({ ok: true })
})

const limitSpec = z
  .object({
    cap: z.number().positive(),
    period: z.enum(['week', 'month']),
  })
  .nullable()

headsRoutes.put('/:id/limits', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = z
    .object({
      count: limitSpec.optional(),
      money: limitSpec.optional(),
    })
    .safeParse(await c.req.json())
  if (!body.success) {
    return c.json({ error: 'Invalid limit' }, 400)
  }

  const head = await pool.query<{ id: string; name: string; parent_id: string | null }>(
    `SELECT id, name, parent_id FROM heads WHERE id = $1 AND user_id = $2`,
    [id, user.id],
  )
  if (!head.rowCount) {
    return c.json({ error: 'Head not found' }, 404)
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const kind of ['count', 'money'] as const) {
      if (!(kind in body.data)) continue
      const spec = body.data[kind]
      if (spec === null) {
        await client.query(`DELETE FROM limits WHERE head_id = $1 AND user_id = $2 AND kind = $3`, [
          id,
          user.id,
          kind,
        ])
      } else if (spec) {
        await client.query(
          `INSERT INTO limits (user_id, head_id, kind, cap, period)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (head_id, kind)
           DO UPDATE SET cap = EXCLUDED.cap, period = EXCLUDED.period`,
          [user.id, id, kind, spec.cap, spec.period],
        )
      }
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  const limits = await getLimitsForUser(user.id)
  return c.json({ head: serializeHead(head.rows[0], limits) })
})
