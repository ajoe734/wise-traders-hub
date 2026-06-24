export const actionLabels: Record<string, { label: string; className: string }> = {
  buy: { label: '買進', className: 'bg-success text-white border-success' },
  sell: { label: '賣出', className: 'bg-destructive text-white border-destructive' },
  add: { label: '加碼', className: 'bg-blue-500 text-blue-50 border-blue-500' },
  trim: { label: '減碼', className: 'bg-amber-500 text-amber-50 border-amber-500' },
  exit: { label: '平損', className: 'bg-slate-500 text-slate-50 border-slate-500' },
  hold: { label: '觀察', className: 'bg-muted text-muted-foreground border-border' },
  teaching: { label: '教學', className: 'bg-mentor/10 text-mentor border-mentor/30' },
};

export const stripDotPrefix = (text: string) =>
  text.replace(/^[•·．‧●○◆■□▪▫※☆★→➤➜▸▹►▻‣⁃–—\-]\s*/gm, '');
