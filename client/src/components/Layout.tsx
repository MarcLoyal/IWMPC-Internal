import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ROLE } from '../lib/format';

const ICONS = {
  home: 'M3 10.5 12 3l9 7.500V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.500Z',
  accounts:
    'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0ZM4 21a8 8 0 0 1 16 0',
  cashier: 'M3 7h18v10H3V7Zm9 7.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5ZM6 10v4m12-4v4',
};

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-base font-semibold transition-colors md:gap-3 md:px-4 md:py-3 md:text-lg ${
    isActive ? 'bg-logo-yellow text-brand-900 shadow-sm' : 'text-white hover:bg-white/10'
  }`;

export function Layout() {
  const { user, logout, can } = useAuth();

  return (
    <div className="min-h-screen md:flex">
      <aside className="no-print flex shrink-0 flex-col bg-brand-700 text-white md:sticky md:top-0 md:h-screen md:w-64">
        <div className="h-1.5 bg-logo-red" aria-hidden />
        <div className="h-1.5 bg-logo-yellow" aria-hidden />
        <div className="flex items-center gap-3 px-5 py-5">
          <img src="/logo.png" alt="IWMPC logo" className="h-12 w-12 shrink-0 rounded-full bg-white" />
          <div>
            <div className="text-xl font-bold leading-tight">IWMPC</div>
            <div className="text-xs text-brand-100">Inicbulan Waterworks MPC</div>
          </div>
        </div>

        {/* Water and Loans join this menu in Phases 1B and 1C. */}
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0" aria-label="Main menu">
          <NavLink to="/" end className={navClass}>
            <Icon path={ICONS.home} /> Home
          </NavLink>
          <NavLink to="/accounts" className={navClass}>
            <Icon path={ICONS.accounts} /> Accounts
          </NavLink>
          <NavLink to="/cashier" className={navClass}>
            <Icon path={ICONS.cashier} /> Cashier
          </NavLink>
        </nav>

        <div className="mt-auto hidden border-t border-white/10 px-5 py-4 md:block">
          <div className="font-semibold">{user?.name}</div>
          <div className="text-sm text-brand-100">{user && ROLE[user.role]}</div>
          <div className="mt-3 flex items-center gap-4 text-sm">
            {can('ADMIN') && (
              <NavLink to="/settings" className="font-semibold text-brand-100 underline-offset-2 hover:text-white hover:underline">
                Settings
              </NavLink>
            )}
            <button type="button" onClick={() => void logout()} className="font-semibold text-brand-100 underline-offset-2 hover:text-white hover:underline">
              Log out
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-white/10 px-5 py-2 text-sm md:hidden">
          <span>{user?.name}</span>
          <span className="flex gap-4">
            {can('ADMIN') && (
              <NavLink to="/settings" className="font-semibold underline">
                Settings
              </NavLink>
            )}
            <button type="button" onClick={() => void logout()} className="font-semibold underline">
              Log out
            </button>
          </span>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8 print:max-w-none print:p-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
