import 'dotenv/config'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ensureSchema } from './db.ts'
import { authRoutes } from './routes/auth.ts'
import { expensesRoutes } from './routes/expenses.ts'
import { headsRoutes } from './routes/heads.ts'
import { monthRoutes } from './routes/month.ts'

const app = new Hono()

app.use(
  '/api/*',
  cors({
    origin: (origin) => origin || '*',
    credentials: true,
  }),
)

app.get('/api/health', (c) => c.json({ ok: true }))
app.route('/api/auth', authRoutes)
app.route('/api/heads', headsRoutes)
app.route('/api/expenses', expensesRoutes)
app.route('/api/month', monthRoutes)

const distDir = join(process.cwd(), 'dist')
if (existsSync(distDir)) {
  app.use('/assets/*', serveStatic({ root: './dist' }))
  app.use('/favicon.svg', serveStatic({ root: './dist' }))
  app.get('*', (c) => {
    const html = readFileSync(join(distDir, 'index.html'), 'utf8')
    return c.html(html)
  })
}

const port = Number(process.env.PORT || 3000)

await ensureSchema()

serve({ fetch: app.fetch, port }, () => {
  console.log(`Expense tracker listening on :${port}`)
})
