import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card } from '@/components/ui/card';
import { Link } from 'react-router-dom';

/**
 * 通路分潤功能已停用。
 * 路由保留以避免外部連結 404，未來可移除。
 */
export default function CompanyReferralChannels() {
  return (
    <CompanyLayout>
      <div className="p-6 max-w-2xl mx-auto">
        <Card className="p-8 space-y-3">
          <h1 className="text-xl font-semibold">通路分潤功能已停用</h1>
          <p className="text-sm text-muted-foreground">
            被導流分潤（依 utm_source 動態調整分潤）已關閉。請改用「方案管理」對個別方案設定固定分潤覆寫。
          </p>
          <p className="text-sm">
            <Link to="/company/plans" className="text-primary underline">前往方案管理 →</Link>
          </p>
        </Card>
      </div>
    </CompanyLayout>
  );
}
