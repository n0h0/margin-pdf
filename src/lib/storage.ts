import type { LibraryDocument, Message } from './schema';
const DB_NAME = 'margin-library';
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pdfs', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pdfs', mode);
    const request = operation(tx.objectStore('pdfs'));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}
interface SavedPDF extends LibraryDocument { data: ArrayBuffer }
export async function importPDF(file: File): Promise<LibraryDocument> {
  if (!/\.pdf$/i.test(file.name)) throw new Error('PDF ファイルを選んでください。');
  if (file.size > 100 * 1024 * 1024) throw new Error('100 MB 以下の PDF を選んでください。');
  const data = await file.arrayBuffer();
  if (!new TextDecoder().decode(data.slice(0, 1024)).includes('%PDF-')) throw new Error('有効な PDF ファイルではありません。');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(x => x.toString(16).padStart(2, '0')).join('');
  const doc: SavedPDF = { id: `local:${hash}`, name: file.name, size: file.size, local: true, data };
  await transaction('readwrite', store => store.put(doc));
  return { id: doc.id, name: doc.name, size: doc.size, local: true };
}
export async function localDocuments(): Promise<LibraryDocument[]> {
  const docs = await transaction<SavedPDF[]>('readonly', store => store.getAll());
  return docs.map(({ data: _data, ...meta }) => meta);
}
export async function localPDF(id: string): Promise<ArrayBuffer> {
  const doc = await transaction<SavedPDF | undefined>('readonly', store => store.get(id));
  if (!doc) throw new Error('保存された PDF が見つかりません。もう一度開いてください。');
  return doc.data;
}
export function loadMessages(id: string): Message[] {
  try { return JSON.parse(localStorage.getItem(`margin:chat:${id}`) || '[]'); } catch { return []; }
}
export function saveMessages(id: string, messages: Message[]) {
  // Images are transient; avoid duplicating PDF crops in browser history.
  const saved = messages.slice(-80).map(m => ({ ...m, context: m.context ? { ...m.context, image: undefined, pageText: '' } : undefined }));
  localStorage.setItem(`margin:chat:${id}`, JSON.stringify(saved));
}
export function savedPage(id: string) { try { return Math.max(1, Number(localStorage.getItem(`margin:page:${id}`)) || 1); } catch { return 1; } }
export function rememberPage(id: string, page: number) { try { localStorage.setItem(`margin:page:${id}`, String(page)); } catch { /* reading remains available */ } }

export async function removePDF(id: string) { await transaction('readwrite', store => store.delete(id)); }
