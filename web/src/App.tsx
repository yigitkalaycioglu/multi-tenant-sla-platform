import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useAuth } from './context/AuthContext';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { SlaPage } from './pages/SlaPage';
import { TeamsPage } from './pages/TeamsPage';
import { TicketDetailPage } from './pages/TicketDetailPage';
import { TicketsPage } from './pages/TicketsPage';
import { UsersPage } from './pages/UsersPage';

function Splash(): React.JSX.Element {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <div className="col" style={{ alignItems: 'center', gap: 12 }}>
        <div className="brand-mark" style={{ width: 40, height: 40 }}>
          SLA
        </div>
        <span className="muted small">Oturum kontrol ediliyor...</span>
      </div>
    </div>
  );
}

export function App(): React.JSX.Element {
  const { user, booting, is } = useAuth();

  if (booting) return <Splash />;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="tickets" element={<TicketsPage />} />
        <Route path="tickets/:id" element={<TicketDetailPage />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="sla" element={<SlaPage />} />
        <Route path="users" element={is('admin') ? <UsersPage /> : <Navigate to="/" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
