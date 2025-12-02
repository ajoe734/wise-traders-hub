import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { Menu, X, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface PortalLayoutProps {
  children: ReactNode;
}

const navLinks = [
  { href: '/', label: '首頁' },
  { href: '/explore', label: '探索' },
  { href: '/pricing', label: '方案與價格' },
  { href: '/legal', label: '法律聲明' },
];

export function PortalLayout({ children }: PortalLayoutProps) {
  const { user } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-hero">
              <TrendingUp className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-semibold text-foreground">智富投顧</span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                className={cn(
                  "text-sm font-medium transition-colors hover:text-primary",
                  location.pathname === link.href 
                    ? "text-primary" 
                    : "text-muted-foreground"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Auth Buttons */}
          <div className="hidden md:flex items-center gap-3">
            {user ? (
              <>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/me">我的帳號</Link>
                </Button>
                <Button size="sm" asChild>
                  <Link to="/app">進入會員區</Link>
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/auth/login">登入</Link>
                </Button>
                <Button size="sm" asChild>
                  <Link to="/auth/register">免費註冊</Link>
                </Button>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2 -mr-2"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? (
              <X className="h-6 w-6" />
            ) : (
              <Menu className="h-6 w-6" />
            )}
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t bg-background">
            <nav className="container py-4 space-y-2">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  to={link.href}
                  className={cn(
                    "block px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    location.pathname === link.href 
                      ? "bg-primary/10 text-primary" 
                      : "text-muted-foreground hover:bg-muted"
                  )}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
              <div className="border-t pt-4 mt-4 space-y-2">
                {user ? (
                  <>
                    <Link
                      to="/me"
                      className="block px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      我的帳號
                    </Link>
                    <Link
                      to="/app"
                      className="block px-3 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground text-center"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      進入會員區
                    </Link>
                  </>
                ) : (
                  <>
                    <Link
                      to="/auth/login"
                      className="block px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      登入
                    </Link>
                    <Link
                      to="/auth/register"
                      className="block px-3 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground text-center"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      免費註冊
                    </Link>
                  </>
                )}
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main>{children}</main>

      {/* Footer */}
      <footer className="border-t bg-muted/30">
        <div className="container py-12">
          <div className="grid gap-8 md:grid-cols-4">
            <div className="md:col-span-2">
              <Link to="/" className="flex items-center gap-2 mb-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-hero">
                  <TrendingUp className="h-4 w-4 text-primary-foreground" />
                </div>
                <span className="font-semibold">智富投顧</span>
              </Link>
              <p className="text-sm text-muted-foreground max-w-sm">
                穩健專業、誠信為本、教育為先。提供投顧分析師的即時策略服務與實戰導師的週記教學，幫助投資人建立自己的投資系統。
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">服務</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link to="/explore?role=advisor" className="hover:text-foreground">投顧分析師</Link></li>
                <li><Link to="/explore?role=mentor" className="hover:text-foreground">實戰導師</Link></li>
                <li><Link to="/pricing" className="hover:text-foreground">方案比較</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">關於我們</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link to="/legal" className="hover:text-foreground">法律聲明</Link></li>
                <li><Link to="/legal" className="hover:text-foreground">服務條款</Link></li>
                <li><Link to="/legal" className="hover:text-foreground">隱私政策</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t mt-8 pt-8 text-center text-sm text-muted-foreground">
            © {new Date().getFullYear()} 智富投顧. 投資一定有風險，基金投資有賺有賠，申購前應詳閱公開說明書。
          </div>
        </div>
      </footer>
    </div>
  );
}
