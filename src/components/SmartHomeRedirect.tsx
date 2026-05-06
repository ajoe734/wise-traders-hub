import { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Wraps the public landing page.
 * 所有人（含 company_admin / analyst）都可直接檢視公開首頁。
 * 管理者要進後台，從 Header 主動點選即可，不再自動導向 /company。
 */
export function SmartHomeRedirect({ children }: { children: ReactNode }) {
  const { isLoading } = useAuth();
  if (isLoading) return null;
  return <>{children}</>;
}
