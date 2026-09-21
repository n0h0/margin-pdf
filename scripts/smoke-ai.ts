import 'dotenv/config';
import { createRunner, loadProviders } from '../server/providers.ts';
import { explanationSchema, type ExplainRequest } from '../src/lib/schema.ts';
const provider = process.argv[2] || 'codex';
const input: ExplainRequest = {
  provider, question: 'これは接続テストです。キャッシュを日本語で短く説明し、簡単な図も1つ付けてください。ツールは使わないでください。', style: 'visual', history: [],
  context: { documentId: 'synthetic-test', documentName: 'Connection test (synthetic)', page: 1, pageCount: 1, kind: 'text', text: 'A cache stores frequently accessed data to reduce latency.', pageText: 'Cache hits can be served faster than requests to the origin.', rects: [] },
};
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
const runner = createRunner(await loadProviders());
try {
  const result = await runner(input, controller.signal, status => console.log(status));
  explanationSchema.parse(result);
  console.log(JSON.stringify({ provider, title: result.title, blocks: result.blocks.map(b => b.type), valid: true }, null, 2));
} catch (error) { console.error((error as Error).message); process.exitCode = 1; }
