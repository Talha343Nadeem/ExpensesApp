import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { Context, Next } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { pool, type DbUser } from './db.ts'

const SESSION_COOKIE = 'expense_session'
const SESSION_DAYS = 30

export type AppVariables = {
  user: DbUser
}

function hashToken(token: string) {
  const pepper = process.env.SESSION_SECRET || ''
  return createHash('sha256').update(`${pepper}:${token}`).digest('hex')
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('hex')
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  )
  return { token, expiresAt }
}

export async function destroySession(token: string | undefined) {
  if (!token) return
  await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)])
}

export async function userFromToken(token: string | undefined): Promise<DbUser | null> {
  if (!token) return null
  const result = await pool.query<DbUser>(
    `SELECT u.id, u.email, u.password_hash, u.currency_code
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  )
  return result.rows[0] ?? null
}

export function setSessionCookie(c: Context, token: string, expiresAt: Date) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
  })
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

export function getSessionToken(c: Context) {
  return getCookie(c, SESSION_COOKIE)
}

export async function requireAuth(c: Context<{ Variables: AppVariables }>, next: Next) {
  const user = await userFromToken(getSessionToken(c))
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  c.set('user', user)
  await next()
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash)
}

const STARTER_HEADS: Array<{ name: string; children: string[] }> = [
  { name: 'Food', children: ['Fast food', 'Coffee', 'Groceries'] },
  { name: 'Transport', children: ['Fuel', 'Ride'] },
  { name: 'Bills', children: ['Rent', 'Utilities'] },
]

type Queryable = {
  query: typeof pool.query
}

export async function seedStarterHeads(userId: string, db: Queryable = pool) {
  for (const group of STARTER_HEADS) {
    const parent = await db.query<{ id: string }>(
      `INSERT INTO heads (user_id, name, parent_id) VALUES ($1, $2, NULL) RETURNING id`,
      [userId, group.name],
    )
    const parentId = parent.rows[0].id
    for (const child of group.children) {
      await db.query(`INSERT INTO heads (user_id, name, parent_id) VALUES ($1, $2, $3)`, [
        userId,
        child,
        parentId,
      ])
    }
  }
}
