import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, ArrowUp, BookOpen, Bookmark, Check, ChevronRight, CircleHelp, Download, FileText, FolderOpen, Layers, List, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Settings2, Sparkles, Terminal, Trash2, Upload, X } from 'lucide-react';
import GenerationButton from './components/GenerationButton';
import PdfViewer, { type OutlineItem } from './components/PdfViewer';
const LazyExplanation = lazy(() => import('./components/ExplanationView'));
function ExplanationView({ explanation }: { explanation: import('./lib/schema').Explanation }) { return <Suspense fallback={<p className="visual-loading">解説を表示しています…</p>}><LazyExplanation explanation={explanation} /></Suspense>; }
import { explain, getLibrary, getSession } from './lib/api';
import { importPDF, removePDF, loadMessages, localDocuments, rememberPage, savedPage, saveMessages } from './lib/storage';
import { demo } from './lib/demo';
import type { ExplainRequest, LibraryDocument, Message, ProviderInfo, ReadingContext } from './lib/schema';

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="閉じる" onClick={onClose}><X size={20} /></button></div><div className="modal-body">{children}</div></dialog>;
}
type Mark = { page: number; label: string };
function readMarks(id: string): Mark[] { try { return JSON.parse(localStorage.getItem(`margin:marks:${id}`) || '[]'); } catch { return []; } }
function formatSize(size: number) { return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.round(size / 1024)} KB`; }
function Logo({ small = false }: { small?: boolean }) { return <span className={`brand-symbol ${small ? 'small' : ''}`} aria-hidden="true"><span /><span /><span /></span>; }
export default function App() {
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [doc, setDoc] = useState<LibraryDocument | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [selection, setSelection] = useState<ReadingContext | null>(null);
  const [pageContext, setPageContext] = useState<ReadingContext | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [provider, setProvider] = useState('codex');
  const [token, setToken] = useState('');
  const [question, setQuestion] = useState('');
  const [style, setStyle] = useState<ExplainRequest['style']>('auto');
  const [loading, setLoading] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<'settings' | 'demo' | 'clear' | 'remove' | null>(null);
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 1020);
  const [removingDoc, setRemovingDoc] = useState<LibraryDocument | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'library' | 'outline' | 'marks'>('library');
  const [marks, setMarks] = useState<Mark[]>([]);
  const [importing, setImporting] = useState(false);
  const [booting, setBooting] = useState(true);
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const activeDoc = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const chatScroll = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const context = selection || pageContext;
  const selectedProvider = providers.find(p => p.id === provider);
  const openDocument = useCallback((next: LibraryDocument) => {
    abortRef.current?.abort(); abortRef.current = null; setLoading(false); setStopping(false); setStatus('');
    activeDoc.current = next.id; setDoc(next); setPage(savedPage(next.id)); setPageCount(0); setPageContext(null); setSelection(null); setError(''); setQuestion('');
    if (window.innerWidth <= 1020) setSidebar(false);
    setMessages(loadMessages(next.id)); setMarks(readMarks(next.id)); setOutline([]);
    try { localStorage.setItem('margin:last-document', next.id); } catch { /* optional */ }
  }, []);
  useEffect(() => {
    let disposed = false;
    void (async () => {
      const results = await Promise.allSettled([getSession(), getLibrary(), localDocuments()]);
      if (disposed) return;
      if (results[0].status === 'fulfilled') { setToken(results[0].value.token); setProviders(results[0].value.providers); setProvider(results[0].value.providers.find(p => p.available)?.id || 'codex'); }
      else setError(results[0].reason.message);
      const docs = [...(results[1].status === 'fulfilled' ? results[1].value : []), ...(results[2].status === 'fulfilled' ? results[2].value : [])];
      if (results[1].status === 'rejected') setError(results[1].reason.message);
      if (results[2].status === 'rejected') setNotice('ブラウザーへのファイル保存を利用できません。pdf フォルダーの本は開けます。');
      setDocuments(docs);
      let previous: string | null = null; try { previous = localStorage.getItem('margin:last-document'); } catch { /* optional */ }
      const first = docs.find(d => d.id === previous) || docs[0];
      if (first) openDocument(first);
      setBooting(false);
    })();
    return () => { disposed = true; abortRef.current?.abort(); };
  }, [openDocument]);
  useEffect(() => { if (doc) { try { saveMessages(doc.id, messages); } catch { setNotice('履歴の保存領域がいっぱいです。必要な会話を書き出してください。'); } } }, [doc, messages]);
  useEffect(() => { if (doc && pageCount) rememberPage(doc.id, page); }, [doc, page, pageCount]);
  useEffect(() => { if (messages.length && chatScroll.current) chatScroll.current.scrollTo({ top: chatScroll.current.scrollHeight, behavior: 'smooth' }); }, [messages, loading]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 7000); return () => clearTimeout(timer); }, [notice]);
  const onReady = useCallback((count: number) => { setPageCount(count); setPage(p => Math.min(p, count)); }, []);
  const onPageContext = useCallback((value: ReadingContext | null) => setPageContext(value), []);
  function goPage(value: number) { if (value === page) return; setPage(value); setSelection(null); setPageContext(null); }
  async function addFile(file?: File) {
    if (!file) return;
    setImporting(true); setError('');
    try { const next = await importPDF(file); setDocuments(docs => docs.some(d => d.id === next.id) ? docs : [...docs, next]); openDocument(next); setNotice('PDF をこのブラウザーに保存しました。'); }
    catch (e) { setError((e as Error).message); } finally { setImporting(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  async function send(text?: string) {
    const prompt = (text ?? question).trim() || (selection ? '選択した箇所をわかりやすく解説してください。' : 'このページの要点を解説してください。');
    if (loading || stopping || abortRef.current || !doc || !context) return;
    if (!selectedProvider?.available) { setError('利用できる CLI を選んでください。接続設定から状態を確認できます。'); return; }
    if (context.kind === 'region' && !context.text && !selectedProvider.supportsImages) { setError('この選択範囲にはテキストがありません。画像を読める Codex を選んでください。'); return; }
    setError(''); setLoading(true); setStopping(false); setStatus('選択した箇所を AI に共有しています'); setQuestion('');
    const requestDoc = doc.id;
    const controller = new AbortController(); abortRef.current = controller;
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', text: prompt, context: { ...context, image: undefined, pageText: '' }, createdAt: Date.now() };
    setMessages(prev => [...prev, userMessage]);
    const history = messages.slice(-10).map(m => ({ role: m.role, text: (m.role === 'user' ? `${m.text}\n[${m.context?.documentName}, p.${m.context?.page}: ${m.context?.text || 'ページ全体'}]` : JSON.stringify(m.explanation)).slice(0, 16000) }));
    try {
      const result = await explain({ provider, question: prompt, style, context: { ...context, image: selectedProvider.supportsImages ? context.image : undefined }, history }, token, controller.signal, status => { if (abortRef.current === controller && !controller.signal.aborted) setStatus(status); });
      if (controller.signal.aborted || activeDoc.current !== requestDoc) return;
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', explanation: result, provider: selectedProvider.name, createdAt: Date.now() }]);
    } catch (e) {
      if (activeDoc.current === requestDoc && abortRef.current === controller) {
        if ((e as Error).name !== 'AbortError') { setError((e as Error).message); setQuestion(prompt); }
        else setNotice('回答の生成を停止しました。');
      }
    } finally { if (abortRef.current === controller) { setLoading(false); setStopping(false); setStatus(''); abortRef.current = null; } }
  }
  function stopAnswer() {
    if (!abortRef.current || stopping) return;
    setStopping(true); setStatus('回答の生成を停止しています…');
    abortRef.current.abort();
  }
  function askFromSelection(text?: string) { if (text) void send(text); else textareaRef.current?.focus(); }
  function toggleMark() {
    if (!doc) return;
    const next = marks.some(m => m.page === page) ? marks.filter(m => m.page !== page) : [...marks, { page, label: selection?.text.slice(0, 60) || `ページ ${page}` }].sort((a, b) => a.page - b.page);
    setMarks(next); try { localStorage.setItem(`margin:marks:${doc.id}`, JSON.stringify(next)); } catch { setNotice('しおりを保存できませんでした。'); }
  }
  function exportChat() {
    const content = [`# ${doc?.name || 'Margin'} — 読書ノート`, ...messages.map(m => m.role === 'user' ? `## 質問\n\n${m.text}\n\n> p.${m.context?.page} ${m.context?.text || 'ページ全体'}` : `## ${m.explanation?.title || '解説'}\n\n${m.explanation?.blocks.map(b => b.type === 'markdown' ? b.content : b.type === 'diagram' ? `### ${b.title}\n\n\`\`\`mermaid\n${b.code}\n\`\`\`\n\n${b.caption}` : b.type === 'chart' ? `### ${b.title}\n\n${b.caption}\n\n\`\`\`json\n${JSON.stringify(b, null, 2)}\n\`\`\`` : `### ${b.title}\n\n${b.caption}\n\n\`\`\`html\n${b.html}\n\`\`\``).join('\n\n')}`)].join('\n\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${doc?.name.replace(/\.pdf$/i, '') || 'margin'}-notes.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function refreshProviders() { try { const session = await getSession(); setToken(session.token); setProviders(session.providers); setNotice('CLI の検出状態を更新しました。'); } catch (e) { setError((e as Error).message); } }
  function jumpTo(context: ReadingContext) { goPage(context.page); if (context.kind !== 'page') setSelection(context); }
  const handleSubmit = (e: FormEvent) => { e.preventDefault(); void send(); };
  return <div className={`app-shell ${sidebar ? '' : 'sidebar-closed'}`} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={e => { e.preventDefault(); setDragging(false); void addFile(e.dataTransfer.files[0]); }}>
    <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={e => void addFile(e.target.files?.[0])} />
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Margin ホーム"><Logo /><span>margin<span className="brand-period">.</span></span></a>
      <p className="sidebar-kicker">YOUR READING SPACE</p>
      <button className="add-document" onClick={() => fileRef.current?.click()} disabled={importing}><Plus size={16} />{importing ? '読み込み中…' : 'PDF を開く'}</button>
      <nav className="sidebar-nav" aria-label="ライブラリー表示"><button className={sidebarTab === 'library' ? 'active' : ''} onClick={() => setSidebarTab('library')}><BookOpen size={17} />ライブラリー<span>{documents.length}</span></button><button className={sidebarTab === 'outline' ? 'active' : ''} onClick={() => setSidebarTab('outline')}><List size={17} />目次</button><button className={sidebarTab === 'marks' ? 'active' : ''} onClick={() => setSidebarTab('marks')}><Bookmark size={17} />しおり<span>{marks.length || ''}</span></button></nav>
      <div className="sidebar-section-label">{sidebarTab === 'library' ? 'MY BOOKS' : sidebarTab === 'outline' ? 'CONTENTS' : 'BOOKMARKS'}<span>{sidebarTab === 'library' && <FolderOpen size={13} />}</span></div>
      <div className="sidebar-content">{sidebarTab === 'library' ? documents.map(d => <div className="document-row" key={d.id}><button className={`document-item ${doc?.id === d.id ? 'selected' : ''}`} key={d.id} onClick={() => { if (d.id !== doc?.id) openDocument(d); }}><span className="document-icon"><FileText size={20} strokeWidth={1.4} /></span><span><strong>{d.name.replace(/\.pdf$/i, '').replaceAll('-', ' ')}</strong><small>PDF <i />{formatSize(d.size)}</small></span>{doc?.id === d.id && <span className="document-active-dot" />}</button>{d.local && <button className="remove-document" aria-label={`${d.name} をライブラリーから外す`} title="ライブラリーから外す" onClick={() => { setRemovingDoc(d); setModal('remove'); }}><X size={12} /></button>}</div>) : sidebarTab === 'outline' ? (outline.length ? outline.map((item, i) => <button key={i} className={`outline-item ${page === item.page ? 'active' : ''}`} style={{ paddingLeft: 12 + Math.min(item.depth, 3) * 10 }} onClick={() => goPage(item.page)}><span>{item.title}</span><small>{item.page}</small></button>) : <p className="sidebar-empty">{doc ? 'この PDF に目次はありません。ページ番号から移動できます。' : 'PDF を開くと目次を表示します。'}</p>) : (marks.length ? marks.map(mark => <button className="outline-item" key={mark.page} onClick={() => goPage(mark.page)}><span>{mark.label}</span><small>{mark.page}</small></button>) : <p className="sidebar-empty">上部のしおりボタンで、また読みたいページを残せます。</p>)}</div>
      <div className="sidebar-bottom"><div className="local-note"><span className="local-icon"><Layers size={17} /></span><div><strong>あなたの本、あなたの場所。</strong><p>PDF はローカルで管理</p></div></div><button className="sidebar-settings" onClick={() => setModal('settings')}><Settings2 size={16} />接続設定<span className="connection-dot" /></button><div className="sidebar-bottom-line"><span>Margin / v0.1</span><button aria-label="使い方と表示サンプル" onClick={() => setModal('demo')}><CircleHelp size={15} /></button></div></div>
    </aside>
    <button className="sidebar-backdrop" aria-label="ライブラリーを閉じる" onClick={() => setSidebar(false)} /><main className="main-workspace">
      <header className="workspace-header"><div className="document-heading"><button className="icon-button sidebar-toggle" onClick={() => setSidebar(s => !s)} aria-label={sidebar ? 'サイドバーを閉じる' : 'サイドバーを開く'}>{sidebar ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</button><span className="header-file-icon"><FileText size={19} /></span><div><h1>{doc?.name.replace(/\.pdf$/i, '').replaceAll('-', ' ') || '読書をはじめよう'}</h1><p>{doc ? `${pageCount || '…'} ページ` : 'PDF と、好奇心をひとつ。'}<span> / </span> PERSONAL LIBRARY</p></div></div><div className="header-actions"><span className="local-badge"><span className="small-dot" />LOCAL</span><button className={`icon-button bookmark-button ${marks.some(m => m.page === page) ? 'bookmarked' : ''}`} aria-label={marks.some(m => m.page === page) ? 'しおりを外す' : 'このページにしおりを追加'} title="しおり" onClick={toggleMark} disabled={!doc}><Bookmark size={19} fill={marks.some(m => m.page === page) ? 'currentColor' : 'none'} /></button></div></header>
      <div className="workspace-body">
        {doc ? <PdfViewer document={doc} page={page} onPage={goPage} onReady={onReady} onOutline={setOutline} onPageContext={onPageContext} selection={selection} onSelect={setSelection} onAsk={askFromSelection} /> : <section className="no-document"><div className="no-document-icon"><BookOpen size={48} strokeWidth={1} /></div><p className="eyebrow">A LITTLE CURIOSITY GOES A LONG WAY</p><h2>読む、その先へ。</h2><p>気になる一文から、理解がひろがる。<br />あなたの PDF を、AI と一緒に読み解きましょう。</p><button className="primary-button" onClick={() => fileRef.current?.click()} disabled={booting || importing}><Upload size={16} />{booting ? 'ライブラリーを読み込み中…' : 'PDF を選ぶ'}</button><small>ここにドラッグ＆ドロップ · 最大 100 MB</small></section>}
        <aside className="assistant-panel" aria-label="AI 解説"><header className="assistant-header"><div><span className="assistant-emblem"><Sparkles size={18} /></span><h2>読書のパートナー</h2><span className="beta-badge">AI</span></div><div className="assistant-header-actions"><button className="icon-button" aria-label="会話を書き出す" title="会話を Markdown で書き出す" onClick={exportChat} disabled={!messages.length}><Download size={16} /></button><button className="icon-button" aria-label="会話をクリア" title="会話をクリア" onClick={() => setModal('clear')} disabled={!messages.length || loading}><Trash2 size={16} /></button></div></header>
          <div className="assistant-scroll" ref={chatScroll}>
            {messages.length === 0 ? <div className="assistant-welcome"><div className="welcome-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" /><Sparkles size={31} strokeWidth={1.2} /><span className="orbit-point p1" /><span className="orbit-point p2" /><span className="orbit-point p3" /></div><p className="eyebrow">MAKE ROOM FOR UNDERSTANDING</p><h2>「わかった」が、<br />ふえる読書を。</h2><p className="welcome-copy">難しい一文も、気になる図も。<br />選んだところから、一緒に読み解きます。</p><div className="welcome-divider"><span />こんなふうに聞いてみよう<span /></div><div className="suggestion-list"><button disabled={!context || loading} onClick={() => void send('このページの要点を、初めて学ぶ人にもわかるように教えてください。')}><span className="suggestion-icon sage"><BookOpen size={18} /></span><span><strong>まずは、やさしく</strong><small>このページの要点を教えて</small></span><ArrowUp size={15} className="diagonal-arrow" /></button><button disabled={!context || loading} onClick={() => { setStyle('visual'); setQuestion('このページの重要な概念と関係を、図で整理してください。'); textareaRef.current?.focus(); }}><span className="suggestion-icon sand"><Layers size={18} /></span><span><strong>つながりを、図で</strong><small>仕組みを視覚的に整理したい</small></span><ArrowUp size={15} className="diagonal-arrow" /></button><button disabled={!context || loading} onClick={() => { setStyle('interactive'); setQuestion('このページの内容を、値を変えながら理解できるインタラクティブな例で説明してください。'); textareaRef.current?.focus(); }}><span className="suggestion-icon lavender"><Settings2 size={18} /></span><span><strong>動かして、納得する</strong><small>条件を変えると、どうなる？</small></span><ArrowUp size={15} className="diagonal-arrow" /></button></div><button className="sample-link" onClick={() => setModal('demo')}>解説の表示サンプルを見る <ArrowRight size={13} /></button></div> : <div className="conversation">{messages.map(message => <article key={message.id} className={`message ${message.role}`}>
              {message.role === 'user' ? <><div className="message-author">あなた<span>{new Date(message.createdAt).toLocaleTimeString('ja', { hour: '2-digit', minute: '2-digit' })}</span></div>{message.context && <button className="message-source" onClick={() => jumpTo(message.context!)}><FileText size={13} /><span>p. {message.context.page} {message.context.kind === 'page' ? 'ページ全体' : message.context.text.slice(0, 90) || '選択した画像'}</span><ChevronRight size={13} /></button>}<p className="user-text">{message.text}</p></> : <><div className="message-author"><Logo small />Margin <span>{message.provider}</span></div><h3 className="answer-title">{message.explanation?.title}</h3>{message.explanation && <ExplanationView explanation={message.explanation} />}{message.explanation?.followUps.length ? <div className="follow-ups">{message.explanation.followUps.map(text => <button key={text} disabled={loading || !context} onClick={() => void send(text)}>{text}<ArrowRight size={13} /></button>)}</div> : null}</>}
            </article>)}</div>}
            {loading && <div className="thinking" role="status"><span className="thinking-icon"><Sparkles size={17} /></span><div><strong>{status}</strong><p>{stopping ? 'CLI の終了を確認しています' : '少しずつ、理解の輪郭をつくっています'}<span className="loading-dots" /></p></div></div>}
          </div>
          <div className="composer-area">{error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="エラーを閉じる" onClick={() => setError('')}><X size={14} /></button></div>}
            {context && <div className={`context-card ${selection ? 'has-selection' : ''}`}><div><span><FileText size={12} />p. {context.page}<i />{selection ? selection.kind === 'region' ? '選択した範囲' : '選択したテキスト' : '読んでいるページ'}</span>{selection && <button aria-label="共有する選択を解除" onClick={() => { setSelection(null); window.getSelection()?.removeAllRanges(); }}><X size={12} /></button>}</div>{selection ? <p>{selection.text || '選択した図・数式を画像で共有します'}</p> : <p>本文を選択すると、その箇所を詳しく聞けます。</p>}</div>}
            <form className="composer" onSubmit={handleSubmit}><textarea ref={textareaRef} aria-label="AI への質問" placeholder={selection ? '選んだところの、何が気になりますか？' : '気になることを聞いてみよう…'} value={question} onChange={e => setQuestion(e.target.value)} maxLength={8000} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} disabled={!doc} rows={2} /><div className="composer-options"><label className="style-select"><Sparkles size={13} /><select aria-label="解説のスタイル" value={style} onChange={e => setStyle(e.target.value as ExplainRequest['style'])}><option value="auto">おまかせ</option><option value="simple">やさしく</option><option value="visual">図解で</option><option value="interactive">動かして理解</option></select></label><GenerationButton generating={loading} stopping={stopping} disabled={!context || !token || !selectedProvider?.available} onStop={stopAnswer} /></div></form>
            <div className="composer-footer"><label><span className={`connection-dot ${selectedProvider?.available ? '' : 'offline'}`} /><select aria-label="AI プロバイダー" value={provider} onChange={e => setProvider(e.target.value)} disabled={loading}>{providers.length ? providers.map(p => <option key={p.id} value={p.id} disabled={!p.available}>{p.name}{!p.available ? '（未検出）' : ''}</option>) : <option value="codex">接続を確認中</option>}</select><span className="cli-label">CLI</span></label><span>⌘ / Ctrl ↵ で送信</span></div><p className="privacy-note">質問時に、選択部分とページの文脈を AI に共有します。</p>
          </div>
        </aside>
      </div>
    </main>
    {notice && <div className="toast" role="status"><Check size={15} />{notice}</div>}
    {dragging && <div className="drop-overlay"><Upload size={42} /><h2>ここに PDF をドロップ</h2><p>あなたのライブラリーに追加します。</p></div>}
    {modal === 'settings' && <Modal title="AI の接続設定" onClose={() => setModal(null)}><p className="settings-intro">この Mac にインストールした CLI と連携します。各 CLI でログイン済みのアカウントを使用します。</p><div className="provider-list">{providers.map(p => <div key={p.id}><span className="provider-icon"><Terminal size={20} /></span><div><strong>{p.name}</strong><p>{p.description}</p></div><span className={`provider-status ${p.available ? 'ready' : ''}`}>{p.available ? '検出済み' : '未検出'}</span></div>)}</div><button className="secondary-button" onClick={() => void refreshProviders()}><RefreshCw size={14} />検出状態を更新</button><p className="settings-note">「検出済み」は実行ファイルが見つかったことを表します。認証・利用枠は質問時に確認されます。</p><div className="settings-section"><h3>最初に一度だけ</h3><p>ターミナルで <code>codex login</code>、または <code>devin</code> を起動してログインしてください。Devin にワークスペースの確認が出た場合は、このプロジェクトで設定してください。</p><h3>共有される情報</h3><p>質問、選択した文章、そのページの本文、直近の会話を送ります。Codex には選択範囲またはページの画像も添付します。PDF 全体は送りません。</p><h3>保存と拡張</h3><p>追加した PDF・会話・しおりはこのブラウザーに保存します。CLI のパスや別のプロバイダーはプロジェクトの <code>.env</code> で設定できます。</p></div></Modal>}
    {modal === 'demo' && <Modal title="テキストの、その先の解説" wide onClose={() => setModal(null)}><div className="demo-label"><FlaskIcon /> 表示サンプル · AI への送信は行いません</div><h3 className="demo-title">{demo.title}</h3><ExplanationView explanation={demo} /></Modal>}
    {modal === 'remove' && removingDoc && <Modal title="ライブラリーから外す" onClose={() => setModal(null)}><p>「{removingDoc.name}」をこのブラウザーのライブラリーから外します。元の PDF ファイルと読書ノートは残ります。</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setModal(null)}>キャンセル</button><button className="primary-button" onClick={() => void (async () => { try { await removePDF(removingDoc.id); const remaining = documents.filter(d => d.id !== removingDoc.id); setDocuments(remaining); if (doc?.id === removingDoc.id) { if (remaining[0]) openDocument(remaining[0]); else { abortRef.current?.abort(); activeDoc.current = null; setDoc(null); setMessages([]); setSelection(null); setPageContext(null); } } setModal(null); setRemovingDoc(null); } catch { setNotice('PDF をライブラリーから外せませんでした。'); } })()}>ライブラリーから外す</button></div></Modal>}
    {modal === 'clear' && <Modal title="この本の会話をクリア" onClose={() => setModal(null)}><p>この本について保存した会話を削除します。必要な内容は先に書き出してください。</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setModal(null)}>キャンセル</button><button className="primary-button" onClick={() => { setMessages([]); setModal(null); }}>会話をクリア</button></div></Modal>}
  </div>;
}
function FlaskIcon() { return <Settings2 size={15} />; }
