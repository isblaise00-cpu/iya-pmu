import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AuthProvider from './contexts/AuthProvider';
import ProtectedRoute from './components/layout/ProtectedRoute';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Pronostics from './pages/Pronostics';
import Subscribers from './pages/Subscribers';
import Plans from './pages/Plans';
import SMS from './pages/SMS';
import Results from './pages/Results';
import SettingsPage from './pages/Settings';
import Users from './pages/Users';
import SportsPronostics from './pages/SportsPronostics';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/pronostics" element={<Pronostics />} />
              <Route path="/subscribers" element={<Subscribers />} />
              <Route path="/plans" element={<Plans />} />
              <Route path="/sms" element={<SMS />} />
              <Route path="/results" element={<Results />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/users" element={<Users />} />
              <Route path="/sports/:sport" element={<SportsPronostics />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
