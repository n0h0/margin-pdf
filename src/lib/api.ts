import { explanationSchema, type ExplainRequest, type Explanation, type ProviderInfo, type LibraryDocument } from './schema';
export async function getSession(): Promise<{ token: string; providers: ProviderInfo[] }> {
  const response = await fetch('/api/session');
  if (!response.ok) throw new Error('ローカルサーバーに接続できません。起動状態を確認してください。');
  return response.json();
}
export async function getLibrary(): Promise<LibraryDocument[]> {
  const response = await fetch('/api/documents');
  if (!response.ok) throw new Error('PDF ライブラリーを読み込めません。');
  return response.json();
}
const abortError = () => new DOMException('回答の生成を停止しました。', 'AbortError');

async function cancelGeneration(requestId: string, token: string) {
  // This request must survive cancellation of the response stream, including navigation.
  const response = await fetch(`/api/explain/${requestId}/cancel`, {
    method: 'POST', headers: { 'X-Margin-Token': token },
    keepalive: true, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('AI の停止を確認できませんでした。ローカルサーバーの接続を確認してください。');
}

export async function explain(request: ExplainRequest, token: string, signal: AbortSignal, onStatus: (status: string) => void): Promise<Explanation> {
  if (signal.aborted) throw abortError();
  const requestId = crypto.randomUUID();
  const transport = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let rejectCancellation!: (reason: unknown) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  const onAbort = () => {
    // A fetch abort is not a reliable server-side cancellation protocol. Wait for
    // the explicit acknowledgement, then close the local stream independently.
    void cancelGeneration(requestId, token).then(
      () => rejectCancellation(abortError()),
      () => rejectCancellation(new Error('AI の停止を確認できませんでした。ローカルサーバーの接続を確認してください。')),
    ).finally(() => {
      transport.abort();
      void reader?.cancel().catch(() => {});
    });
  };
  signal.addEventListener('abort', onAbort, { once: true });
  const receive = async (): Promise<Explanation> => {
    const response = await fetch('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Margin-Token': token, 'X-Margin-Request-Id': requestId },
      body: JSON.stringify(request), signal: transport.signal,
    });
    if (transport.signal.aborted) { void response.body?.cancel().catch(() => {}); throw abortError(); }
    if (!response.ok) { const body = await response.json(); throw new Error(body.error || 'AI との通信に失敗しました。'); }
    if (!response.body) throw new Error('AI の応答を読み取れませんでした。');
    const stream = response.body.getReader();
    reader = stream;
    const decoder = new TextDecoder();
    let buffer = '', result: Explanation | undefined;
    const consume = (line: string) => {
      if (!line.trim() || signal.aborted) return;
      const event = JSON.parse(line);
      if (event.type === 'status') onStatus(event.text);
      if (event.type === 'cancelled') throw abortError();
      if (event.type === 'error') throw new Error(event.error);
      if (event.type === 'result') result = explanationSchema.parse(event.explanation);
    };
    try {
      while (true) {
        const { value, done } = await stream.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
      }
      buffer += decoder.decode();
      if (buffer.trim()) consume(buffer);
    } finally { stream.releaseLock(); if (reader === stream) reader = undefined; }
    if (!result) throw new Error('AI の応答が途中で終了しました。再試行してください。');
    return result;
  };
  try {
    const result = await Promise.race([receive(), cancelled]);
    // A result can arrive while the stop acknowledgement is in flight.
    if (signal.aborted) return await cancelled;
    return result;
  } catch (error) {
    if (signal.aborted) return await cancelled;
    throw error;
  } finally {
    signal.removeEventListener('abort', onAbort);
    transport.abort();
    void reader?.cancel().catch(() => {});
  }
}
