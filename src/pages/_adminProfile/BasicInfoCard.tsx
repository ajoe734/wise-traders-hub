import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

interface Props {
  name: string;
  bio: string;
  description: string;
  isAdvisor: boolean;
  isReadOnly: boolean;
  setName: (v: string) => void;
  setBio: (v: string) => void;
  setDescription: (v: string) => void;
}

export default function BasicInfoCard({
  name, bio, description, isAdvisor, isReadOnly,
  setName, setBio, setDescription,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">基本資訊</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>姓名</Label>
            <Input value={name} onChange={e => setName(e.target.value)} disabled={isReadOnly} />
          </div>
          <div className="space-y-2">
            <Label>角色</Label>
            <div className="flex items-center h-9">
              <Badge variant={isAdvisor ? 'advisor' : 'mentor'}>
                {isAdvisor ? '投顧分析師' : '實戰導師'}
              </Badge>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <Label>簡介</Label>
          <Input value={bio} onChange={e => setBio(e.target.value)} disabled={isReadOnly} />
        </div>
        <div className="space-y-2">
          <Label>詳細介紹</Label>
          <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} disabled={isReadOnly} />
        </div>
      </CardContent>
    </Card>
  );
}
