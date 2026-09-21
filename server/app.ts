import express from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir, stat, realpath } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { requestSchema } from '../src/lib/schema.ts';
import type { ProviderInfo } from '../src/lib/schema.ts';
import type { Runner } from './providers.ts';

export function createApp(options: { runner: Runner; providers: () => Promise<ProviderInfo[]>; libraryDir: string }) {
  const app = express();
  app.disable('x-powered-by');
  const token = randomBytes(32).toString('hex');
  const jobs = new Map<string, { controller: AbortController; done: Promise<void> }>();
  const cancelledIds = new Map<string, number>();
  const isRequestId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const pruneCancelled = () => {
    for (const [id, expires] of cancelledIds) if (expires <= Date.now()) cancelledIds.delete(id);
  };
  app.locals.abortJobs = () => { for (const job of jobs.values()) job.controller.abort(); };
  app.use((req, res, next) => {
    // Host and Origin checks also prevent DNS rebinding and cross-site localhost requests.
    const host = req.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) { res.status(403).json({ error: 'ローカルホストからアクセスしてください。' }); return; }
    const origin = req.headers.origin;
    if ((origin && origin !== `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') { res.status(403).json({ error: '外部サイトからのアクセスは許可されていません。' }); return; }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '8mb' }));
  app.get('/api/session', async (_req, res) => { res.json({ token, providers: await options.providers() }); });
  app.get('/api/documents', async (_req, res) => {
    try {
      const entries = await readdir(options.libraryDir, { withFileTypes: true });
      const documents = await Promise.all(entries.filter(e => e.isFile() && /\.pdf$/i.test(e.name)).map(async e => ({
        id: `library:${e.name}`, name: e.name, size: (await stat(join(options.libraryDir, e.name))).size, url: `/api/documents/${encodeURIComponent(e.name)}`,
      })));
      res.json(documents);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') res.json([]); else throw error; }
  });
  app.get('/api/documents/:name', async (req, res) => {
    const name = req.params.name;
    if (name !== basename(name) || !/\.pdf$/i.test(name) || name.includes('\\')) { res.sendStatus(400); return; }
    try {
      const file = await realpath(join(options.libraryDir, name));
      const base = await realpath(options.libraryDir);
      if (file !== join(base, name)) { res.sendStatus(403); return; }
      res.type('application/pdf').sendFile(resolve(file));
    } catch { res.sendStatus(404); }
  });
  app.post('/api/explain', async (req, res) => {
    if (req.headers['x-margin-token'] !== token) { res.status(403).json({ error: '接続の有効期限が切れました。ページを再読み込みしてください。' }); return; }
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: '質問または選択範囲が大きすぎるか、形式が正しくありません。' }); return; }
    const requestId = req.get('X-Margin-Request-Id') || randomUUID();
    if (!isRequestId(requestId)) { res.status(400).json({ error: 'リクエスト ID が正しくありません。' }); return; }
    pruneCancelled();
    // A stop request may overtake the (potentially large) context upload.
    if (cancelledIds.has(requestId)) { res.type('application/x-ndjson').send(JSON.stringify({ type: 'cancelled' }) + '\n'); return; }
    if (jobs.has(requestId)) { res.status(409).json({ error: '同じ質問が実行中です。' }); return; }
    if (jobs.size >= 2) { res.status(429).json({ error: 'AI が他の質問に回答しています。少し待って再試行してください。' }); return; }
    const controller = new AbortController();
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    jobs.set(requestId, { controller, done });
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (event: unknown) => { if (!res.destroyed) res.write(JSON.stringify(event) + '\n'); };
    const heartbeat = setInterval(() => send({ type: 'heartbeat' }), 15000);
    try {
      const explanation = await options.runner(parsed.data, controller.signal, text => send({ type: 'status', text }));
      send(controller.signal.aborted ? { type: 'cancelled' } : { type: 'result', explanation });
    } catch (error) {
      send(controller.signal.aborted ? { type: 'cancelled' } : { type: 'error', error: error instanceof Error ? error.message : 'AI との通信に失敗しました。' });
    } finally {
      clearInterval(heartbeat); jobs.delete(requestId); finish(); res.end();
    }
  });
  app.post('/api/explain/:requestId/cancel', async (req, res) => {
    if (req.headers['x-margin-token'] !== token) { res.status(403).json({ error: '接続の有効期限が切れました。ページを再読み込みしてください。' }); return; }
    const requestId = req.params.requestId;
    if (!isRequestId(requestId)) { res.status(400).json({ error: 'リクエスト ID が正しくありません。' }); return; }
    pruneCancelled();
    cancelledIds.set(requestId, Date.now() + 5 * 60 * 1000);
    while (cancelledIds.size > 1000) cancelledIds.delete(cancelledIds.keys().next().value!);
    const job = jobs.get(requestId);
    if (job) {
      job.controller.abort();
      // Acknowledge only after the CLI and its cleanup have actually finished.
      await job.done;
    }
    res.json({ cancelled: true });
  });
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'API が見つかりません。' }); });
  const handleError: express.ErrorRequestHandler = (error, _req, res, _next) => {
    console.error(error instanceof Error ? error.message : 'Server error');
    if (!res.headersSent) res.status(error.type === 'entity.too.large' ? 413 : 500).json({ error: error.type === 'entity.too.large' ? '選択画像が大きすぎます。範囲を小さくしてください。' : 'ローカルサーバーでエラーが発生しました。' });
  };
  app.use(handleError);
  return app;
}
