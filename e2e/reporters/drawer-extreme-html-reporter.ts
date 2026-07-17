/**
 * Drawer Extreme HTML Reporter — 抽屜 E2E 失敗回放彙總頁
 *
 * 掃描所有 `holdings-detail-panel-*` spec 的失敗案例，
 * 讀取每個 test 的 attachments（overflow-annotated-*.png / overflow-findings-*.json /
 * drawer-failure-summary.txt / trace.zip / video.webm），
 * 產出單一 HTML：`playwright-report/drawer-failures.html`
 *
 * 內容按 case 排列：
 *   - 標題 / project / viewport / status / duration
 *   - 每個 overflow annotation：label / side / overflowAmount / count
 *     + 內嵌 annotated PNG（relative path）
 *     + 該 label 的前 10 筆 finding：kind / tag / text / rect / rootRect / overflow
 *   - 一鍵可執行的回放指令（trace.zip / video.webm 絕對路徑）
 *
 * 額外輸出 `drawer-failures.json` 供 CI 上傳 artifact / 機器分析。
 * 若無失敗案例則不生成報表（避免蓋掉舊產物）。
 */
import type {
  Reporter,
  FullConfig,
  FullResult,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import fs from 'node:fs';
import path from 'node:path';

type Finding = {
  kind: 'element' | 'text';
  tag?: string;
  text: string;
  side: 'left' | 'right';
  left: number;
  right: number;
  top?: number;
  bottom?: number;
  rootLeft: number;
  rootRight: number;
  overflow: number;
};

type AnnotationEntry = {
  label: string;
  pngPath?: string;
  jsonPath?: string;
  findings: Finding[];
  worstOverflow: number;
  worstSide: 'left' | 'right' | null;
  count: number;
};

type FailedCase = {
  title: string;
  fullTitle: string;
  project: string;
  file: string;
  status: string;
  duration: number;
  viewport: { width: number; height: number } | null;
  outputDir: string;
  error?: string;
  tracePath?: string;
  videoPath?: string;
  screenshotPaths: string[];
  summaryTxtPath?: string;
  summaryMdPath?: string;
  annotations: AnnotationEntry[];
  worstOverflow: number;
};

const DRAWER_FILE_PREFIX = 'holdings-detail-panel-';
const REPORT_DIR = 'playwright-report';
const HTML_NAME = 'drawer-failures.html';
const JSON_NAME = 'drawer-failures.json';

export default class DrawerExtremeHtmlReporter implements Reporter {
  private config!: FullConfig;
  private failed: FailedCase[] = [];
  private projectViewports = new Map<string, { width: number; height: number }>();

  onBegin(config: FullConfig) {
    this.config = config;
    for (const p of config.projects) {
      const vp = (p.use as { viewport?: { width: number; height: number } } | undefined)?.viewport;
      if (vp) this.projectViewports.set(p.name, vp);
    }
  }

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status !== 'failed' && result.status !== 'timedOut') return;
    const file = path.basename(test.location?.file ?? '');
    if (!file.startsWith(DRAWER_FILE_PREFIX)) return;

    const project = test.parent.project()?.name ?? test.titlePath()[1] ?? '(no project)';
    const viewport = this.projectViewports.get(project) ?? null;

    // 分類 attachments
    const annotationsByLabel = new Map<string, AnnotationEntry>();
    let tracePath: string | undefined;
    let videoPath: string | undefined;
    let summaryTxtPath: string | undefined;
    let summaryMdPath: string | undefined;
    const screenshotPaths: string[] = [];

    for (const att of result.attachments) {
      const name = att.name ?? '';
      const p = att.path;
      if (!p || !fs.existsSync(p)) continue;

      if (name.startsWith('overflow-annotated-')) {
        const label = name.replace(/^overflow-annotated-/, '').replace(/\.png$/, '');
        const entry = ensure(annotationsByLabel, label);
        entry.pngPath = p;
      } else if (name.startsWith('overflow-findings-')) {
        const label = name.replace(/^overflow-findings-/, '').replace(/\.json$/, '');
        const entry = ensure(annotationsByLabel, label);
        entry.jsonPath = p;
        try {
          const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as Finding[];
          entry.findings = parsed;
          entry.count = parsed.length;
          const worst = parsed.reduce(
            (acc, cur) => (cur.overflow > acc ? cur.overflow : acc),
            0,
          );
          entry.worstOverflow = worst;
          const worstF = parsed.find((f) => f.overflow === worst);
          entry.worstSide = worstF?.side ?? null;
        } catch {
          /* ignore parse errors */
        }
      } else if (name === 'drawer-failure-summary') {
        summaryTxtPath = p;
      } else if (name === 'drawer-failure-summary.md') {
        summaryMdPath = p;
      } else if (name === 'trace' || p.endsWith('.zip')) {
        tracePath = p;
      } else if (name === 'video' || p.endsWith('.webm')) {
        videoPath = p;
      } else if (name.startsWith('screenshot') || (p.endsWith('.png') && !name.startsWith('overflow-annotated-'))) {
        screenshotPaths.push(p);
      }
    }

    const annotations = [...annotationsByLabel.values()].sort(
      (a, b) => b.worstOverflow - a.worstOverflow,
    );
    const worstOverflow = annotations.reduce(
      (acc, a) => (a.worstOverflow > acc ? a.worstOverflow : acc),
      0,
    );

    this.failed.push({
      title: test.title,
      fullTitle: test.titlePath().slice(2).join(' › '),
      project,
      file,
      status: result.status,
      duration: result.duration,
      viewport,
      outputDir: (result as unknown as { outputDir?: string }).outputDir ?? path.dirname(tracePath ?? summaryTxtPath ?? screenshotPaths[0] ?? ''),
      error: result.error?.message,
      tracePath,
      videoPath,
      screenshotPaths,
      summaryTxtPath,
      summaryMdPath,
      annotations,
      worstOverflow,
    });
  }

  async onEnd(_result: FullResult) {
    if (this.failed.length === 0) return;
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const htmlPath = path.join(REPORT_DIR, HTML_NAME);
    const jsonPath = path.join(REPORT_DIR, JSON_NAME);
    fs.writeFileSync(jsonPath, JSON.stringify(this.failed, null, 2), 'utf8');
    fs.writeFileSync(htmlPath, renderHtml(this.failed, htmlPath), 'utf8');
    // eslint-disable-next-line no-console
    console.log(
      `\n[drawer-extreme-report] ${this.failed.length} failed drawer case(s) → ${htmlPath}\n`,
    );
  }
}

