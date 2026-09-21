import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app';
import { runProcess, type Runner } from '../server/providers';
import { explain } from '../src/lib/api';
import type { ExplainRequest } from '../src/lib/schema';

const input: ExplainRequest = {
  provider: 'devin', question: '説明して', style: 'auto', history: [],
  context: { documentId: 'synthetic', documentName: 'test.pdf', page: 1, pageCount: 1, kind: 'text', text: 'A cache stores data.', pageText: 'A cache stores data.', rects: [] },
};
const answer = { title: 'テスト', blocks: [{ type: 'markdown' as const, content: '回答' }], followUps: [] };
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const servers: Server[] = [];
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const action of cleanup.splice(0)) await action();
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
async function start(runner: Runner) {
  const app = createApp({ runner, providers: async () => [], libraryDir: tmpdir() });
  cleanup.push(() => app.locals.abortJobs());
  const server = createServer(app);
  servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server port');
  const base = `http://127.0.0.1:${address.port}`;
  const { token } = await (await fetch(`${base}/api/session`)).json();
  return {
    begin: (id: string, signal?: AbortSignal) => fetch(`${base}/api/explain`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Margin-Token': token, 'X-Margin-Request-Id': id }, body: JSON.stringify(input), signal }),
    cancel: (id: string, auth = token) => fetch(`${base}/api/explain/${id}/cancel`, { method: 'POST', headers: { 'X-Margin-Token': auth } }),
  };
}

describe('explicit cancellation API', () => {
  it('stops the job while the response connection is open and acknowledges only after cleanup', async () => {
    const aborted = deferred(); const cleaned = deferred();
    cleanup.push(() => cleaned.resolve());
    const runner: Runner = async (_input, signal) => {
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { aborted.resolve(); resolve(); }, { once: true }));
      await cleaned.promise;
      // Simulate an adapter finishing at the same time as cancellation.
      return answer;
    };
    const api = await start(runner); const id = randomUUID();
    const response = await api.begin(id);
    let acknowledged = false;
    const cancellation = api.cancel(id).then(res => { acknowledged = true; return res; });
    await aborted.promise;
    expect(acknowledged).toBe(false);
    cleaned.resolve();
    expect((await cancellation).status).toBe(200);
    expect(await response.text()).toBe('{"type":"cancelled"}\n');
    expect((await api.cancel(id)).status).toBe(200);
  });
  it('does not start a CLI when cancellation arrives before the context upload', async () => {
    const runner = vi.fn(async () => answer);
    const api = await start(runner); const id = randomUUID();
    expect((await api.cancel(id)).status).toBe(200);
    expect(await (await api.begin(id)).text()).toContain('"cancelled"');
    expect(runner).not.toHaveBeenCalled();
  });
  it('requires authentication for cancellation and validates request IDs', async () => {
    const api = await start(async () => answer);
    expect((await api.cancel(randomUUID(), 'wrong-token')).status).toBe(403);
    expect((await api.cancel('not-a-uuid')).status).toBe(400);
    expect((await api.begin('not-a-uuid')).status).toBe(400);
  });
  it('cancels only the requested job and immediately frees its execution slot', async () => {
    const signals: AbortSignal[] = [];
    const api = await start(async (_input, signal) => {
      signals.push(signal);
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      throw new Error('cancelled');
    });
    const first = randomUUID(), second = randomUUID(), third = randomUUID();
    const response1 = await api.begin(first), response2 = await api.begin(second);
    expect((await api.begin(third)).status).toBe(429);
    await api.cancel(first);
    expect(signals[0].aborted).toBe(true); expect(signals[1].aborted).toBe(false);
    const response3 = await api.begin(third);
    expect(response3.status).toBe(200);
    await api.cancel(second); await api.cancel(third);
    await Promise.all([response1.text(), response2.text(), response3.text()]);
  });
  it('still stops the CLI on a disconnected response without an explicit stop request', async () => {
    const aborted = deferred();
    const api = await start(async (_input, signal) => {
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { aborted.resolve(); resolve(); }, { once: true }));
      throw new Error('cancelled');
    });
    const controller = new AbortController();
    const response = await api.begin(randomUUID(), controller.signal);
    controller.abort();
    await expect(response.text()).rejects.toMatchObject({ name: 'AbortError' });
    await aborted.promise;
  });
});

