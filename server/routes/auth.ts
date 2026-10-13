import { Hono } from 'hono'
import { z } from 'zod'
import {
  clearSessionCookie,
  createSession,
  destroySession,
  getSessionToken,
  hashPassword,
  requireAuth,
  seedStarterHeads,
  setSessionCookie,
  userFromToken,
  verifyPassword,
  type AppVariables,
} from '../auth.ts'
import { pool } from '../db.ts'

const credentials = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
})

export const authRoutes = new Hono<{ Variables: AppVariables }>()

authRoutes.post('/signup', async (c) => {
  const body = credentials.safeParse(await c.req.json())
  if (!body.success) {
    return c.json({ error: 'Enter a valid email and a password of at least 8 characters' }, 400)
  }
  const email = body.data.email.trim().toLowerCase()
  const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [email])
  if (existing.rowCount) {
    return c.json({ error: 'An account with that email already exists' }, 409)
  }

  const passwordHash = await hashPassword(body.data.password)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const userResult = await client.query<{ id: string; email: string; currency_code: string }>(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       RETURNING id, email, currency_code`,
      [email, passwordHash],
    )
    const user = userResult.rows[0]
    await seedStarterHeads(user.id, client)
    await client.query('COMMIT')

    const session = await createSession(user.id)
    setSessionCookie(c, session.token, session.expiresAt)
    return c.json({ user: { id: user.id, email: user.email, currencyCode: user.currency_code } })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

authRoutes.post('/login', async (c) => {
  const body = credentials.safeParse(await c.req.json())
  if (!body.success) {
    return c.json({ error: 'Enter a valid email and password' }, 400)
  }
  const email = body.data.email.trim().toLowerCase()
  const result = await pool.query<{
    id: string
    email: string
    password_hash: string
    currency_code: string
  }>(`SELECT id, email, password_hash, currency_code FROM users WHERE email = $1`, [email])
  const user = result.rows[0]
  if (!user || !(await verifyPassword(body.data.password, user.password_hash))) {
    return c.json({ error: 'Incorrect email or password' }, 401)
  }
  const session = await createSession(user.id)
  setSessionCookie(c, session.token, session.expiresAt)
  return c.json({ user: { id: user.id, email: user.email, currencyCode: user.currency_code } })
})

authRoutes.post('/logout', async (c) => {
  await destroySession(getSessionToken(c))
  clearSessionCookie(c)
  return c.json({ ok: true })
})

authRoutes.get('/me', async (c) => {
  const user = await userFromToken(getSessionToken(c))
  if (!user) return c.json({ user: null })
  return c.json({ user: { id: user.id, email: user.email, currencyCode: user.currency_code } })
})

authRoutes.patch('/me', requireAuth, async (c) => {
  const body = z
    .object({ currencyCode: z.string().trim().min(1).max(8) })
    .safeParse(await c.req.json())
  if (!body.success) {
    return c.json({ error: 'Invalid currency' }, 400)
  }
  const user = c.get('user')
  const result = await pool.query<{ id: string; email: string; currency_code: string }>(
    `UPDATE users SET currency_code = $1 WHERE id = $2
     RETURNING id, email, currency_code`,
    [body.data.currencyCode.toUpperCase(), user.id],
  )
  const updated = result.rows[0]
  return c.json({
    user: { id: updated.id, email: updated.email, currencyCode: updated.currency_code },
  })
})
