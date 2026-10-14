import type {
  Debt,
  DebtSummary,
  Expense,
  Head,
  LimitWarning,
  MonthSummary,
  User,
} from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Request failed')
  }
  return data as T
}

export const api = {
  me: () => request<{ user: User | null }>('/api/auth/me'),
  signup: (email: string, password: string) =>
    request<{ user: User }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string) =>
    request<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  updateCurrency: (currencyCode: string) =>
    request<{ user: User }>('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ currencyCode }),
    }),
  heads: () => request<{ heads: Head[] }>('/api/heads'),
  createHead: (name: string, parentId?: string | null) =>
    request<{ head: Head }>('/api/heads', {
      method: 'POST',
      body: JSON.stringify({ name, parentId: parentId ?? null }),
    }),
  renameHead: (id: string, name: string) =>
    request<{ head: Head }>(`/api/heads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  deleteHead: (id: string) =>
    request<{ ok: boolean }>(`/api/heads/${id}`, { method: 'DELETE' }),
  setLimits: (
    id: string,
    limits: {
      count?: { cap: number; period: 'week' | 'month' } | null
      money?: { cap: number; period: 'week' | 'month' } | null
    },
  ) =>
    request<{ head: Head }>(`/api/heads/${id}/limits`, {
      method: 'PUT',
      body: JSON.stringify(limits),
    }),
  month: (year: number, month: number) =>
    request<MonthSummary>(`/api/month?year=${year}&month=${month}`),
  getExpense: (id: string) => request<{ expense: Expense }>(`/api/expenses/${id}`),
  createExpense: (input: {
    headId: string
    amount: number
    spentOn: string
    note?: string | null
  }) =>
    request<{ expense: Expense; warnings: LimitWarning[] }>('/api/expenses', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateExpense: (
    id: string,
    input: Partial<{ headId: string; amount: number; spentOn: string; note: string | null }>,
  ) =>
    request<{ expense: Expense; warnings: LimitWarning[] }>(`/api/expenses/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteExpense: (id: string) =>
    request<{ ok: boolean }>(`/api/expenses/${id}`, { method: 'DELETE' }),
  debts: (includeSettled = false) =>
    request<{ debts: Debt[]; summary: DebtSummary }>(
      `/api/debts?includeSettled=${includeSettled ? '1' : '0'}`,
    ),
  createDebt: (input: {
    personName: string
    direction: 'owed_to_me' | 'i_owe'
    amount: number
    description: string
    note?: string | null
    recordedOn?: string
  }) =>
    request<{ debt: Debt }>('/api/debts', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  addDebtItem: (
    debtId: string,
    input: { amount: number; description: string; recordedOn?: string },
  ) =>
    request<{ debt: Debt }>(`/api/debts/${debtId}/items`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteDebtItem: (debtId: string, itemId: string) =>
    request<{ ok: boolean; debt?: Debt; deletedDebt?: boolean }>(
      `/api/debts/${debtId}/items/${itemId}`,
      { method: 'DELETE' },
    ),
  updateDebt: (
    id: string,
    input: Partial<{
      personName: string
      direction: 'owed_to_me' | 'i_owe'
      note: string | null
      settled: boolean
    }>,
  ) =>
    request<{ debt: Debt }>(`/api/debts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteDebt: (id: string) =>
    request<{ ok: boolean }>(`/api/debts/${id}`, { method: 'DELETE' }),
}
