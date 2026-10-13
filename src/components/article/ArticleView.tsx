import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  orientationOf,
  type ArticleBlock,
  type ArticleLayout,
  type ImageOrientation,
} from '@/lib/articleLayout';

/** 固定比例相框：橫圖 16:10、直圖 3:4、方圖 1:1；不拉伸、不裁切，空白補紙灰底。 */
export function FramedImage({
  src,
  alt,
  hero,
  onOrientation,
}: {
  src: string;
  alt?: string;
  hero?: boolean;
  onOrientation?: (o: ImageOrientation, w: number) => void;
}) {
  const [o, setO] = useState<ImageOrientation>('landscape');
  const [failed, setFailed] = useState(false);
  const aspect = hero
    ? 'aspect-[16/9]'
    : o === 'portrait'
      ? 'aspect-[3/4]'
      : o === 'square'
        ? 'aspect-square'
        : 'aspect-[16/10]';
  return (
    <figure className="m-0">
      <div className={cn('w-full overflow-hidden rounded-xl bg-muted', aspect)}>
        {failed ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">圖片無法載入</div>
        ) : (
          <img
            src={src}
            alt={alt || ''}
            loading="lazy"
            className="h-full w-full object-contain"
            onError={() => setFailed(true)}
            onLoad={(e) => {
              const im = e.currentTarget;
              const next = orientationOf(im.naturalWidth, im.naturalHeight);
              setO(next);
              onOrientation?.(next, im.naturalWidth);
            }}
          />
        )}
      </div>
      {alt && !/\.(png|jpe?g|webp|gif|heic)$/i.test(alt) && (
        <figcaption className="mt-1.5 text-xs text-muted-foreground">{alt}</figcaption>
      )}
    </figure>
  );
}

/** 連續圖片自動並排（兩張一列）。 */
function ImageRun({ imgs }: { imgs: ArticleBlock[] }) {
  if (imgs.length === 1) return <FramedImage src={imgs[0].src!} alt={imgs[0].alt} />;
  return (
    <div className="grid grid-cols-2 gap-3">
      {imgs.map((b, i) => <FramedImage key={i} src={b.src!} alt={b.alt} />)}
    </div>
  );
}

function TextBlock({ b }: { b: ArticleBlock }) {
  switch (b.type) {
    case 'h2':
      return <h2 className="font-serif text-2xl font-bold leading-snug text-foreground mt-8 mb-3 sm:text-[26px]" dangerouslySetInnerHTML={{ __html: b.html }} />;
    case 'h3':
      return <h3 className="font-serif text-xl font-bold leading-snug text-foreground mt-6 mb-2" dangerouslySetInnerHTML={{ __html: b.html }} />;
    case 'h4':
      return (
        <p className="my-5 border-l-2 border-primary pl-4 text-lg font-bold leading-relaxed text-foreground" dangerouslySetInnerHTML={{ __html: b.html }} />
      );
    case 'quote':
      return (
        <blockquote className="my-6 border-y border-border py-4 text-center font-serif text-lg leading-relaxed text-foreground" dangerouslySetInnerHTML={{ __html: b.html }} />
      );
    case 'list':
      return <div className="my-3 text-[15px] leading-8 text-foreground [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: b.html }} />;
    case 'hr':
      return <hr className="my-8 border-border" />;
    default:
      return <p className="my-3 text-[15px] leading-8 text-foreground [&_a]:text-primary [&_a]:underline [&_strong]:font-bold" dangerouslySetInnerHTML={{ __html: b.html }} />;
  }
}

/** 依序渲染區塊，連續圖片併成一列。 */
function Flow({ blocks }: { blocks: ArticleBlock[] }) {
  const out: ReactNode[] = [];
  let run: ArticleBlock[] = [];
  const flush = (k: number) => {
    if (run.length) {
      for (let i = 0; i < run.length; i += 2) out.push(<div key={`r${k}-${i}`} className="my-5"><ImageRun imgs={run.slice(i, i + 2)} /></div>);
      run = [];
    }
  };
  blocks.forEach((b, i) => {
    if (b.type === 'img') run.push(b);
    else { flush(i); out.push(<TextBlock key={i} b={b} />); }
  });
  flush(blocks.length);
  return <>{out}</>;
}

interface ArticleViewProps {
  layout: ArticleLayout;
  title: string;
  lede?: string;
  blocks: ArticleBlock[];
  meta?: ReactNode;
  className?: string;
}

