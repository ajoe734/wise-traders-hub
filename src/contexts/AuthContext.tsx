import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '@/types';
import { demoUser } from '@/data/mockData';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (email: string, password: string, name: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
AuthContext.displayName = 'AuthContext';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing session
    const storedUser = localStorage.getItem('auth_user');
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch {
        localStorage.removeItem('auth_user');
      }
    } else if (window.location.pathname.startsWith('/line/')) {
      // Auto-login demo user for LINE version preview
      setUser(demoUser);
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // For MVP: accept demo credentials or any valid-looking email
    if (email === 'demo@example.com' && password === 'demo1234') {
      setUser(demoUser);
      localStorage.setItem('auth_user', JSON.stringify(demoUser));
      return { success: true };
    }

    // Accept any email/password for demo purposes
    if (email && password && password.length >= 6) {
      const newUser: User = {
        id: `user-${Date.now()}`,
        email,
        name: email.split('@')[0],
        createdAt: new Date(),
      };
      setUser(newUser);
      localStorage.setItem('auth_user', JSON.stringify(newUser));
      return { success: true };
    }

    return { success: false, error: '請輸入有效的電子郵件和密碼（至少6位）' };
  };

  const register = async (email: string, password: string, name: string): Promise<{ success: boolean; error?: string }> => {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 500));

    if (!email || !email.includes('@')) {
      return { success: false, error: '請輸入有效的電子郵件' };
    }

    if (!password || password.length < 6) {
      return { success: false, error: '密碼至少需要6位字元' };
    }

    if (!name || name.length < 2) {
      return { success: false, error: '請輸入您的姓名' };
    }

    const newUser: User = {
      id: `user-${Date.now()}`,
      email,
      name,
      createdAt: new Date(),
    };

    setUser(newUser);
    localStorage.setItem('auth_user', JSON.stringify(newUser));
    return { success: true };
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('auth_user');
  };

  const isAuthenticated = !!user;

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
