import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Expand, LoaderCircle, Minus, MousePointer2, Plus, Scan, Sparkles, Type, X } from 'lucide-react';
import { localPDF } from '../lib/storage';
import { getPageLinks, type PdfLink } from '../lib/pdf-links';
import type { LibraryDocument, ReadingContext, SelectionRect } from '../lib/schema';
GlobalWorkerOptions.workerSrc = workerUrl;
export type OutlineItem = { title: string; page: number; depth: number };
interface Props {
  document: LibraryDocument; page: number; onPage: (page: number) => void;
  onReady: (count: number) => void; onOutline: (items: OutlineItem[]) => void;
  onPageContext: (context: ReadingContext | null) => void;
  selection: ReadingContext | null; onSelect: (context: ReadingContext | null) => void;
  onAsk: (question?: string) => void;
}
const clamp = (v: number) => Math.max(0, Math.min(1, v));
export default function PdfViewer({ document: doc, page, onPage, onReady, onOutline, onPageContext, selection, onSelect, onAsk }: Props) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(650);
  const [size, setSize] = useState({ width: 600, height: 840, scale: 1 });
  const [mode, setMode] = useState<'text' | 'region'>('text');
  const [draft, setDraft] = useState<SelectionRect | null>(null);
  const [pageInput, setPageInput] = useState(String(page));
  const [pageLinks, setPageLinks] = useState<{ pdf: PDFDocumentProxy; page: number; links: PdfLink[] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<ReadingContext | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const activeRender = useRef<RenderTask | null>(null);
  useEffect(() => { setPageInput(String(page)); scrollRef.current?.scrollTo({ top: 0 }); }, [page, doc.id]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, entry.contentRect.width - 72)));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let disposed = false;
    let task: ReturnType<typeof getDocument> | undefined;
    setLoading(true); setError(''); setPdf(null); setMode('text'); onOutline([]); onPageContext(null); setZoom(1);
    const load = async () => {
      try {
        const source = doc.local ? { data: new Uint8Array(await localPDF(doc.id)) } : { url: doc.url! };
        if (disposed) return;
        task = getDocument({ ...source, cMapUrl: '/pdf-assets/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdf-assets/standard_fonts/', wasmUrl: '/pdf-assets/wasm/' });
        const result = await task.promise;
        if (disposed) return;
        setPdf(result); onReady(result.numPages); setLoading(false);
        const outline = await result.getOutline();
        const items: OutlineItem[] = [];
        async function visit(entries: NonNullable<typeof outline>, depth = 0) {
          for (const item of entries) {
            if (items.length >= 150 || disposed) break;
            try {
              const dest = typeof item.dest === 'string' ? await result.getDestination(item.dest) : item.dest;
              if (dest) { const pageIndex = typeof dest[0] === 'number' ? dest[0] : await result.getPageIndex(dest[0]); items.push({ title: item.title, page: pageIndex + 1, depth }); }
              if (item.items) await visit(item.items, depth + 1);
            } catch { /* skip malformed outline entry */ }
          }
        }
        if (outline) await visit(outline);
        if (!disposed) onOutline(items);
      } catch (e) { if (!disposed) { setError(e instanceof Error ? e.message : 'PDF を読み込めませんでした。'); setLoading(false); } }
    };
    void load();
    return () => { disposed = true; void task?.destroy(); };
  }, [doc.id, doc.local, doc.url, onReady, onOutline, onPageContext]);
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    let layer: TextLayer | undefined;
    setRendering(true); setError(''); setPageLinks(null); contextRef.current = null;
    const render = async () => {
      if (cancelled) return;
      try {
        const pdfPage = await pdf.getPage(Math.min(Math.max(page, 1), pdf.numPages));
        if (cancelled || !canvasRef.current || !textRef.current) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(width / base.width, 1.45) * zoom;
        const viewport = pdfPage.getViewport({ scale });
        const canvas = canvasRef.current;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(viewport.width * ratio); canvas.height = Math.round(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
        setSize({ width: viewport.width, height: viewport.height, scale });
        textRef.current.replaceChildren();
        textRef.current.style.setProperty('--total-scale-factor', String(scale));
        task = pdfPage.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        activeRender.current = task;
        const [text, links] = await Promise.all([
          pdfPage.getTextContent(),
          getPageLinks(pdf, pdfPage, viewport).catch(() => []),
        ]);
        await task.promise;
        if (cancelled) return;
        layer = new TextLayer({ textContentSource: text, container: textRef.current, viewport });
        await layer.render();
        if (cancelled) return;
        setPageLinks({ pdf, page, links });
        const pageText = text.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').slice(0, 24000);
        const context: ReadingContext = { documentId: doc.id, documentName: doc.name, page, pageCount: pdf.numPages, kind: 'page', text: '', pageText, rects: [], image: cropImage() };
        contextRef.current = context; onPageContext(context); setRendering(false);
      } catch (e) { if (!cancelled && (e as Error).name !== 'RenderingCancelledException') { setError((e as Error).message); setRendering(false); } }
    };
    void (async () => { await activeRender.current?.promise.catch(() => {}); await render(); })();
    return () => { cancelled = true; task?.cancel(); layer?.cancel(); };
  }, [pdf, page, width, zoom, doc.id, doc.name, onPageContext]);
  useEffect(() => {
    if (rendering || !selection || selection.image || selection.page !== page || selection.documentId !== doc.id || !contextRef.current || !selection.rects.length) return;
    const x = Math.min(...selection.rects.map(r => r.x)), y = Math.min(...selection.rects.map(r => r.y));
    const right = Math.min(1, Math.max(...selection.rects.map(r => r.x + r.width))), bottom = Math.min(1, Math.max(...selection.rects.map(r => r.y + r.height)));
    onSelect({ ...selection, pageText: contextRef.current.pageText, image: cropImage({ x, y, width: right - x, height: bottom - y }) });
  }, [selection, rendering, page, doc.id, onSelect]);
  function cropImage(rect?: SelectionRect) {
    const source = canvasRef.current;
    if (!source || !source.width) return undefined;
    const r = rect || { x: 0, y: 0, width: 1, height: 1 };
    const sw = Math.max(1, r.width * source.width), sh = Math.max(1, r.height * source.height);
    const factor = Math.min(1, 1400 / Math.max(sw, sh));
    const target = window.document.createElement('canvas');
    target.width = Math.max(1, Math.round(sw * factor)); target.height = Math.max(1, Math.round(sh * factor));
    target.getContext('2d')!.drawImage(source, r.x * source.width, r.y * source.height, sw, sh, 0, 0, target.width, target.height);
    let image = target.toDataURL('image/png');
    while (image.length > 5900000 && target.width > 100) {
      target.width = Math.round(target.width * .8); target.height = Math.round(target.height * .8);
      target.getContext('2d')!.drawImage(source, r.x * source.width, r.y * source.height, sw, sh, 0, 0, target.width, target.height);
      image = target.toDataURL('image/png');
    }
    return image;
  }
  function selectText() {
    if (mode !== 'text' || rendering || !contextRef.current || !paperRef.current || !textRef.current) return;
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || !selected.rangeCount) return;
    const range = selected.getRangeAt(0);
    if (!textRef.current.contains(range.startContainer) || !textRef.current.contains(range.endContainer)) return;
    const text = selected.toString().trim().slice(0, 16000);
    if (!text) return;
    const bounds = paperRef.current.getBoundingClientRect();
    const rects = [...range.getClientRects()].filter(r => r.width > 1 && r.height > 1).slice(0, 200).map(r => ({ x: clamp((r.left - bounds.left) / bounds.width), y: clamp((r.top - bounds.top) / bounds.height), width: clamp(r.width / bounds.width), height: clamp(r.height / bounds.height) }));
    if (!rects.length) return;
    const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
    const endX = Math.min(1, Math.max(...rects.map(r => r.x + r.width))), endY = Math.min(1, Math.max(...rects.map(r => r.y + r.height)));
    onSelect({ ...contextRef.current, kind: 'text', text, rects, image: cropImage({ x, y, width: endX - x, height: endY - y }) });
  }
  const coordinates = (e: PointerEvent<HTMLDivElement>) => {
    const bounds = paperRef.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - bounds.left) / bounds.width), y: clamp((e.clientY - bounds.top) / bounds.height) };
  };
  function startRegion(e: PointerEvent<HTMLDivElement>) {
    if (mode !== 'region' || rendering || !contextRef.current) return;
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = coordinates(e); setDraft(null); onSelect(null);
  }
  function moveRegion(e: PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const point = coordinates(e), start = dragStart.current;
    setDraft({ x: Math.min(point.x, start.x), y: Math.min(point.y, start.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) });
  }
  function endRegion(e: PointerEvent<HTMLDivElement>) {
    if (!dragStart.current || !contextRef.current) return;
    const point = coordinates(e), start = dragStart.current;
    const rect = { x: Math.min(point.x, start.x), y: Math.min(point.y, start.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) };
    dragStart.current = null; setDraft(null);
    if (rect.width < .01 || rect.height < .01) return;
    const bounds = paperRef.current!.getBoundingClientRect();
    const text = [...(textRef.current?.querySelectorAll('span') || [])].filter(span => {
      const r = span.getBoundingClientRect();
      const cx = (r.left + r.width / 2 - bounds.left) / bounds.width, cy = (r.top + r.height / 2 - bounds.top) / bounds.height;
      return cx >= rect.x && cx <= rect.x + rect.width && cy >= rect.y && cy <= rect.y + rect.height;
    }).map(span => span.textContent).join(' ').slice(0, 16000);
    onSelect({ ...contextRef.current, kind: 'region', text, rects: [rect], image: cropImage(rect) });
  }
  const currentSelection = selection?.page === page && selection.documentId === doc.id ? selection : null;
  const rectStyle = (r: SelectionRect): CSSProperties => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` });
  const navigate = () => { const next = Math.round(Number(pageInput)); if (Number.isFinite(next) && pdf) onPage(Math.min(pdf.numPages, Math.max(1, next))); else setPageInput(String(page)); };
  return <section className="pdf-viewer" aria-label="PDF ビューワー">
    <div className="pdf-toolbar">
      <div className="segmented"><button className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')} title="本文を選択" aria-label="本文を選択"><Type size={16} /><span>テキスト</span></button><button className={mode === 'region' ? 'active' : ''} onClick={() => { setMode('region'); window.getSelection()?.removeAllRanges(); }} title="図や数式を囲む" aria-label="図や数式を囲む"><Scan size={16} /><span>範囲選択</span></button></div>
      <div className="zoom-controls"><button className="icon-button" aria-label="縮小" onClick={() => setZoom(z => Math.max(.5, z - .15))}><Minus size={16} /></button><button className="zoom-label" onClick={() => setZoom(1)} title="幅に合わせる">{Math.round(zoom * 100)}% <ChevronDown size={12} /></button><button className="icon-button" aria-label="拡大" onClick={() => setZoom(z => Math.min(2.5, z + .15))}><Plus size={16} /></button><span className="toolbar-divider" /><button className="icon-button" aria-label="幅に合わせる" onClick={() => setZoom(1)}><Expand size={16} /></button></div>
    </div>
    <div className="pdf-scroll" ref={scrollRef} onPointerUp={() => { if (mode === 'text') setTimeout(selectText, 0); }} onKeyUp={selectText}>
      {loading ? <div className="pdf-loading"><LoaderCircle className="spin" size={24} /><p>本を開いています…</p></div> : error ? <div className="empty-error"><h3>PDF を開けませんでした</h3><p>{error}</p><p>パスワード付き PDF は、解除したファイルを開いてください。</p></div> : <>
        <div className="page-eyebrow"><span>{doc.name.replace(/\.pdf$/i, '').replaceAll('-', ' ')}</span><span>PAGE {String(page).padStart(2, '0')}</span></div>
        <div className={`pdf-paper ${mode === 'region' ? 'region-mode' : ''}`} ref={paperRef} style={{ width: size.width, height: size.height }}>
          <canvas ref={canvasRef} aria-label={`PDF ${page} ページ`} />
          <div className="textLayer" ref={textRef} />
          {mode === 'text' && !rendering && pageLinks?.pdf === pdf && pageLinks?.page === page && <div className="pdf-link-layer">
            {pageLinks.links.map(link => link.url !== undefined
              ? <a key={link.id} className="pdf-link" style={rectStyle(link.rect)} href={link.url} target="_blank" rel="noopener noreferrer" title={`${link.url}（新しいタブで開く）`} aria-label={`${link.url}（新しいタブで開く）`} />
              : <a key={link.id} className="pdf-link" style={rectStyle(link.rect)} href={`#page=${link.page}`} title={`${link.page} ページへ移動`} aria-label={`${link.page} ページへ移動`} onClick={event => { event.preventDefault(); onSelect(null); window.getSelection()?.removeAllRanges(); onPage(link.page); }} />)}
          </div>}
          <div className="selection-highlights" aria-hidden="true">{currentSelection?.rects.map((r, i) => <div className={`selection-rect ${currentSelection.kind}`} key={i} style={rectStyle(r)} />)}</div>
          {mode === 'region' && <div className="region-surface" onPointerDown={startRegion} onPointerMove={moveRegion} onPointerUp={endRegion} onPointerCancel={() => { dragStart.current = null; setDraft(null); }} />}
          {draft && <div className="region-draft" style={rectStyle(draft)} />}
          {rendering && <div className="render-indicator"><LoaderCircle className="spin" size={16} /></div>}
        </div>
        {currentSelection && <div className="selection-actions"><span><Check size={14} />{currentSelection.kind === 'region' ? '範囲' : 'テキスト'}を選択中</span><button onClick={() => onAsk('選択した箇所をわかりやすく解説してください。')}><Sparkles size={14} /> AI に解説してもらう</button><button className="icon-button" aria-label="選択を解除" onClick={() => { onSelect(null); window.getSelection()?.removeAllRanges(); }}><X size={14} /></button></div>}
        <p className="reading-hint"><MousePointer2 size={13} />{mode === 'text' ? '気になる一文を選んで、理解を深めましょう。' : 'ドラッグで図・数式・スキャンした文章を囲めます。'}</p>
      </>}
    </div>
    <footer className="pdf-footer"><span className="reading-label"><span className="small-dot" /> READING MODE</span><div className="pagination"><button className="icon-button" disabled={page <= 1 || !pdf} onClick={() => onPage(page - 1)} aria-label="前のページ"><ArrowLeft size={15} /></button><label><input aria-label="ページ番号" type="number" min={1} max={pdf?.numPages || 1} value={pageInput} onChange={e => setPageInput(e.target.value)} onBlur={navigate} onKeyDown={e => { if (e.key === 'Enter') { navigate(); e.currentTarget.blur(); } }} /><span>/ {pdf?.numPages || '—'}</span></label><button className="icon-button" disabled={!pdf || page >= pdf.numPages} onClick={() => onPage(page + 1)} aria-label="次のページ"><ArrowRight size={15} /></button></div><span className="reading-percent">{pdf ? Math.round(page / pdf.numPages * 100) : 0}% 読了</span></footer>
  </section>;
}
