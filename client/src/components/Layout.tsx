import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ROLE } from '../lib/format';

const ICONS = {
  home: 'M3 10.5 12 3l9 7.500V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.500Z',
  accounts:
    'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0ZM4 21a8 8 0 0 1 16 0',
  water: 'M12 3c3.500 4.300 6 7.400 6 10.500a6 6 0 0 1-12 0C6 10.400 8.500 7.300 12 3Z',
  cashier: 'M3 7h18v10H3V7Zm9 7.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5ZM6 10v4m12-4v4',
};

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

const MENU_KEY = 'iwmpc_menu_hidden';

function readHidden(): boolean {
  try {
    return localStorage.getItem(MENU_KEY) === '1';
  } catch {
    return false;
  }
}

export function Layout() {
  const { user, logout, can } = useAuth();
  // On a computer the menu can be hidden to give the page the full width. Icons stay visible.
  const [hidden, setHidden] = useState(readHidden);

  function toggle() {
    setHidden((h) => {
      try {
        localStorage.setItem(MENU_KEY, h ? '0' : '1');
      } catch {
        /* the choice just isn't remembered */
      }
      return !h;
    });
  }

  // The menu shows icons only on smaller screens (laptops, or a zoomed-in browser) and whenever
  // it was hidden with the button. Full menu: large screens. Phones keep the top bar.
  const label = hidden ? 'md:hidden' : 'md:hidden xl:block';
  const rail = (onRail: string, full: string) => (hidden ? onRail : `${onRail} ${full}`);
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `flex shrink-0 items-center gap-2 rounded-lg border-b-4 px-3 py-2 text-base font-semibold transition-colors md:gap-3 md:rounded-l-none md:border-b-0 md:border-l-4 md:py-2.5 md:text-lg ${rail(
      'md:justify-center md:px-0',
      'xl:justify-start xl:px-4',
    )} ${isActive ? 'border-logo-yellow bg-white/15 text-white' : 'border-transparent text-brand-100 hover:bg-white/10 hover:text-white'}`;
  const items = [
    { to: '/', name: 'Home', icon: ICONS.home, end: true },
    { to: '/accounts', name: 'Accounts', icon: ICONS.accounts },
    { to: '/water', name: 'Water', icon: ICONS.water },
    { to: '/cashier', name: 'Cashier', icon: ICONS.cashier },
  ];

  return (
    <div className="min-h-screen md:flex">
      <aside
        className={`no-print flex shrink-0 flex-col bg-brand-950 text-white md:sticky md:top-0 md:h-screen ${rail('md:w-[72px]', 'xl:w-60')}`}
      >
        <div className="h-1 bg-logo-yellow" aria-hidden />
        <div className={`flex items-center gap-3 px-5 py-4 ${rail('md:justify-center md:px-0', 'xl:justify-start xl:px-5')}`}>
          <img src="/logo.png" alt="IWMPC logo" className="h-12 w-12 shrink-0 rounded-full bg-white" />
          <div className={label}>
            <div className="text-xl font-bold leading-tight">IWMPC</div>
            <div className="whitespace-nowrap text-[11px] text-brand-100">Inicbulan Waterworks MPC</div>
          </div>
        </div>

        {/* Loans joins this menu in Phase 1C. */}
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:flex-col md:px-0 md:pb-0 md:pr-3" aria-label="Main menu">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navClass} title={item.name} aria-label={item.name}>
              <Icon path={item.icon} /> <span className={label}>{item.name}</span>
            </NavLink>
          ))}
        </nav>

        <button
          type="button"
          onClick={toggle}
          aria-expanded={!hidden}
          title={hidden ? 'Show menu' : undefined}
          className={`mx-3 mt-3 hidden items-center gap-3 rounded-lg border border-white/20 py-2 text-sm font-semibold text-brand-100 hover:bg-white/10 hover:text-white xl:flex ${
            hidden ? 'justify-center px-0' : 'px-4'
          }`}
        >
          <svg viewBox="0 0 24 24" className={`h-5 w-5 shrink-0 ${hidden ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M11 6l-6 6 6 6M19 6l-6 6 6 6" />
          </svg>
          <span className={label}>Hide menu</span>
          {hidden && <span className="sr-only">Show menu</span>}
        </button>

        <div className={`mt-auto hidden border-t border-white/10 py-4 md:block ${rail('md:px-1 md:text-center', 'xl:px-5 xl:text-left')}`}>
          <div className={label}>
            <div className="font-semibold">{user?.name}</div>
            <div className="text-sm text-brand-100">{user && ROLE[user.role]}</div>
          </div>
          <div className={`flex text-sm ${rail('flex-col items-center gap-3', 'xl:mt-3 xl:flex-row xl:gap-4')}`}>
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
        <div className={`mx-auto px-4 py-5 sm:px-6 lg:px-8 print:max-w-none print:p-0 ${hidden ? 'max-w-none' : 'max-w-7xl'}`}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
