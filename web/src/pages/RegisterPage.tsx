import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';
import { Icon } from '../components/Icon';
import { ErrorNote } from '../components/ui';

const slugify = (value: string): string =>
  value
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export function RegisterPage(): React.JSX.Element {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [tenantName, setTenantName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const fieldErrors = error instanceof ApiError ? error.fieldErrors : [];
  const errorFor = (field: string): string | undefined =>
    fieldErrors.find((issue) => issue.field === field)?.message;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register({
        tenantName: tenantName.trim(),
        slug: (slugTouched ? slug : slugify(tenantName)).trim(),
        adminName: adminName.trim(),
        adminEmail: adminEmail.trim().toLowerCase(),
        password,
      });
      void navigate('/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const effectiveSlug = slugTouched ? slug : slugify(tenantName);

  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div className="row" style={{ gap: 10 }}>
          <div className="brand-mark">SLA</div>
          <div className="strong">SLA Platform</div>
        </div>
        <h1 className="auth-headline">Kurumunuz icin izole bir calisma alani</h1>
        <p className="auth-lead">
          Kayit olurken kiraci, varsayilan SLA politikalari, bilet numaratoru ve yonetici hesabiniz TEK bir
          veritabani transaction'inda olusturulur — adimlardan biri basarisiz olursa hicbiri kalmaz.
        </p>
        <div className="auth-points">
          <div className="auth-point">
            <Icon name="check" size={15} />
            <span>Acil / Yuksek / Orta / Dusuk oncelikleri icin hazir SLA hedefleri</span>
          </div>
          <div className="auth-point">
            <Icon name="check" size={15} />
            <span>Verileriniz Row Level Security ile diger kiracilardan yalitilir</span>
          </div>
        </div>
      </aside>

      <div className="auth-main">
        <form className="auth-card" onSubmit={(event) => void submit(event)}>
          <div>
            <h2 className="auth-title">Kiraci olustur</h2>
            <p className="auth-sub">Ilk kullanici otomatik olarak yonetici yetkisi alir.</p>
          </div>

          <ErrorNote error={error} />

          <div className="field">
            <label className="label" htmlFor="tenantName">
              Sirket adi
            </label>
            <input
              id="tenantName"
              className="input"
              value={tenantName}
              onChange={(event) => setTenantName(event.target.value)}
              placeholder="Kuzey Teknoloji A.S."
              required
            />
            {errorFor('tenantName') ? <span className="field-error">{errorFor('tenantName')}</span> : null}
          </div>

          <div className="field">
            <label className="label" htmlFor="slug">
              Kiraci kisa adi (slug)
            </label>
            <input
              id="slug"
              className="input"
              value={effectiveSlug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value);
              }}
              placeholder="kuzey-teknoloji"
              pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
              required
            />
            <span className="hint">Giris ekraninda bu kisa ad kullanilir. Kucuk harf, rakam ve tire.</span>
            {errorFor('slug') ? <span className="field-error">{errorFor('slug')}</span> : null}
          </div>

          <div className="field">
            <label className="label" htmlFor="adminName">
              Ad soyad
            </label>
            <input
              id="adminName"
              className="input"
              value={adminName}
              onChange={(event) => setAdminName(event.target.value)}
              autoComplete="name"
              required
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="adminEmail">
              E-posta
            </label>
            <input
              id="adminEmail"
              className="input"
              type="email"
              value={adminEmail}
              onChange={(event) => setAdminEmail(event.target.value)}
              autoComplete="email"
              required
            />
            {errorFor('adminEmail') ? <span className="field-error">{errorFor('adminEmail')}</span> : null}
          </div>

          <div className="field">
            <label className="label" htmlFor="newPassword">
              Sifre
            </label>
            <input
              id="newPassword"
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
            <span className="hint">En az 8 karakter, bir harf ve bir rakam.</span>
            {errorFor('password') ? <span className="field-error">{errorFor('password')}</span> : null}
          </div>

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Olusturuluyor...' : 'Kiraci olustur'}
          </button>

          <p className="small muted">
            Zaten hesabiniz var mi? <Link to="/login">Giris yapin</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
