import jsPDF from 'jspdf';
import html2canvas from 'html2canvas-pro';
import { format } from 'date-fns';
import { richHtmlToPlain } from '@/components/SafeRichHtml';

interface Signal {
  id: string;
  instrument: string;
  action: string;
  price_hint: number | null;
  quantity: number | null;
  quantity_unit: string | null;
  reason_summary: string | null;
  reason_detail: string | null;
  risk_notes: string | null;
  learning_points: string | null;
  published_at: string;
  experts: {
    name: string;
    slug: string;
    role: string;
    avatar_url: string | null;
  };
}

interface ExportArgs {
  headSignal: Signal;
  weekSignals: Signal[];
  weekStart: Date;
  weekEnd: Date;
  weekTitle: string;
  learningPoints: string[];
  avatarSrc: string;
}

const COLORS = {
  ink: '#292520',
  paper: '#F5F3EF',
  brand: '#EC662D',
  gray: '#8A857C',
  line: '#E4DFD6',
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const actionMeta = (action: string) => {
  const a = (action || '').toLowerCase();
  if (a.includes('buy') || a === '買進' || a === '加碼') return { label: 'BUY', bg: '#D94848', fg: '#FFFFFF' };
  if (a.includes('sell') || a === '賣出' || a === '減碼') return { label: 'SELL', bg: '#2E8B57', fg: '#FFFFFF' };
  return { label: action?.toUpperCase() || 'HOLD', bg: '#8A857C', fg: '#FFFFFF' };
};

const ensureFonts = async () => {
  const id = 'lf-pdf-fonts';
  if (!document.getElementById(id)) {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400&family=Noto+Sans+TC:wght@400;500;700&display=swap';
    document.head.appendChild(link);
  }
  try {
    // @ts-ignore
    await document.fonts.ready;
    // Explicitly warm up to make sure glyphs are cached
    await Promise.all([
      // @ts-ignore
      document.fonts.load('700 60px "Source Serif 4"'),
      // @ts-ignore
      document.fonts.load('400 12px "Noto Sans TC"'),
      // @ts-ignore
      document.fonts.load('500 13px "Noto Sans TC"'),
    ]);
  } catch {}
};

const toDataUrl = async (src: string): Promise<string | null> => {
  try {
    const res = await fetch(src, { mode: 'cors' });
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

const pageShellCss = `
  box-sizing: border-box;
  width: 794px;         /* 210mm @ 96dpi */
  height: 1123px;       /* 297mm @ 96dpi */
  padding: 68px;        /* ~18mm */
  background: ${COLORS.paper};
  color: ${COLORS.ink};
  font-family: 'Noto Sans TC', 'PingFang TC', system-ui, sans-serif;
  position: relative;
  overflow: hidden;
`;

const serif = `'Source Serif 4', Georgia, 'Songti TC', serif`;

const watermarkHtml = `
  <div aria-hidden="true" style="position:absolute; inset:0; pointer-events:none; overflow:hidden; z-index:0;">
    <div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%) rotate(-28deg); font-family:${serif}; font-size:120px; font-weight:700; letter-spacing:0.04em; color:${COLORS.ink}; opacity:0.055; white-space:nowrap;">
      legendflow<span style="color:${COLORS.brand}">·</span>
    </div>
    <div style="position:absolute; top:18%; left:-6%; transform:rotate(-28deg); font-family:${serif}; font-size:60px; font-weight:600; color:${COLORS.ink}; opacity:0.04; white-space:nowrap;">
      legendflow<span style="color:${COLORS.brand}">·</span> &nbsp; legendflow<span style="color:${COLORS.brand}">·</span>
    </div>
    <div style="position:absolute; bottom:14%; right:-8%; transform:rotate(-28deg); font-family:${serif}; font-size:60px; font-weight:600; color:${COLORS.ink}; opacity:0.04; white-space:nowrap;">
      legendflow<span style="color:${COLORS.brand}">·</span> &nbsp; legendflow<span style="color:${COLORS.brand}">·</span>
    </div>
  </div>
`;

const buildCoverHtml = (a: ExportArgs, avatarDataUrl: string | null) => {
  const weekNum = (() => {
    const d = new Date(a.weekStart);
    const oneJan = new Date(d.getFullYear(), 0, 1);
    const days = Math.floor((d.getTime() - oneJan.getTime()) / 86400000);
    return Math.ceil((days + oneJan.getDay() + 1) / 7);
  })();
  const roleLabel = a.headSignal.experts.role === 'mentor' ? '實戰導師' : '分析師';
  return `
    <div style="${pageShellCss}">
      <div style="font-family:${serif}; font-size: 15px; font-weight: 700; letter-spacing: 0.02em;">
        legendflow<span style="color:${COLORS.brand}">·</span>
      </div>

      <div style="margin-top: 140px;">
        <div style="font-size: 11px; letter-spacing: 0.28em; color:${COLORS.gray}; font-weight: 500;">
          WEEK ${String(weekNum).padStart(2, '0')}
        </div>
        <div style="margin-top: 6px; font-size: 12px; letter-spacing: 0.18em; color:${COLORS.gray};">
          ${format(a.weekStart, 'MM / dd')} &mdash; ${format(a.weekEnd, 'MM / dd')}
        </div>

        <h1 style="font-family:${serif}; font-weight: 700; font-size: 80px; line-height: 1.05; margin: 44px 0 0; letter-spacing: -0.01em;">
          本週操作<br/>回顧與覆盤
        </h1>

        <div style="margin-top: 44px; width: 120px; height: 1px; background: ${COLORS.ink};"></div>

        <div style="margin-top: 32px; font-family:${serif}; font-style: italic; font-size: 22px; line-height: 1.55; color:${COLORS.ink}; max-width: 560px;">
          &ldquo;${escapeHtml(a.weekTitle)}&rdquo;
        </div>
      </div>

      <div style="position: absolute; right: 68px; bottom: 68px; display: flex; align-items: center; gap: 14px;">
        <div style="text-align: right;">
          <div style="font-size: 15px; font-weight: 700;">${escapeHtml(a.headSignal.experts.name)}</div>
          <div style="font-size: 11px; color:${COLORS.gray}; margin-top: 2px;">${roleLabel}</div>
        </div>
        ${
          avatarDataUrl
            ? `<img src="${avatarDataUrl}" style="width: 84px; height: 84px; border-radius: 50%; object-fit: cover; object-position: center 15%;" crossorigin="anonymous" />`
            : `<div style="width: 84px; height: 84px; border-radius: 50%; background: ${COLORS.line};"></div>`
        }
      </div>

      <div style="position: absolute; left: 68px; bottom: 68px; font-size: 10px; color:${COLORS.gray}; letter-spacing: 0.15em;">
        ISSUE · ${format(a.weekStart, 'yyyy.MM.dd')}
      </div>
    </div>
  `;
};

const pageHeader = (title: string, weekNum: number) => `
  <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom: 10px; border-bottom: 1px solid ${COLORS.line}; font-size: 10px; color:${COLORS.gray}; letter-spacing: 0.1em;">
    <span>${escapeHtml(title)}</span>
    <span>WEEK ${String(weekNum).padStart(2, '0')} · legendflow<span style="color:${COLORS.brand}">·</span></span>
  </div>
`;

const pageFooter = (pageIdx: number, total: number) => `
  <div style="position:absolute; left:0; right:0; bottom: 34px; text-align:center; font-size: 10px; color:${COLORS.gray};">
    <span style="color:${COLORS.brand}">•</span> &nbsp;${pageIdx} / ${total}&nbsp; <span style="color:${COLORS.brand}">•</span>
  </div>
`;

const sectionTitle = (t: string) => `
  <h2 style="font-family:${serif}; font-size: 26px; font-weight: 700; margin: 0 0 6px; letter-spacing: -0.01em;">${escapeHtml(t)}</h2>
  <div style="width: 40px; height: 2px; background: ${COLORS.brand}; margin-bottom: 18px;"></div>
`;

const signalBlockHtml = (s: Signal) => {
  const meta = actionMeta(s.action);
  const priceQty = [
    s.price_hint != null ? `價 ${s.price_hint}` : null,
    s.quantity != null ? `${s.quantity} ${s.quantity_unit || '張'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const detailBlock = (title: string, body: string | null, tone: 'ink' | 'warn' = 'ink') => {
    const text = richHtmlToPlain(body);
    if (!text) return '';
    return `
      <div style="margin-bottom: 10px;">
        <div style="font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: ${
          tone === 'warn' ? '#B45309' : COLORS.gray
        }; margin-bottom: 4px;">${escapeHtml(title)}</div>
        <div style="font-size: 12px; line-height: 1.7; color: ${COLORS.ink}; white-space: pre-wrap;">${escapeHtml(text)}</div>
      </div>
    `;
  };

  return `
    <div style="display:flex; gap: 24px; padding: 16px 0; border-bottom: 1px solid ${COLORS.line};">
      <div style="width: 150px; flex-shrink: 0;">
        <div style="display:inline-block; padding: 3px 10px; background: ${meta.bg}; color: ${meta.fg}; font-size: 11px; font-weight: 700; letter-spacing: 0.1em;">${meta.label}</div>
        <div style="font-family:${serif}; font-size: 22px; font-weight: 700; margin-top: 10px; line-height: 1.15;">${escapeHtml(s.instrument)}</div>
        <div style="font-size: 10px; color:${COLORS.gray}; margin-top: 6px; letter-spacing: 0.05em;">${format(new Date(s.published_at), 'yyyy / MM / dd')}</div>
        ${priceQty ? `<div style="font-size: 11px; color:${COLORS.ink}; margin-top: 8px; font-weight: 500;">${escapeHtml(priceQty)}</div>` : ''}
      </div>
      <div style="flex: 1; min-width: 0;">
        ${detailBlock('為什麼這樣操作', s.reason_summary)}
        ${detailBlock('部位控管想法', s.reason_detail)}
        ${detailBlock('風險提醒', s.risk_notes, 'warn')}
      </div>
    </div>
  `;
};

const buildPage = (headerTitle: string, weekNum: number, bodyHtml: string) => `
  <div style="${pageShellCss}">
    ${watermarkHtml}
    <div style="position:relative; z-index:1;">
      ${pageHeader(headerTitle, weekNum)}
      <div style="padding-top: 26px; height: calc(100% - 100px); overflow: hidden;">
        ${bodyHtml}
      </div>
    </div>
  </div>
`;

const measureAndSplit = async (
  container: HTMLElement,
  headerTitle: string,
  weekNum: number,
  blocks: string[],
  maxBodyHeightPx: number,
): Promise<string[]> => {
  // Try to greedily fit blocks per page by rendering into a hidden probe.
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute; visibility:hidden; left:-99999px; top:0; width:${794 - 136}px;`;
  container.appendChild(probe);

  const pages: string[] = [];
  let current: string[] = [];
  for (const block of blocks) {
    probe.innerHTML = current.concat(block).join('');
    if (probe.getBoundingClientRect().height > maxBodyHeightPx && current.length > 0) {
      pages.push(current.join(''));
      current = [block];
    } else {
      current.push(block);
    }
  }
  if (current.length) pages.push(current.join(''));
  container.removeChild(probe);
  return pages;
};

export const exportJournalPdf = async (args: ExportArgs) => {
  await ensureFonts();

  const avatarDataUrl = args.avatarSrc ? await toDataUrl(args.avatarSrc) : null;

  const root = document.createElement('div');
  root.id = 'lf-pdf-root';
  root.style.cssText = 'position:fixed; left:-10000px; top:0; z-index:-1;';
  document.body.appendChild(root);

  try {
    const weekNum = (() => {
      const d = new Date(args.weekStart);
      const oneJan = new Date(d.getFullYear(), 0, 1);
      const days = Math.floor((d.getTime() - oneJan.getTime()) / 86400000);
      return Math.ceil((days + oneJan.getDay() + 1) / 7);
    })();

    // Build all page HTMLs
    const pageHtmls: string[] = [];

    // 1. Cover
    pageHtmls.push(buildCoverHtml(args, avatarDataUrl));

    // 2+. Summary page (may share with signals if room)
    const summaryPlain = richHtmlToPlain(args.headSignal.reason_detail);
    const summaryBlock = summaryPlain
      ? `
        <div style="margin-bottom: 32px;">
          ${sectionTitle('本週整體摘要')}
          <div style="column-count: 2; column-gap: 32px; font-size: 12px; line-height: 1.85; color:${COLORS.ink}; white-space: pre-wrap;">${escapeHtml(summaryPlain)}</div>
        </div>
      `
      : '';

    const signalsIntro = `${sectionTitle('本週操作')}`;
    const signalBlocks = args.weekSignals.map((s) => signalBlockHtml(s));

    // Measure body area: page height 1123 - top padding 68 - bottom padding 68 - header ~40 - top-body-padding 26 - footer buffer 30
    const maxBody = 1123 - 68 * 2 - 40 - 26 - 20;

    if (signalBlocks.length === 0) {
      pageHtmls.push(buildPage('本週操作回顧', weekNum, summaryBlock || '<div style="color:#8A857C">本週無交易紀錄。</div>'));
    } else {
      // First content page carries summary + intro + as many signals as fit.
      const firstBlocks = [summaryBlock, signalsIntro, ...signalBlocks].filter(Boolean);
      const chunked = await measureAndSplit(root, '本週操作回顧', weekNum, firstBlocks, maxBody);
      for (const html of chunked) {
        pageHtmls.push(buildPage('本週操作回顧', weekNum, html));
      }
    }

    // Last. Learning points
    if (args.learningPoints.length) {
      const lpBlocks = args.learningPoints.map(
        (p) => `
          <li style="display:flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid ${COLORS.line}; font-size: 13px; line-height: 1.7;">
            <span style="color:${COLORS.brand}; font-weight: 700; flex-shrink: 0;">•</span>
            <span>${escapeHtml(p)}</span>
          </li>
        `,
      );
      const intro = sectionTitle('本週學習重點');
      const wrapped = [intro, `<ul style="list-style:none; padding:0; margin:0;">${lpBlocks.join('')}</ul>`];
      const chunked = await measureAndSplit(root, '本週學習重點', weekNum, wrapped, maxBody);
      for (const html of chunked) {
        pageHtmls.push(buildPage('本週學習重點', weekNum, html));
      }
    }

    // Disclaimer footer strip appended to last page bottom (baked into last page HTML)
    const disclaimer = `
      <div style="position:absolute; left:68px; right:68px; bottom: 58px; padding-top: 12px; border-top: 1px solid ${COLORS.line}; font-size: 9px; color:${COLORS.gray}; line-height: 1.6;">
        本頁內容為一週前之操作回顧（T+7），僅供教學用途，不構成任何即時投資建議。 &nbsp;·&nbsp; legendflow · 產出於 ${format(new Date(), 'yyyy/MM/dd')}
      </div>
    `;
    pageHtmls[pageHtmls.length - 1] = pageHtmls[pageHtmls.length - 1].replace(
      /<\/div>\s*$/,
      `${disclaimer}</div>`,
    );

    // Render each page node, snapshot, add to PDF
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const total = pageHtmls.length;

    for (let i = 0; i < pageHtmls.length; i++) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = pageHtmls[i].replace(
        /<\/div>\s*$/,
        // inject footer page number (skip on cover)
        i === 0 ? '</div>' : `${pageFooter(i + 1, total)}</div>`,
      );
      const pageEl = wrapper.firstElementChild as HTMLElement;
      root.appendChild(pageEl);

      // Wait a frame so fonts/layout settle
      await new Promise((r) => requestAnimationFrame(() => r(null)));

      const canvas = await html2canvas(pageEl, {
        scale: 2,
        backgroundColor: COLORS.paper,
        useCORS: true,
        logging: false,
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      if (i > 0) doc.addPage('a4', 'portrait');
      doc.addImage(imgData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');

      root.removeChild(pageEl);
    }

    const safeTitle = (args.weekTitle || '本週操作回顧')
      .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40) || '本週操作回顧';
    const filename = `週記-${format(args.weekStart, 'yyyy-MM-dd')}-${safeTitle}.pdf`;
    doc.save(filename);
  } finally {
    document.body.removeChild(root);
  }
};
