import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { User, MessageCircle, Settings, ExternalLink } from 'lucide-react';

const Account = () => {
  const { user } = useAuth();

  return (
    <AppLayout>
      <div className="p-4 space-y-4">
        <h1 className="text-xl font-bold">帳號設定</h1>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="font-semibold">{user?.name || '會員'}</p>
                <p className="text-sm text-muted-foreground">{user?.email}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <MessageCircle className="h-4 w-4" /> LINE 綁定
            </h2>
            <p className="text-sm text-muted-foreground mb-3">尚未綁定</p>
            <Button variant="outline" size="sm" disabled className="w-full">
              預留：綁定 LINE（尚未開放）
            </Button>
            <p className="text-xs text-muted-foreground mt-2">未來將提供 LINE 推播通知與快速登入</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <Link to="/account/subscriptions" className="flex items-center justify-between p-2 rounded-lg hover:bg-muted transition-colors">
              <span className="text-sm flex items-center gap-2">
                <Settings className="h-4 w-4" /> 管理訂閱
              </span>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Account;
