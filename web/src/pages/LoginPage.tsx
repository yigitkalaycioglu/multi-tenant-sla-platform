import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../components/Icon';
import { ErrorNote } from '../components/ui';

const DEMO_ACCOUNTS = [
  { tenantSlug: 'kuzey', email: 'admin@kuzey.io', label: 'Kuzey / Yonetici' },
  { tenantSlug: 'kuzey', email: 'mert@kuzey.io', label: 'Kuzey / Ekip lideri' },
  { tenantSlug: 'kuzey', email: 'burak@kuzey.io', label: 'Kuzey / Gelistirici' },
  { tenantSlug: 'acme', email: 'admin@acme.com', label: 'Acme / Yonetici' },
];

const HIGHLIGHTS = [
  'PostgreSQL Row Level Security ile veritabani seviyesinde kiraci izolasyonu',
  'JWT + rol tabanli erisim kontrolu (yonetici, ekip lideri, gelistirici)',
  'Socket.io ile canli bilet ve SLA guncellemeleri',
  'BullMQ kuyrugu ile geciken isler icin otomatik e-posta bildirimi',
];

export function LoginPage(): React.JSX.Element {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [tenantSlug, setTenantSlug] = useState('kuzey');
  const [email, setEmail] = useState('admin@kuzey.io');
  const [password, setPassword] = useState('Passw0rd!');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ tenantSlug: tenantSlug.trim().toLowerCase(), email: email.trim(), password });
      void navigate('/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div className="row" style={{ gap: 10 }}>
          <div className="brand-mark">SLA</div>
          <div className="strong">SLA Platform</div>
        </div>

        <h1 className="auth-headline">Cok kiracili is takip ve SLA yonetimi</h1>
        <p className="auth-lead">
          Kurumsal ekipler icin bilet takibi, oncelik bazli SLA hedefleri ve gecikme oncesi otomatik uyari.
        </p>

        <div className="auth-points">
          {HIGHLIGHTS.map((point) => (
            <div key={point} className="auth-point">
              <Icon name="check" size={15} />
              <span>{point}</span>
            </div>
          ))}
        </div>
      </aside>

      <div className="auth-main">
        <form className="auth-card" onSubmit={(event) => void submit(event)}>
          <div>
            <h2 className="auth-title">Giris yap</h2>
            <p className="auth-sub">Kiraci kisa adiniz ve kurumsal e-postanizla oturum acin.</p>
          </div>

          <ErrorNote error={error} />

          <div className="field">
            <label className="label" htmlFor="tenant">
              Kiraci kisa adi
            </label>
            <input
              id="tenant"
              className="input"
              value={tenantSlug}
              onChange={(event) => setTenantSlug(event.target.value)}
              placeholder="orn. kuzey"
              autoComplete="organization"
              required
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="email">
              E-posta
            </label>
            <input
              id="email"
              className="input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="password">
              Sifre
            </label>
            <input
              id="password"
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Giris yapiliyor...' : 'Giris yap'}
          </button>

          <div className="demo-box">
            <div className="strong" style={{ marginBottom: 2 }}>
              Demo hesaplari
            </div>
            Sifre: <code>Passw0rd!</code> — farkli rollerle deneyin. Iki ayri kiraci vardir; birinin verisi
            digerinde gorunmez.
            <div className="demo-row">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setTenantSlug(account.tenantSlug);
                    setEmail(account.email);
                    setPassword('Passw0rd!');
                  }}
                >
                  {account.label}
                </button>
              ))}
            </div>
          </div>

          <p className="small muted">
            Yeni bir kiraci mi olusturacaksiniz? <Link to="/register">Kayit olun</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
