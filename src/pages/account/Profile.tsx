import { Link } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { User, Mail, MessageCircle } from 'lucide-react';

const AccountProfile = () => {
  const { user, isAuthenticated, logout } = useAuth();

  if (!isAuthenticated || !user) {
    return (
      <PortalLayout>
        <div className="container py-12 text-center">
          <h1 className="text-2xl font-bold mb-4">請先登入</h1>
          <Button asChild>
            <Link to="/auth/login">前往登入</Link>
          </Button>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="container py-8 md:py-12 max-w-2xl">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-2">個人資料</h1>
          <p className="text-muted-foreground">
            管理你的帳號設定
          </p>
        </div>

        <div className="space-y-6">
          {/* Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="h-5 w-5" />
                基本資料
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">姓名</Label>
                <Input id="name" defaultValue={user.displayName || ''} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" defaultValue={user.email} disabled />
                <p className="text-xs text-muted-foreground">Email 無法修改</p>
              </div>
              <Button>儲存變更</Button>
            </CardContent>
          </Card>

          {/* LINE Connection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
                LINE 綁定
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                <div>
                  <p className="font-medium">LINE 帳號</p>
                  <p className="text-sm text-muted-foreground">尚未綁定</p>
                </div>
                <Button variant="outline" disabled>
                  綁定 LINE（即將開放）
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                綁定後可透過 LINE 接收即時訊號通知
              </p>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex gap-4">
            <Button variant="outline" asChild>
              <Link to="/account/subscriptions">查看訂閱</Link>
            </Button>
            <Button variant="destructive" onClick={logout}>
              登出
            </Button>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
};

export default AccountProfile;