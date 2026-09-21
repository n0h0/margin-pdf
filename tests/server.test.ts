import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { buildPrompt, parseExplanation, outputSchema } from '../server/prompt';
import { runProcess } from '../server/providers';
import { frameDocument } from '../src/lib/frames';
import { demo } from '../src/lib/demo';
import { explanationSchema, requestSchema, type ExplainRequest } from '../src/lib/schema';

const library = await mkdtemp(join(tmpdir(), 'margin-test-'));
await writeFile(join(library, 'test.pdf'), '%PDF-1.7\nfixture');
const payload: ExplainRequest = {
  provider: 'codex', question: 'キャッシュを説明して', style: 'auto', history: [],
  context: { documentId: 'test', documentName: 'test.pdf', page: 2, pageCount: 4, kind: 'text', text: 'A cache stores frequently accessed data.', pageText: 'Caching improves response time.', rects: [{ x: .1, y: .2, width: .5, height: .1 }] },
};
const answer = { title: 'キャッシュ', blocks: [{ type: 'markdown' as const, content: 'p. 2 のキャッシュは…' }], followUps: [] };
const runner = vi.fn(async (_request, _signal, onStatus) => { onStatus('解説中'); return answer; });
const providers = async () => [{ id: 'codex', name: 'Codex', available: true, supportsImages: true, description: 'test' }];
const app = createApp({ runner, providers, libraryDir: library });
const server = createServer(app);
beforeAll(() => new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)));
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(library, { recursive: true, force: true }); });
beforeEach(() => { runner.mockClear(); });
const local = (method: 'get' | 'post', path: string) => request(server)[method](path).set('Host', '127.0.0.1:4317');
async function token() { return (await local('get', '/api/session')).body.token; }

describe('local API boundary and request flow', () => {
  it('returns library PDFs and serves the exact file', async () => {
    const response = await local('get', '/api/documents');
    expect(response.status).toBe(200); expect(response.body).toHaveLength(1);
    const pdf = await local('get', response.body[0].url);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.status).toBe(200);
  });
  it('rejects foreign hosts, origins and cross-site fetches', async () => {
    expect((await request(server).get('/api/session').set('Host', 'evil.example')).status).toBe(403);
    expect((await local('get', '/api/session').set('Origin', 'https://evil.example')).status).toBe(403);
    expect((await local('get', '/api/session').set('Sec-Fetch-Site', 'cross-site')).status).toBe(403);
    expect(runner).not.toHaveBeenCalled();
  });
  it('requires a session token before launching a CLI', async () => {
    expect((await local('post', '/api/explain').send(payload)).status).toBe(403);
    expect(runner).not.toHaveBeenCalled();
  });
  it('rejects invalid context and injected executable arguments', async () => {
    const response = await local('post', '/api/explain').set('X-Margin-Token', await token()).send({ ...payload, command: 'rm', context: { ...payload.context, page: -1 } });
    expect(response.status).toBe(400); expect(runner).not.toHaveBeenCalled();
  });
  it('streams status and a validated explanation with exact source context', async () => {
    const response = await local('post', '/api/explain').set('X-Margin-Token', await token()).send(payload);
    expect(response.status).toBe(200);
    const events = response.text.trim().split('\n').map(line => JSON.parse(line));
    expect(events.map(e => e.type)).toEqual(['status', 'result']);
    expect(events[1].explanation).toEqual(answer);
    expect(runner.mock.calls[0][0]).toEqual(payload);
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('does not allow traversal outside the PDF directory', async () => {
    const response = await local('get', '/api/documents/%2e%2e%2fsecret.pdf');
    expect([400, 403, 404]).toContain(response.status);
  });
});
describe('source grounding and structured output', () => {
  it('includes selected passage, page context, history and untrusted-source instructions', () => {
    const prompt = buildPrompt({ ...payload, history: [{ role: 'user', text: '前の質問' }] });
    expect(prompt).toContain('A cache stores'); expect(prompt).toContain('Caching improves');
    expect(prompt).toContain('前の質問'); expect(prompt).toContain('untrusted'); expect(prompt).toContain('No image is available');
    expect(outputSchema).toHaveProperty('type', 'object'); expect(JSON.stringify(outputSchema)).not.toContain('oneOf');
  });
  it('accepts structured JSON, fenced JSON and plain text without executing it', () => {
    expect(parseExplanation(JSON.stringify(answer))).toEqual(answer);
    expect(parseExplanation('```json\n' + JSON.stringify(answer) + '\n```')).toEqual(answer);
    expect(parseExplanation('ready\n' + JSON.stringify(answer))).toEqual(answer);
    expect(parseExplanation('単純なテキストです').blocks[0]).toEqual({ type: 'markdown', content: '単純なテキストです' });
    expect(() => parseExplanation('')).toThrow();
  });
  it('validates all visual block types and refuses inconsistent chart values', () => {
    expect(explanationSchema.safeParse(demo).success).toBe(true);
    const invalid = { ...demo, blocks: demo.blocks.filter(b => b.type === 'chart').map(b => ({ ...b, labels: ['one'] })) };
    expect(() => parseExplanation(JSON.stringify(invalid))).toThrow('グラフ');
  });
  it('limits oversized requests before provider execution', () => {
    expect(requestSchema.safeParse({ ...payload, question: 'a'.repeat(8001) }).success).toBe(false);
    expect(requestSchema.safeParse({ ...payload, context: { ...payload.context, image: 'https://example.com/tracker' } }).success).toBe(false);
  });
  it('installs a CSP ahead of generated interactive content', () => {
    const frame = frameDocument('<script>alert(1)</script>', true);
    expect(frame.indexOf('Content-Security-Policy')).toBeLessThan(frame.indexOf('<script>'));
    expect(frame).toContain("connect-src 'none'"); expect(frame).toContain("form-action 'none'"); expect(frame).toContain("frame-src 'none'");
    expect(frameDocument('<svg/>', false)).toContain("script-src 'none'");
  });
});
describe('CLI process lifecycle', () => {
  it('pipes text literally to stdin, including shell metacharacters', async () => {
    const text = '$(touch /tmp/must-not-run) `echo test`; <source>日本語</source>';
    const result = await runProcess(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], library, text, new AbortController().signal);
    expect(result).toBe(text);
  });
  it('terminates a running process on cancellation', async () => {
    const controller = new AbortController();
    const running = runProcess(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], library, '', controller.signal);
    setTimeout(() => controller.abort(), 100);
    await expect(running).rejects.toThrow('キャンセル');
  });
  it('reports missing executables and failed processes', async () => {
    await expect(runProcess('/does-not-exist', [], library, '', new AbortController().signal)).rejects.toThrow('起動');
    await expect(runProcess(process.execPath, ['-e', 'process.stderr.write("login required");process.exit(2)'], library, '', new AbortController().signal)).rejects.toThrow('login required');
  });
});
