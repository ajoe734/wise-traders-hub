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
  const { login, user, isAuthenticated, hasRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const from = (location.state as any)?.from?.pathname;

  // Auto-redirect when authenticated and profile is fully loaded
  useEffect(() => {
    if (!isAuthenticated || !user) return;

    if (from && pendingRedirect) {
      navigate(from, { replace: true });
    } else if (hasRole('company_admin')) {
      navigate('/company', { replace: true });
    } else if (user.expertSlug) {
      navigate(`/admin/${user.expertSlug}`, { replace: true });
    } else {
      navigate('/app', { replace: true });
    }
    setPendingRedirect(false);
    setIsLoading(false);
  }, [isAuthenticated, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const result = await login(email, password);

    if (result.success) {
      toast({
        title: '登入成功',
        description: '歡迎回來！',
      });
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
    toast({
      title: 'LINE 登入即將開放',
      description: '目前請先使用 Email 註冊登入，未來將提供 LINE 一鍵登入。',
    });
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
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">密碼</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
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
                <span className="ml-2 text-xs bg-[#06C755]/20 px-2 py-0.5 rounded-full">即將開放</span>
              </Button>

              <p className="text-center text-sm text-muted-foreground mt-6">
                還沒有帳號？{' '}
                <Link to="/auth/register" className="text-primary hover:underline">
                  免費註冊
                </Link>
              </p>

              {/* Demo hint */}
              <div className="mt-6 p-3 rounded-lg bg-muted text-sm">
                <p className="font-medium mb-2">測試帳號</p>
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">訂閱者：</span> demo@example.com / demo1234
                </p>
                <p className="text-muted-foreground mt-1">
                  <span className="font-medium text-foreground">分析師：</span> analyst@example.com / analyst1234
                </p>
                <p className="text-muted-foreground mt-1">
                  <span className="font-medium text-foreground">公司管理員：</span> admin@example.com / admin1234
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PortalLayout>
  );
};

export default Login;
