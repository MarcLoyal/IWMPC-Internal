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

  // The menu shows icons only on smaller screens (laptops, or a zoomed-in browser) and whenever it
  // was hidden with the button. Moving the mouse onto it (or tabbing into it) opens it over the
  // page, without pushing the page aside. Phones keep the top bar.
  const full = (onRail: string, whenFull: string) => (hidden ? onRail : `${onRail} ${whenFull}`);
  const label = full('md:hidden md:group-hover:block md:group-has-[:focus-visible]:block', 'xl:block');
  const align = full(
    'md:justify-center md:px-0 md:group-hover:justify-start md:group-hover:px-4 md:group-has-[:focus-visible]:justify-start md:group-has-[:focus-visible]:px-4',
    'xl:justify-start xl:px-4',
  );
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border-b-4 px-3 py-2 text-base font-semibold transition-colors md:gap-3 md:rounded-l-none md:border-b-0 md:border-l-4 md:py-2.5 md:text-lg ${align} ${
      isActive ? 'border-logo-yellow bg-white/15 text-white' : 'border-transparent text-brand-100 hover:bg-white/10 hover:text-white'
    }`;
  const items = [
    { to: '/', name: 'Home', icon: ICONS.home, end: true },
    { to: '/accounts', name: 'Accounts', icon: ICONS.accounts },
    { to: '/water', name: 'Water', icon: ICONS.water },
    { to: '/cashier', name: 'Cashier', icon: ICONS.cashier },
  ];
  const footLink = 'font-semibold text-brand-100 underline-offset-2 hover:text-white hover:underline';

  return (
    <div className="min-h-screen md:flex">
      {/* Keeps the menu's place in the page; the menu itself floats so it can open over the page. */}
      <div className={`group no-print shrink-0 ${full('md:w-[72px]', 'xl:w-60')}`}>
        <aside
          className={`flex flex-col overflow-hidden bg-brand-950 text-white md:fixed md:inset-y-0 md:left-0 md:z-40 md:transition-[width] md:duration-150 md:group-hover:w-60 md:group-hover:shadow-2xl md:group-has-[:focus-visible]:w-60 ${full(
            'md:w-[72px]',
            'xl:w-60 xl:shadow-none',
          )}`}
        >
          <div className="h-1 shrink-0 bg-logo-yellow" aria-hidden />
          <div className={`flex items-center gap-3 px-5 py-4 ${full('md:px-3', 'xl:px-5')}`}>
            <img src="/logo.png" alt="IWMPC logo" className="h-12 w-12 shrink-0 rounded-full bg-white" />
            <div className={label}>
              <div className="text-xl font-bold leading-tight">IWMPC</div>
              <div className="whitespace-nowrap text-[11px] text-brand-100">Inicbulan Waterworks MPC</div>
            </div>
          </div>

          {/* Loans joins this menu in Phase 1C. */}
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:flex-col md:overflow-visible md:px-0 md:pb-0 md:pr-3" aria-label="Main menu">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navClass} aria-label={item.name}>
                <Icon path={item.icon} /> <span className={label}>{item.name}</span>
              </NavLink>
            ))}
          </nav>

          <button
            type="button"
            onClick={toggle}
            aria-expanded={!hidden}
            className={`mx-3 mt-3 hidden items-center gap-3 whitespace-nowrap rounded-lg border border-white/20 py-2 text-sm font-semibold text-brand-100 hover:bg-white/10 hover:text-white xl:flex ${
              hidden ? 'justify-center px-0 group-hover:justify-start group-hover:px-4 group-has-[:focus-visible]:justify-start group-has-[:focus-visible]:px-4' : 'px-4'
            }`}
          >
            <svg viewBox="0 0 24 24" className={`h-5 w-5 shrink-0 ${hidden ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M11 6l-6 6 6 6M19 6l-6 6 6 6" />
            </svg>
            <span className={hidden ? 'hidden group-hover:block group-has-[:focus-visible]:block' : ''}>{hidden ? 'Keep menu open' : 'Hide menu'}</span>
          </button>

          {/* Who is logged in. Opens My Profile. */}
          <div className="mt-auto hidden border-t border-white/10 py-3 md:block">
            <NavLink
              to="/profile"
              aria-label={`My Profile: ${user?.name ?? ''}`}
              className={({ isActive }) =>
                `mx-2 flex items-center gap-3 rounded-lg py-2 hover:bg-white/10 ${isActive ? 'bg-white/15' : ''} ${full(
                  'md:justify-center md:px-0 md:group-hover:justify-start md:group-hover:px-3 md:group-has-[:focus-visible]:justify-start md:group-has-[:focus-visible]:px-3',
                  'xl:justify-start xl:px-3',
                )}`
              }
            >
              <Avatar name={user?.name ?? ''} />
              <span className={`min-w-0 ${label}`}>
                <span className="block truncate font-semibold leading-tight">{user?.name}</span>
                <span className="block truncate text-sm text-brand-100">{user && ROLE[user.role]}</span>
              </span>
            </NavLink>
            <div className={`mt-1 gap-4 whitespace-nowrap px-5 text-sm ${full('md:hidden md:group-hover:flex md:group-has-[:focus-visible]:flex', 'xl:flex')}`}>
              {can('ADMIN') && (
                <NavLink to="/settings" className={footLink}>
                  Settings
                </NavLink>
              )}
              <button type="button" onClick={() => void logout()} className={footLink}>
                Log out
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-white/10 px-5 py-2 text-sm md:hidden">
            <NavLink to="/profile" className="flex items-center gap-2 font-semibold">
              <Avatar name={user?.name ?? ''} small /> {user?.name}
            </NavLink>
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
      </div>

      <main className="min-w-0 flex-1">
        <div className={`mx-auto px-4 py-5 sm:px-6 lg:px-8 print:max-w-none print:p-0 ${hidden ? 'max-w-none' : 'max-w-7xl'}`}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

/** A round badge with the user's initials. */
export function Avatar({ name, small = false, large = false }: { name: string; small?: boolean; large?: boolean }) {
  const words = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  const initials = ((words[0]?.[0] ?? '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase() || '?';
  const size = large ? 'h-16 w-16 text-2xl' : small ? 'h-7 w-7 text-xs' : 'h-10 w-10 text-sm';
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-logo-yellow font-bold text-brand-900 ${size}`} aria-hidden>
      {initials}
    </span>
  );
}
