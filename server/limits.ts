import { pool, type DbHead, type DbLimit } from './db.ts'

export type LimitWarning = {
  headId: string
  headName: string
  kind: 'count' | 'money'
  period: 'week' | 'month'
  used: number
  cap: number
  message: string
}

export type LimitProgress = {
  headId: string
  headName: string
  kind: 'count' | 'money'
  period: 'week' | 'month'
  cap: number
  used: number
  over: boolean
  /** For weekly limits viewed in a month summary: each over-cap week */
  overWeeks?: Array<{ weekStart: string; used: number }>
}

function toDateString(d: Date) {
  return d.toISOString().slice(0, 10)
}

/** Monday of the week containing the given YYYY-MM-DD date (UTC calendar date). */
export function weekStartFor(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const day = date.getUTCDay() // 0 Sun .. 6 Sat
  const offset = day === 0 ? -6 : 1 - day
  date.setUTCDate(date.getUTCDate() + offset)
  return toDateString(date)
}

export function weekEndFor(weekStart: string) {
  const [y, m, d] = weekStart.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + 6)
  return toDateString(date)
}

export function monthRange(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

export async function getHeadsForUser(userId: string) {
  const result = await pool.query<DbHead>(
    `SELECT id, user_id, name, parent_id FROM heads WHERE user_id = $1 ORDER BY name`,
    [userId],
  )
  return result.rows
}

export function headScopeIds(heads: DbHead[], headId: string) {
  const children = heads.filter((h) => h.parent_id === headId).map((h) => h.id)
  return [headId, ...children]
}

async function usageFor(
  userId: string,
  headIds: string[],
  kind: 'count' | 'money',
  start: string,
  end: string,
) {
  if (kind === 'count') {
    const result = await pool.query<{ used: string }>(
      `SELECT COUNT(*)::text AS used FROM expenses
       WHERE user_id = $1 AND head_id = ANY($2::uuid[]) AND spent_on >= $3 AND spent_on <= $4`,
      [userId, headIds, start, end],
    )
    return Number(result.rows[0]?.used ?? 0)
  }
  const result = await pool.query<{ used: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS used FROM expenses
     WHERE user_id = $1 AND head_id = ANY($2::uuid[]) AND spent_on >= $3 AND spent_on <= $4`,
    [userId, headIds, start, end],
  )
  return Number(result.rows[0]?.used ?? 0)
}

function formatWarning(
  headName: string,
  kind: 'count' | 'money',
  period: 'week' | 'month',
  used: number,
  cap: number,
) {
  const periodLabel = period === 'week' ? 'this week' : 'this month'
  if (kind === 'count') {
    return `${headName} is over your limit: ${used} of ${cap} ${periodLabel}`
  }
  return `${headName} is over your limit: ${used} of ${cap} ${periodLabel}`
}

export async function checkLimitsForDate(
  userId: string,
  heads: DbHead[],
  limits: DbLimit[],
  spentOn: string,
): Promise<LimitWarning[]> {
  const warnings: LimitWarning[] = []
  const weekStart = weekStartFor(spentOn)
  const weekEnd = weekEndFor(weekStart)
  const [y, m] = spentOn.split('-').map(Number)
  const { start: monthStart, end: monthEnd } = monthRange(y, m)

  for (const limit of limits) {
    const head = heads.find((h) => h.id === limit.head_id)
    if (!head) continue
    const scope = headScopeIds(heads, head.id)
    const start = limit.period === 'week' ? weekStart : monthStart
    const end = limit.period === 'week' ? weekEnd : monthEnd
    const used = await usageFor(userId, scope, limit.kind, start, end)
    const cap = Number(limit.cap)
    if (used > cap) {
      warnings.push({
        headId: head.id,
        headName: head.name,
        kind: limit.kind,
        period: limit.period,
        used,
        cap,
        message: formatWarning(head.name, limit.kind, limit.period, used, cap),
      })
    }
  }
  return warnings
}

export async function monthLimitProgress(
  userId: string,
  heads: DbHead[],
  limits: DbLimit[],
  year: number,
  month: number,
): Promise<LimitProgress[]> {
  const { start: monthStart, end: monthEnd } = monthRange(year, month)
  const progress: LimitProgress[] = []

  for (const limit of limits) {
    const head = heads.find((h) => h.id === limit.head_id)
    if (!head) continue
    const scope = headScopeIds(heads, head.id)
    const cap = Number(limit.cap)

    if (limit.period === 'month') {
      const used = await usageFor(userId, scope, limit.kind, monthStart, monthEnd)
      progress.push({
        headId: head.id,
        headName: head.name,
        kind: limit.kind,
        period: 'month',
        cap,
        used,
        over: used > cap,
      })
      continue
    }

    // Weekly: show current/latest week usage within the month, plus over weeks
    const overWeeks: Array<{ weekStart: string; used: number }> = []
    let cursor = weekStartFor(monthStart)
    const monthEndDate = monthEnd
    let latestUsed = 0
    let latestWeekStart = cursor

    while (cursor <= monthEndDate) {
      const wEnd = weekEndFor(cursor)
      const used = await usageFor(userId, scope, limit.kind, cursor, wEnd)
      if (used > cap) {
        overWeeks.push({ weekStart: cursor, used })
      }
      // Prefer a week that overlaps "today" if in this month, else last week of month
      latestUsed = used
      latestWeekStart = cursor
      const [wy, wm, wd] = cursor.split('-').map(Number)
      const next = new Date(Date.UTC(wy, wm - 1, wd + 7))
      cursor = toDateString(next)
      if (cursor > monthEndDate && latestWeekStart < monthStart) break
    }

    // Recompute the week containing today if today is in this month
    const today = toDateString(new Date())
    const [ty, tm] = today.split('-').map(Number)
    if (ty === year && tm === month) {
      const tw = weekStartFor(today)
      latestUsed = await usageFor(userId, scope, limit.kind, tw, weekEndFor(tw))
      latestWeekStart = tw
    }

    progress.push({
      headId: head.id,
      headName: head.name,
      kind: limit.kind,
      period: 'week',
      cap,
      used: latestUsed,
      over: overWeeks.length > 0 || latestUsed > cap,
      overWeeks: overWeeks.length ? overWeeks : undefined,
    })
  }

  return progress
}

export async function getLimitsForUser(userId: string) {
  const result = await pool.query<DbLimit>(
    `SELECT id, user_id, head_id, kind, cap::text, period FROM limits WHERE user_id = $1`,
    [userId],
  )
  return result.rows
}
