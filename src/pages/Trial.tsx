import { PortalLayout } from '@/components/layouts/PortalLayout';

const TRIAL_URL = 'https://demo.example.com'; // TODO: 替換為對方提供的正式 URL

export default function Trial() {
  return (
    <PortalLayout>
      <div className="w-full" style={{ height: 'calc(100vh - 4rem)' }}>
        <iframe
          src={TRIAL_URL}
          title="免費健檢"
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          allow="clipboard-write"
        />
      </div>
    </PortalLayout>
  );
}