function Header({ title, lede, meta, center }: { title: string; lede?: string; meta?: ReactNode; center?: boolean }) {
  return (
    <header className={cn('mb-6', center && 'text-center')}>
      <h1 className="font-serif text-[28px] font-bold leading-tight text-foreground sm:text-[34px] article-title">{title || '（未命名文章）'}</h1>
      {meta && <div className="mt-2 text-xs text-muted-foreground">{meta}</div>}
      {lede && <p className="mt-4 text-lg font-light leading-relaxed text-muted-foreground">{lede}</p>}
      <div className="mt-5 h-px bg-border" />
    </header>
  );
}

export function ArticleView({ layout, title, lede, blocks, meta, className }: ArticleViewProps) {
  if (layout === 'alternating') {
    // 首張圖之前的文字為導言；之後每張圖搭配到下一張圖之前的文字。
    const pre: ArticleBlock[] = [];
    const segs: { img: ArticleBlock; text: ArticleBlock[] }[] = [];
    blocks.forEach((b) => {
      if (b.type === 'img') segs.push({ img: b, text: [] });
      else if (segs.length) segs[segs.length - 1].text.push(b);
      else pre.push(b);
    });
    return (
      <article className={cn('mx-auto max-w-4xl', className)}>
        <Header title={title} lede={lede} meta={meta} center />
        <div className="mx-auto max-w-2xl"><Flow blocks={pre} /></div>
        {segs.map((s, i) => (
          <section key={i} className="grid items-center gap-6 border-t border-border py-8 md:grid-cols-2">
            <div className={cn(i % 2 === 1 && 'md:order-2')}><FramedImage src={s.img.src!} alt={s.img.alt} /></div>
            <div><Flow blocks={s.text} /></div>
          </section>
        ))}
      </article>
    );
  }

  if (layout === 'gallery') {
    const firstImg = blocks.findIndex((b) => b.type === 'img');
    const hero = firstImg >= 0 ? blocks[firstImg] : null;
    const rest = blocks.filter((_, i) => i !== firstImg);
    const out: ReactNode[] = [];
    let run: ArticleBlock[] = [];
    const flush = (k: number) => {
      if (!run.length) return;
      out.push(
        <div key={`g${k}`} className={cn('my-6 grid gap-3', run.length === 1 ? 'grid-cols-1' : run.length === 2 ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3')}>
          {run.map((b, j) => <FramedImage key={j} src={b.src!} alt={b.alt} />)}
        </div>,
      );
      run = [];
    };
    rest.forEach((b, i) => {
      if (b.type === 'img') run.push(b);
      else { flush(i); out.push(<TextBlock key={i} b={b} />); }
    });
    flush(rest.length);
    return (
      <article className={cn('mx-auto max-w-5xl', className)}>
        {hero && <div className="mb-6"><FramedImage src={hero.src!} alt={hero.alt} hero /></div>}
        <Header title={title} lede={lede} meta={meta} />
        {out}
      </article>
    );
  }

  if (layout === 'cards') {
    const pre: ArticleBlock[] = [];
    const cards: { head: ArticleBlock; body: ArticleBlock[] }[] = [];
    blocks.forEach((b) => {
      if (b.type === 'h2' || b.type === 'h3') cards.push({ head: b, body: [] });
      else if (cards.length) cards[cards.length - 1].body.push(b);
      else pre.push(b);
    });
    return (
      <article className={cn('mx-auto max-w-5xl', className)}>
        <Header title={title} lede={lede} meta={meta} />
        {pre.length > 0 && <div className="max-w-2xl"><Flow blocks={pre} /></div>}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {cards.map((c, i) => (
            <section key={i} className="rounded-3xl bg-muted/60 p-6">
              <div className="font-serif text-4xl font-bold text-primary">{String(i + 1).padStart(2, '0')}</div>
              <h3 className="mt-2 font-serif text-xl font-bold text-foreground" dangerouslySetInnerHTML={{ __html: c.head.html }} />
              <Flow blocks={c.body} />
            </section>
          ))}
        </div>
      </article>
    );
  }

  return (
    <article className={cn('mx-auto max-w-2xl', className)}>
      <Header title={title} lede={lede} meta={meta} />
      <Flow blocks={blocks} />
    </article>
  );
}
