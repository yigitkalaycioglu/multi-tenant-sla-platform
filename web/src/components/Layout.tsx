import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useTheme } from '../hooks/useTheme';
import { useTickets } from '../api/hooks';
import { ROLE_LABELS, initials } from '../lib/format';
import type { UserRole } from '../api/types';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  roles?: UserRole[];
  end?: boolean;
}

const NAV: Array<{ section: string; items: NavItem[] }> = [
  {
    section: 'Calisma alani',
    items: [
      { to: '/', label: 'Panel', icon: 'dashboard', end: true },
      { to: '/tickets', label: 'Biletler', icon: 'ticket' },
    ],
  },
  {
    section: 'Yonetim',
    items: [
      { to: '/teams', label: 'Ekipler', icon: 'team' },
      { to: '/users', label: 'Kullanicilar', icon: 'users', roles: ['admin'] },
      { to: '/sla', label: 'SLA politikalari', icon: 'sla' },
    ],
  },
];

const PAGE_META: Array<{ match: (path: string) => boolean; title: string; subtitle: string }> = [
  { match: (p) => p === '/', title: 'Panel', subtitle: 'SLA saglik durumu ve is yuku ozeti' },
  {
    match: (p) => p.startsWith('/tickets/'),
    title: 'Bilet detayi',
    subtitle: 'Zaman tuneli, yorumlar ve SLA saati',
  },
  { match: (p) => p.startsWith('/tickets'), title: 'Biletler', subtitle: 'Tum is kayitlari ve SLA durumlari' },
  { match: (p) => p.startsWith('/teams'), title: 'Ekipler', subtitle: 'Ekipler, liderler ve is yuku' },
  { match: (p) => p.startsWith('/users'), title: 'Kullanicilar', subtitle: 'Roller ve ekip atamalari' },
  { match: (p) => p.startsWith('/sla'), title: 'SLA politikalari', subtitle: 'Oncelik bazli yanit ve cozum hedefleri' },
];

export function Layout(): React.JSX.Element {
  const { user, logout, is } = useAuth();
  const { connected } = useSocket();
  const { theme, toggle } = useTheme();
  const location = useLocation();

  // Kenar cubugundaki ihlal rozeti icin kucuk bir sorgu.
  const breached = useTickets({ slaState: ['breached'], status: ['open', 'in_progress', 'on_hold'], pageSize: 1 });
  const breachedCount = breached.data?.total ?? 0;

  const meta = PAGE_META.find((entry) => entry.match(location.pathname));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">SLA</div>
          <div className="brand-text">
            <div className="brand-name">SLA Platform</div>
            <div className="brand-tenant" title={user?.tenantSlug}>
              {user?.tenantSlug}
            </div>
          </div>
        </div>

        {NAV.map((group) => {
          const items = group.items.filter((item) => !item.roles || (user && item.roles.includes(user.role)));
          if (items.length === 0) return null;

          return (
            <div key={group.section}>
              <div className="nav-section">{group.section}</div>
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                >
                  <Icon name={item.icon} size={17} />
                  {item.label}
                  {item.to === '/tickets' && breachedCount > 0 ? (
                    <span className="nav-badge" data-tone="critical" title="SLA suresi asilmis acik bilet">
                      {breachedCount}
                    </span>
                  ) : null}
                </NavLink>
              ))}
            </div>
          );
        })}

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="avatar">{user ? initials(user.fullName) : '?'}</div>
            <div className="user-meta">
              <div className="user-name">{user?.fullName}</div>
              <div className="user-role">{user ? ROLE_LABELS[user.role] : ''}</div>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void logout()}>
            <Icon name="logout" size={15} />
            Cikis yap
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <div className="page-title">{meta?.title ?? 'SLA Platform'}</div>
            <div className="page-subtitle">{meta?.subtitle}</div>
          </div>

          <div className="topbar-actions">
            {is('admin') ? (
              <span className="pill" data-tone="info" title="Yonetici yetkileri aktif">
                <Icon name="shield" size={11} />
                Yonetici
              </span>
            ) : null}

            <span className="live-dot" data-live={connected} title={connected ? 'Canli baglanti acik' : 'Baglanti yok'}>
              {connected ? 'Canli' : 'Baglaniyor'}
            </span>

            <button
              type="button"
              className="btn btn-ghost btn-icon"
              onClick={toggle}
              aria-label="Temayi degistir"
              title={`Tema: ${theme}`}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
            </button>
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
