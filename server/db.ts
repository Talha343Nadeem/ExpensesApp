import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is required')
}

export const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'false' ? false : undefined,
})

let migrated = false

export async function ensureSchema() {
  if (migrated) return
  const here = dirname(fileURLToPath(import.meta.url))
  const schemaPath = join(here, '..', 'db', 'schema.sql')
  const sql = readFileSync(schemaPath, 'utf8')
  await pool.query(sql)
  migrated = true
}

export type DbUser = {
  id: string
  email: string
  password_hash: string
  currency_code: string
}

export type DbHead = {
  id: string
  user_id: string
  name: string
  parent_id: string | null
}

export type DbExpense = {
  id: string
  user_id: string
  head_id: string
  amount: string
  spent_on: string
  note: string | null
}

export type DbLimit = {
  id: string
  user_id: string
  head_id: string
  kind: 'count' | 'money'
  cap: string
  period: 'week' | 'month'
}
