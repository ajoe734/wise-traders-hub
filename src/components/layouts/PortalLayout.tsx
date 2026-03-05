import { ReactNode, useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { Menu, X, TrendingUp, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';

interface PortalLayoutProps {
  children: ReactNode;
  hideAppEntry?: boolean;
}

const navLinks = [
  { href: '/', label: '首頁' },
  { href: '/experts', label: '探索名師' },
  { href: '/pricing', label: '方案說明' },
  { href: '/legal', label: '法律聲明' },
];

export function PortalLayout({ children, hideAppEntry = false }: PortalLayoutProps) {
  const { user } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Header - White background */}
      <header className="sticky top-0 z-50 border-b border-border bg-card">
        <div className="container flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-foreground">
              <TrendingUp className="h-5 w-5 text-background" />
            </div>
            <span className="text-lg font-semibold text-foreground">智富股市實戰學院</span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                className={cn(
                  "text-sm font-medium transition-colors hover:text-cta",
                  location.pathname === link.href 
                    ? "text-foreground" 
                    : "text-muted-foreground"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Theme Toggle + Auth Buttons */}
          <div className="hidden md:flex items-center gap-3">
            {/* Theme Toggle */}
            {mounted && (
              <button
                onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all",
                  "border text-sm font-medium",
                  resolvedTheme === 'dark' 
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
                    : "bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200"
                )}
                aria-label={resolvedTheme === 'dark' ? '切換至淺色模式' : '切換至深色模式'}
              >
                {resolvedTheme === 'dark' ? (
                  <>
                    <Sun className="h-4 w-4" />
                    <span className="text-xs">淺色</span>
                  </>
                ) : (
                  <>
                    <Moon className="h-4 w-4" />
                    <span className="text-xs">夜間</span>
                  </>
                )}
              </button>
            )}
            {user && !hideAppEntry ? (
              <Button size="sm" asChild>
                <Link to="/app">進入會員區</Link>
              </Button>
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

          {/* Mobile: Theme Toggle + Menu Button */}
          <div className="md:hidden flex items-center gap-2">
            {/* Theme Toggle - Outside Menu */}
            {mounted && (
              <button
                onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
                className={cn(
                  "flex items-center justify-center w-9 h-9 rounded-full transition-all",
                  "border",
                  resolvedTheme === 'dark' 
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                    : "bg-slate-100 border-slate-200 text-slate-600"
                )}
                aria-label={resolvedTheme === 'dark' ? '切換至淺色模式' : '切換至深色模式'}
              >
                {resolvedTheme === 'dark' ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </button>
            )}
            {/* Mobile Menu Button */}
            <button
              className="p-2 -mr-2 text-foreground"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <X className="h-6 w-6" />
              ) : (
                <Menu className="h-6 w-6" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-card">
            <nav className="container py-4 space-y-2">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  to={link.href}
                  className={cn(
                    "block px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    location.pathname === link.href 
                      ? "bg-muted text-foreground" 
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
              <div className="border-t border-border pt-4 mt-4 space-y-2">
                {user ? (
                  <Link
                    to="/app"
                    className="block px-3 py-2 rounded-md text-sm font-medium bg-cta text-cta-foreground text-center"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    進入會員區
                  </Link>
                ) : (
                  <>
                    <Link
                      to="/auth/login"
                      className="block px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      登入
                    </Link>
                    <Link
                      to="/auth/register"
                      className="block px-3 py-2 rounded-md text-sm font-medium bg-cta text-cta-foreground text-center"
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
      <footer className="border-t border-border dark:border-white/10 bg-card dark:bg-white/[0.02]">
        <div className="container py-12">
          <div className="grid gap-8 md:grid-cols-4">
            <div className="md:col-span-2">
              <Link to="/" className="flex items-center gap-2 mb-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground">
                  <TrendingUp className="h-4 w-4 text-background" />
                </div>
                <span className="font-semibold text-foreground">智富股市實戰學院</span>
              </Link>
              <p className="text-sm text-muted-foreground dark:text-white/60 max-w-sm">
                穩健專業、誠信為本、教育為先。提供投顧分析師的即時策略服務與實戰導師的週記教學，幫助投資人建立自己的投資系統。
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4 text-foreground">服務</h4>
              <ul className="space-y-2 text-sm">
                <li><Link to="/experts?role=advisor" className="text-muted-foreground dark:text-white/60 hover:text-cta dark:hover:text-white transition-colors">投顧分析師</Link></li>
                <li><Link to="/experts?role=mentor" className="text-muted-foreground dark:text-white/60 hover:text-cta dark:hover:text-white transition-colors">實戰導師</Link></li>
                <li><Link to="/pricing" className="text-muted-foreground dark:text-white/60 hover:text-cta dark:hover:text-white transition-colors">方案比較</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4 text-foreground">關於我們</h4>
              <ul className="space-y-2 text-sm">
                <li><Link to="/legal" className="text-muted-foreground dark:text-white/60 hover:text-cta dark:hover:text-white transition-colors">法律聲明</Link></li>
                <li><Link to="/legal" className="text-muted-foreground dark:text-white/60 hover:text-cta dark:hover:text-white transition-colors">服務條款</Link></li>
                <li><Link to="/legal" className="text-muted-foreground dark:text-white/60 hover:text-cta dark:hover:text-white transition-colors">隱私政策</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border dark:border-white/10 mt-8 pt-8 text-center text-sm text-muted-foreground dark:text-white/50">
            © {new Date().getFullYear()} 智富股市實戰學院. 投資一定有風險，基金投資有賺有賠，申購前應詳閱公開說明書。
          </div>
        </div>
      </footer>
    </div>
  );
}