function ensure(map: Map<string, AnnotationEntry>, label: string): AnnotationEntry {
  const found = map.get(label);
  if (found) return found;
  const entry: AnnotationEntry = {
    label,
    findings: [],
    worstOverflow: 0,
    worstSide: null,
    count: 0,
  };
  map.set(label, entry);
  return entry;
}

function relFromReport(reportHtmlPath: string, target?: string): string | undefined {
  if (!target) return undefined;
  const rel = path.relative(path.dirname(reportHtmlPath), target);
  return rel.split(path.sep).join('/');
}

function escapeHtml(s: string | undefined | null): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderHtml(cases: FailedCase[], reportPath: string): string {
  cases.sort((a, b) => b.worstOverflow - a.worstOverflow);

  const totalCases = cases.length;
  const totalFindings = cases.reduce(
    (acc, c) => acc + c.annotations.reduce((a2, an) => a2 + an.count, 0),
    0,
  );
  const worstCase = cases[0];
  const generatedAt = new Date().toISOString();

  const rows = cases
    .map((c, idx) => {
      const vp = c.viewport ? `${c.viewport.width}×${c.viewport.height}` : '—';
      return `<tr>
        <td>${idx + 1}</td>
        <td><a href="#case-${idx}">${escapeHtml(c.title)}</a></td>
        <td><code>${escapeHtml(c.project)}</code></td>
        <td><code>${vp}</code></td>
        <td class="num">${c.worstOverflow.toFixed(2)}</td>
        <td class="num">${c.annotations.reduce((a, an) => a + an.count, 0)}</td>
        <td>${escapeHtml(c.status)}</td>
      </tr>`;
    })
    .join('\n');

  const sections = cases
    .map((c, idx) => {
      const vp = c.viewport ? `${c.viewport.width}×${c.viewport.height}` : 'unknown';
      const traceRel = relFromReport(reportPath, c.tracePath);
      const videoRel = relFromReport(reportPath, c.videoPath);
      const summaryRel = relFromReport(reportPath, c.summaryTxtPath);
      const summaryMdRel = relFromReport(reportPath, c.summaryMdPath);

      const annotationBlocks = c.annotations
        .map((an) => {
          const imgRel = relFromReport(reportPath, an.pngPath);
          const jsonRel = relFromReport(reportPath, an.jsonPath);
          const findingRows = an.findings
            .slice(0, 10)
            .map(
              (f, j) => `<tr>
                <td>${j + 1}</td>
                <td><span class="side side-${f.side}">${f.side.toUpperCase()}</span></td>
                <td class="num">+${f.overflow.toFixed(2)}</td>
                <td><code>${escapeHtml(f.kind)}${f.tag ? ':' + escapeHtml(f.tag) : ''}</code></td>
                <td class="text">${escapeHtml((f.text || '').slice(0, 120))}</td>
                <td class="num small">L${f.left.toFixed(1)} R${f.right.toFixed(1)}</td>
                <td class="num small">L${f.rootLeft.toFixed(1)} R${f.rootRight.toFixed(1)}</td>
              </tr>`,
            )
            .join('\n');
          const more = an.findings.length > 10
            ? `<p class="muted">… +${an.findings.length - 10} more, 見 <code>${escapeHtml(jsonRel ?? '')}</code></p>`
            : '';
          return `<div class="annotation">
            <h3>
              <span class="label">${escapeHtml(an.label)}</span>
              <span class="badge worst worst-${an.worstSide ?? 'none'}">worst ${an.worstSide?.toUpperCase() ?? '—'} +${an.worstOverflow.toFixed(2)}px</span>
              <span class="badge count">${an.count} finding(s)</span>
            </h3>
            ${imgRel ? `<a href="${imgRel}" target="_blank"><img loading="lazy" src="${imgRel}" alt="overflow annotated ${escapeHtml(an.label)}" /></a>` : '<p class="muted">(no annotated PNG)</p>'}
            ${findingRows ? `<table class="findings">
              <thead><tr><th>#</th><th>side</th><th>overflow</th><th>kind</th><th>text</th><th>rect (L/R)</th><th>panel (L/R)</th></tr></thead>
              <tbody>${findingRows}</tbody>
            </table>${more}` : ''}
            <p class="muted small">
              ${imgRel ? `PNG: <code>${escapeHtml(imgRel)}</code>` : ''}
              ${jsonRel ? ` · JSON: <code>${escapeHtml(jsonRel)}</code>` : ''}
            </p>
          </div>`;
        })
        .join('\n');

      const noAnnotations = c.annotations.length === 0
        ? '<p class="muted">此案例未產出 overflow annotation（可能是 timeout / interaction 類失敗，非幾何溢出）。</p>'
        : '';

      const shots = c.screenshotPaths
        .map((p) => relFromReport(reportPath, p))
        .filter((v): v is string => !!v)
        .map((r) => `<a href="${r}" target="_blank"><img loading="lazy" src="${r}" alt="screenshot" /></a>`)
        .join('\n');

      return `<section class="case" id="case-${idx}">
        <header>
          <h2>#${idx + 1} · ${escapeHtml(c.title)}</h2>
          <dl class="meta">
            <div><dt>project</dt><dd><code>${escapeHtml(c.project)}</code></dd></div>
            <div><dt>viewport</dt><dd><code>${vp}</code></dd></div>
            <div><dt>status</dt><dd>${escapeHtml(c.status)}</dd></div>
            <div><dt>duration</dt><dd>${(c.duration / 1000).toFixed(2)}s</dd></div>
            <div><dt>file</dt><dd><code>${escapeHtml(c.file)}</code></dd></div>
            <div><dt>worst</dt><dd class="num">+${c.worstOverflow.toFixed(2)}px</dd></div>
          </dl>
          <div class="replay">
            ${traceRel ? `<a class="btn" href="${traceRel}" download>trace.zip</a>` : ''}
            ${videoRel ? `<a class="btn" href="${videoRel}" target="_blank">video</a>` : ''}
            ${summaryRel ? `<a class="btn" href="${summaryRel}" target="_blank">summary.txt</a>` : ''}
            ${summaryMdRel ? `<a class="btn" href="${summaryMdRel}" target="_blank">summary.md</a>` : ''}
          </div>
          ${c.tracePath ? `<pre class="cmd">bunx playwright show-trace "${escapeHtml(c.tracePath)}"</pre>` : ''}
          ${c.error ? `<details><summary>error message</summary><pre>${escapeHtml(c.error)}</pre></details>` : ''}
        </header>
        ${noAnnotations}
        ${annotationBlocks}
        ${shots ? `<details><summary>其他截圖 (${c.screenshotPaths.length})</summary><div class="shots">${shots}</div></details>` : ''}
      </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<title>Drawer Extreme Failures · ${totalCases} case(s)</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 -apple-system, "Segoe UI", "PingFang TC", sans-serif; margin: 0; padding: 24px; background: #0f172a; color: #e2e8f0; }
  h1 { margin: 0 0 8px; font-size: 22px; }
  .stats { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
  .stats div { background: #1e293b; padding: 10px 14px; border-radius: 8px; }
  .stats strong { color: #f97316; font-size: 18px; }
  table { border-collapse: collapse; width: 100%; background: #1e293b; border-radius: 8px; overflow: hidden; margin-bottom: 24px; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #334155; }
  th { background: #0f172a; font-weight: 600; }
  td.num { font-variant-numeric: tabular-nums; text-align: right; font-family: ui-monospace, Menlo, monospace; }
  td.small, .small { font-size: 12px; }
  td.text { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  code { font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; background: rgba(148,163,184,0.12); padding: 1px 5px; border-radius: 3px; }
  a { color: #60a5fa; }
  section.case { background: #1e293b; padding: 20px; border-radius: 10px; margin-bottom: 20px; }
  section.case h2 { margin: 0 0 12px; font-size: 18px; color: #fbbf24; }
  dl.meta { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; margin: 0 0 12px; }
  dl.meta > div { background: #0f172a; padding: 6px 10px; border-radius: 6px; }
  dl.meta dt { font-size: 11px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.05em; }
  dl.meta dd { margin: 2px 0 0; font-size: 13px; }
  .replay { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .btn { display: inline-block; padding: 4px 10px; background: #334155; color: #e2e8f0; text-decoration: none; border-radius: 4px; font-size: 12px; }
  .btn:hover { background: #475569; }
  pre.cmd { background: #020617; padding: 8px 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; color: #a3e635; }
  details pre { background: #020617; padding: 8px 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
  .annotation { border-top: 1px dashed #334155; padding: 12px 0; }
  .annotation h3 { display: flex; gap: 8px; align-items: center; font-size: 14px; margin: 0 0 8px; }
  .annotation h3 .label { color: #f97316; font-family: ui-monospace, Menlo, monospace; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #334155; color: #e2e8f0; }
  .badge.worst-left { background: #7f1d1d; color: #fecaca; }
  .badge.worst-right { background: #7c2d12; color: #fed7aa; }
  .badge.count { background: #1e40af; color: #bfdbfe; }
  .side { font-family: ui-monospace, Menlo, monospace; font-size: 11px; padding: 1px 6px; border-radius: 3px; }
  .side-left { background: #7f1d1d; color: #fecaca; }
  .side-right { background: #7c2d12; color: #fed7aa; }
  img { max-width: 100%; height: auto; border: 1px solid #334155; border-radius: 4px; margin: 6px 0; display: block; }
  .shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; }
  .shots img { max-height: 260px; object-fit: cover; }
  .muted { color: #94a3b8; }
  table.findings { margin-top: 8px; font-size: 12px; }
  table.findings th { background: #0f172a; }
  .toc { margin-bottom: 24px; }
  header.top { margin-bottom: 16px; }
  .stamp { color: #64748b; font-size: 12px; }
</style>
</head>
<body>
<header class="top">
  <h1>Drawer Extreme Failures</h1>
  <p class="stamp">generated at ${escapeHtml(generatedAt)}</p>
</header>
<div class="stats">
  <div><strong>${totalCases}</strong> failed case(s)</div>
  <div><strong>${totalFindings}</strong> overflow finding(s)</div>
  <div>worst: <strong>+${(worstCase?.worstOverflow ?? 0).toFixed(2)}px</strong> @ <code>${escapeHtml(worstCase?.project ?? '—')}</code> · <code>${worstCase?.viewport ? worstCase.viewport.width + '×' + worstCase.viewport.height : '—'}</code></div>
</div>

<div class="toc">
  <table>
    <thead><tr><th>#</th><th>case</th><th>project</th><th>viewport</th><th>worst (px)</th><th>findings</th><th>status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>

${sections}

</body>
</html>`;
}
