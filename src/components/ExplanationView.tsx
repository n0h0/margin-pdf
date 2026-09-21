import { useEffect, useId, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { BarChart3, ChevronDown, Expand, FlaskConical, GitBranch, LoaderCircle, RotateCcw } from 'lucide-react';
import 'katex/dist/katex.min.css';
import { frameDocument } from '../lib/frames';
import type { Block, Explanation } from '../lib/schema';
const colors = ['#346a4f', '#c88d45', '#638ba3', '#b77c8b', '#7d71a0', '#7c9473'];
function Card({ title, icon, children, caption }: { title: string; icon: ReactNode; children: ReactNode; caption: string }) {
  return <figure className="visual-card"><figcaption className="visual-heading">{icon}<span>{title}</span></figcaption>{children}{caption && <p className="visual-caption">{caption}</p>}</figure>;
}
function Diagram({ block }: { block: Extract<Block, { type: 'diagram' }> }) {
  const id = useId().replace(/[^a-z0-9]/gi, '');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState(false);
  const [height, setHeight] = useState(260);
  useEffect(() => {
    let disposed = false;
    setSvg(''); setError(false);
    void (async () => {
      try {
        if (/%%\s*\{|^\s*---|\bclick\s/i.test(block.code)) throw new Error('Unsupported diagram directive');
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', maxTextSize: 16000, theme: 'base', themeVariables: { primaryColor: '#edf3ec', primaryTextColor: '#294e3b', primaryBorderColor: '#9ab19f', lineColor: '#83968a', fontFamily: 'sans-serif', fontSize: '13px' }, flowchart: { htmlLabels: false, useMaxWidth: true } });
        const result = await mermaid.render(`margin-${id}`, block.code);
        if (!disposed) {
          const parsed = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
          const box = parsed.documentElement.getAttribute('viewBox')?.split(/\s+/).map(Number);
          if (box?.length === 4 && box[2] > 0) setHeight(Math.min(500, Math.max(150, 360 * box[3] / box[2] + 40)));
          setSvg(result.svg);
        }
      } catch { if (!disposed) setError(true); }
    })();
    return () => { disposed = true; };
  }, [block.code, id]);
  return <Card title={block.title} icon={<GitBranch size={15} />} caption={block.caption}>{error ? <div className="diagram-fallback"><p>図を描画できませんでした。元の記述を表示します。</p><pre>{block.code}</pre></div> : svg ? <iframe className="diagram-frame" title={block.title} sandbox="" referrerPolicy="no-referrer" srcDoc={frameDocument(svg, false)} style={{ height }} /> : <div className="visual-loading"><LoaderCircle size={18} className="spin" /> 図を描いています</div>}</Card>;
}
function Chart({ block }: { block: Extract<Block, { type: 'chart' }> }) {
  const [active, setActive] = useState<number | null>(null);
  const w = 460, h = 255, left = 55, right = 18, top = 22, bottom = 48;
  const innerW = w - left - right, innerH = h - top - bottom;
  const values = block.series.flatMap(s => s.values);
  const minimum = Math.min(0, ...values), maximum = Math.max(0, ...values);
  const span = maximum - minimum || 1;
  const min = minimum < 0 ? minimum - span * .08 : 0, max = maximum + span * .12 || 1;
  const y = (n: number) => top + innerH * (1 - (n - min) / (max - min));
  const step = innerW / block.labels.length;
  const x = (i: number) => left + step * (i + .5);
  const format = (n: number) => new Intl.NumberFormat('ja', { maximumFractionDigits: 2, notation: Math.abs(n) >= 10000 ? 'compact' : 'standard' }).format(n);
  return <Card title={block.title} icon={<BarChart3 size={15} />} caption={block.caption}>
    <div className="chart-plot"><span className="chart-y-label">{block.yLabel}</span><svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${block.title}。データ表でも確認できます。`}>
      {Array.from({ length: 5 }, (_, i) => { const value = min + (max - min) * i / 4; return <g key={i}><line x1={left} x2={w - right} y1={y(value)} y2={y(value)} stroke="#e2e8df" strokeDasharray="3 4" /><text x={left - 9} y={y(value) + 4} textAnchor="end" fill="#7b857c" fontSize="10">{format(value)}</text></g>; })}
      {block.labels.map((label, i) => <g key={i}>{(i % Math.max(1, Math.ceil(block.labels.length / 7)) === 0 || i === block.labels.length - 1) && <text x={x(i)} y={h - 26} textAnchor="middle" fontSize="10" fill="#778277">{label.length > 9 ? label.slice(0, 8) + '…' : label}</text>}</g>)}
      <line x1={left} x2={w - right} y1={y(0)} y2={y(0)} stroke="#c6d2c5" />
      {block.series.map((series, j) => block.kind === 'line' ? <g key={j}><polyline fill="none" stroke={colors[j]} strokeWidth="2.5" points={series.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />{series.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={active === i ? 5 : 3} fill={colors[j]} />)}</g> : <g key={j}>{series.values.map((v, i) => <rect key={i} x={left + i * step + step * .15 + j * step * .7 / block.series.length} y={Math.min(y(0), y(v))} width={step * .7 / block.series.length - 1} height={Math.abs(y(v) - y(0)) || 1} fill={colors[j]} rx="2" opacity={active === null || active === i ? 1 : .55} />)}</g>)}
      {block.labels.map((label, i) => <rect key={i} x={left + i * step} y={top} width={step} height={innerH} fill="transparent" tabIndex={0} role="button" aria-label={`${label}: ${block.series.map(s => `${s.name} ${s.values[i]}`).join(', ')}`} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}><title>{label}: {block.series.map(s => `${s.name} ${s.values[i]}`).join(', ')}</title></rect>)}
      <text x={w / 2} y={h - 3} textAnchor="middle" fontSize="10" fill="#778277">{block.xLabel}</text>
    </svg><div className="chart-legend">{block.series.map((s, i) => <span key={s.name}><i style={{ background: colors[i] }} />{s.name}{active !== null && <strong>{format(s.values[active])}</strong>}</span>)}</div></div>
    <details className="chart-data"><summary>データを見る <ChevronDown size={12} /></summary><div><table><thead><tr><th>{block.xLabel}</th>{block.series.map(s => <th key={s.name}>{s.name}</th>)}</tr></thead><tbody>{block.labels.map((label, i) => <tr key={i}><td>{label}</td>{block.series.map((s, j) => <td key={j}>{s.values[i]}</td>)}</tr>)}</tbody></table></div></details>
  </Card>;
}
function Interactive({ block }: { block: Extract<Block, { type: 'interactive' }> }) {
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  return <Card title={block.title} icon={<FlaskConical size={15} />} caption={block.caption}><div className="interactive-controls"><span><i className="small-dot" /> 動かして理解する</span><button className="icon-button" aria-label="解説をリセット" title="リセット" onClick={() => setRevision(r => r + 1)}><RotateCcw size={14} /></button><button className="icon-button" aria-label="解説の表示を広げる" title="表示を広げる" onClick={() => setExpanded(e => !e)}><Expand size={14} /></button></div><iframe key={revision} title={block.title} className="interactive-frame" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={frameDocument(block.html, true)} style={{ height: expanded ? 620 : 360 }} /></Card>;
}
export default function ExplanationView({ explanation }: { explanation: Explanation }) {
  return <div className="explanation-blocks">{explanation.blocks.map((block, i) => block.type === 'markdown' ? <div className="markdown" key={i}><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { strict: 'ignore', trust: false }]]} components={{ a: props => <a {...props} target="_blank" rel="noreferrer noopener" />, img: ({ alt }) => <span className="external-image-label">{alt || '画像'}</span> }}>{block.content}</ReactMarkdown></div> : block.type === 'diagram' ? <Diagram key={i} block={block} /> : block.type === 'chart' ? <Chart key={i} block={block} /> : <Interactive key={i} block={block} />)}</div>;
}
