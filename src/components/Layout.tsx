import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? 'bg-[var(--ink)] text-[var(--paper)]'
      : 'text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--ink)]'
  }`

export function Layout() {
  const { user, logout } = useAuth()

  return (
    <div className="min-h-dvh">
      <header className="border-b border-[var(--line)] bg-[var(--paper)]/90 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="font-[family-name:var(--font-display)] text-xl tracking-tight text-[var(--ink)]">
              Ledger
            </p>
            <p className="text-xs text-[var(--muted)]">{user?.email}</p>
          </div>
          <nav className="flex flex-wrap items-center justify-end gap-1">
            <NavLink to="/" end className={linkClass}>
              Month
            </NavLink>
            <NavLink to="/heads" className={linkClass}>
              Heads
            </NavLink>
            <NavLink to="/owing" className={linkClass}>
              Owing
            </NavLink>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--ink)]"
            >
              Log out
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 pb-28 md:pb-8">
        <Outlet />
      </main>
    </div>
  )
}