describe('browser cancellation', () => {
  it('still delivers a normal streamed answer without sending a cancel request', async () => {
    const events = JSON.stringify({ type: 'status', text: '解説中' }) + '\n' + JSON.stringify({ type: 'result', explanation: answer }) + '\n';
    const bytes = new TextEncoder().encode(events);
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, 33)); controller.enqueue(bytes.slice(33)); controller.close();
    } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body));
    vi.stubGlobal('fetch', fetchMock);
    const status = vi.fn();
    await expect(explain(input, 'token', new AbortController().signal, status)).resolves.toEqual(answer);
    expect(status).toHaveBeenCalledExactlyOnceWith('解説中');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('does not hang on a stream that ignores fetch abort; waits for the server acknowledgement', async () => {
    const acknowledgement = deferred<Response>();
    const streamCancelled = vi.fn();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(new ReadableStream({ cancel: streamCancelled })))
      .mockImplementationOnce(() => acknowledgement.promise);
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    let settled = false;
    const pending = explain(input, 'token', controller.signal, vi.fn());
    const outcome = pending.catch(error => { settled = true; return error; });
    await Promise.resolve();
    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const id = (fetchMock.mock.calls[0][1].headers as Record<string, string>)['X-Margin-Request-Id'];
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/explain/${id}/cancel`);
    expect(fetchMock.mock.calls[1][1].signal).not.toBe(controller.signal);
    expect(fetchMock.mock.calls[1][1].headers['X-Margin-Token']).toBe('token');
    acknowledgement.resolve(new Response('{"cancelled":true}'));
    expect(await outcome).toMatchObject({ name: 'AbortError' });
    expect(streamCancelled).toHaveBeenCalled();
  });
  it('can stop before response headers arrive, without waiting for the generation request', async () => {
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(new Response('{"cancelled":true}'));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const pending = explain(input, 'token', controller.signal, vi.fn());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('does not report success when the server could not confirm cancellation', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(new ReadableStream()))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const pending = explain(input, 'token', controller.signal, vi.fn());
    controller.abort();
    await expect(pending).rejects.toThrow('停止を確認できませんでした');
  });
  it('suppresses results and status messages that arrive after stop was requested', async () => {
    const acknowledgement = deferred<Response>();
    let output!: ReadableStreamDefaultController;
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { output = controller; } })))
      .mockImplementationOnce(() => acknowledgement.promise);
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController(); const onStatus = vi.fn();
    const pending = explain(input, 'token', controller.signal, onStatus);
    await Promise.resolve(); controller.abort();
    output.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'status', text: 'late status' }) + '\n' + JSON.stringify({ type: 'result', explanation: answer }) + '\n'));
    output.close(); acknowledgement.resolve(new Response('{"cancelled":true}'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(onStatus).not.toHaveBeenCalled();
  });
});

describe('stubborn CLI process', () => {
  it('forces termination when the CLI ignores SIGTERM, before acknowledging cancellation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'margin-stop-test-'));
    const pidFile = join(dir, 'pid');
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const controller = new AbortController();
    cleanup.push(() => controller.abort());
    const pending = runProcess(process.execPath, ['-e', `process.on('SIGTERM',()=>{});require('fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)`, pidFile], dir, '', controller.signal);
    const outcome = pending.catch(error => error);
    let pid = 0;
    await vi.waitFor(async () => { pid = Number(await readFile(pidFile, 'utf8')); expect(pid).toBeGreaterThan(0); });
    controller.abort();
    expect(await outcome).toMatchObject({ message: 'キャンセルしました。' });
    expect(() => process.kill(pid, 0)).toThrow();
  });
});
