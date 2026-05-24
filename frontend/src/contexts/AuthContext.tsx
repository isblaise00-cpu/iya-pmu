import { createContext, useContext } from 'react';

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER';

export interface AuthUser {
  userId: number;
  email: string;
  name: string;
  role: UserRole;
}

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
