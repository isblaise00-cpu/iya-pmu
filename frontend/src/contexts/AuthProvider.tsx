import { useState, useEffect, ReactNode } from 'react';
import { api, setStoredToken, clearStoredToken } from '../lib/api';
import { AuthContext, AuthUser } from './AuthContext';

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.get('/auth/me')
      .then((r) => { if (active) setUser(r.data.user); })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const login = async (email: string, password: string) => {
    const r = await api.post('/auth/login', { email, password });
    setStoredToken(r.data.token);
    setUser(r.data.user);
  };

  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    clearStoredToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
