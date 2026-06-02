import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { UserPlus } from 'lucide-react';

interface Props {
  open: boolean;
  setOpen: (v: boolean) => void;
  email: string; setEmail: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  name: string; setName: (v: string) => void;
  slug: string; setSlug: (v: string) => void;
  role: string; setRole: (v: string) => void;
  creating: boolean;
  clearForm: () => void;
  onCreate: () => void;
}

export function CreateAnalystDialog({
  open, setOpen, email, setEmail, password, setPassword,
  name, setName, slug, setSlug, role, setRole, creating, clearForm, onCreate,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-company hover:bg-company/90 text-white" onClick={() => { clearForm(); setOpen(true); }}>
          <UserPlus className="h-4 w-4 mr-2" />新增分析師
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>新增分析師帳號</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="analyst@example.com" type="email" />
          </div>
          <div className="space-y-2">
            <Label>密碼</Label>
            <Input value={password} onChange={e => setPassword(e.target.value)} placeholder="至少 6 位" type="password" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>姓名</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="趙鵬博" />
            </div>
            <div className="space-y-2">
              <Label>Slug（URL識別）</Label>
              <Input value={slug} onChange={e => setSlug(e.target.value)} placeholder="zhao-pengbo" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>角色</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue placeholder="選擇角色" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="advisor">投顧分析師</SelectItem>
                <SelectItem value="mentor">實戰導師</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={onCreate} disabled={creating}>{creating ? '建立中...' : '建立帳號'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
