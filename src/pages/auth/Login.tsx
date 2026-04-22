import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Loader2, MessageCircle } from 'lucide-react';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingRedirect, setPendingRedirect] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const { login, user, isAuthenticated, hasRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  // Auto-redirect only after successful login/profile load
  useEffect(() => {
    if (!pendingRedirect || !isAuthenticated || !user) return;

    // Check sessionStorage for redirect target (survives page refresh)
    const savedRedirect = sessionStorage.getItem('redirect_after_login');
    sessionStorage.removeItem('redirect_after_login');

    if (savedRedirect) {
      navigate(savedRedirect, { replace: true });
    } else if (hasRole('company_admin')) {
      navigate('/company', { replace: true });
    } else if (user.expertSlug) {
      navigate(`/admin/${user.expertSlug}`, { replace: true });
    } else {
      navigate('/app', { replace: true });
    }

    setPendingRedirect(false);
    setIsLoading(false);
  }, [pendingRedirect, isAuthenticated, user, hasRole, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: { email?: string; password?: string } = {};
    if (!email.trim()) errors.email = '請輸入電子郵件';
    if (!password) errors.password = '請輸入密碼';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setIsLoading(true);

    const result = await login(email, password);

    if (result.success) {
      setPendingRedirect(true);
    } else {
      toast({
        title: '登入失敗',
        description: result.error,
        variant: 'destructive',
      });
      setIsLoading(false);
    }
  };

  const handleLineLogin = () => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const callbackUrl = `${supabaseUrl}/functions/v1/line-login-callback`;
    // LINE login from /auth/login → redirect to /app after success
    const fromLocation = (location as any).state?.from;
    const returnTo = fromLocation
      ? `${fromLocation.pathname || ''}${fromLocation.search || ''}${fromLocation.hash || ''}`
      : '/app';
    // Persist LINE return target in case the query string is lost during the OAuth round-trip
    sessionStorage.setItem('line_login_return_to', returnTo);
    const appOrigin = window.location.origin;
    const authorizeUrl = `${supabaseUrl}/functions/v1/line-login-authorize?redirect_uri=${encodeURIComponent(callbackUrl)}&return_to=${encodeURIComponent(returnTo)}&app_origin=${encodeURIComponent(appOrigin)}`;
    console.log('[LINE-LOGIN] Login page → LINE authorize', { returnTo, appOrigin, authorizeUrl });
    window.location.href = authorizeUrl;
  };

  return (
    <PortalLayout>
      <div className="container py-12 md:py-20">
        <div className="max-w-md mx-auto">
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">登入</CardTitle>
              <CardDescription>
                登入您的帳號以使用會員服務
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">電子郵件</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setFieldErrors(prev => ({ ...prev, email: undefined })); }}
                    className={fieldErrors.email ? 'border-destructive' : ''}
                    required
                  />
                  {fieldErrors.email && <p className="text-xs text-destructive mt-1">{fieldErrors.email}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">密碼</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setFieldErrors(prev => ({ ...prev, password: undefined })); }}
                    className={fieldErrors.password ? 'border-destructive' : ''}
                    required
                  />
                  {fieldErrors.password && <p className="text-xs text-destructive mt-1">{fieldErrors.password}</p>}
                </div>

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      登入中...
                    </>
                  ) : (
                    '登入'
                  )}
                </Button>
              </form>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">或</span>
                </div>
              </div>

              <Button 
                type="button" 
                variant="outline" 
                className="w-full bg-[#06C755]/10 border-[#06C755]/30 text-[#06C755] hover:bg-[#06C755]/20 hover:border-[#06C755]/50"
                onClick={handleLineLogin}
              >
                <MessageCircle className="h-4 w-4 mr-2" />
                使用 LINE 快速登入
              </Button>

              <p className="text-center text-sm text-muted-foreground mt-6">
                還沒有帳號？{' '}
                <Link to="/auth/register" className="text-primary hover:underline">
                  免費註冊
                </Link>
              </p>

            </CardContent>
          </Card>
        </div>
      </div>
    </PortalLayout>
  );
};

export default Login;
