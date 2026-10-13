export type User = {
  id: string
  email: string
  currencyCode: string
}

export type HeadLimit = {
  id: string
  cap: number
  period: 'week' | 'month'
}

export type Head = {
  id: string
  name: string
  parentId: string | null
  limits: {
    count: HeadLimit | null
    money: HeadLimit | null
  }
}

export type Expense = {
  id: string
  headId: string
  headName?: string
  amount: number
  spentOn: string
  note: string | null
}

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
  overWeeks?: Array<{ weekStart: string; used: number }>
}

export type HeadTotal = {
  headId: string
  name: string
  total: number
  own: number
  children: Array<{ headId: string; name: string; total: number }>
}

export type MonthSummary = {
  year: number
  month: number
  currencyCode: string
  monthTotal: number
  totals: HeadTotal[]
  expenses: Expense[]
  limitProgress: LimitProgress[]
  limitsByHead: Record<string, LimitProgress[]>
}
