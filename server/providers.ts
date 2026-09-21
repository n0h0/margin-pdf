import { access, readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { buildPrompt, outputSchema, parseExplanation } from './prompt.ts';
import type { ExplainRequest, ProviderInfo, Explanation } from '../src/lib/schema.ts';

type Provider = { id: string; name: string; command: string; args: string[]; description: string; kind: 'codex' | 'devin' | 'custom'; supportsImages: boolean };
const customSchema = z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), name: z.string(), command: z.string().min(1), args: z.array(z.string()), supportsImages: z.boolean().default(false), description: z.string().default('カスタム CLI') }).strict());
export async function loadProviders(): Promise<Provider[]> {
  const providers: Provider[] = [
    { id: 'codex', name: 'Codex', command: process.env.CODEX_BIN || 'codex', args: [], kind: 'codex', supportsImages: true, description: 'Codex CLI · テキストと画像' },
    { id: 'devin', name: 'Devin', command: process.env.DEVIN_BIN || 'devin', args: [], kind: 'devin', supportsImages: false, description: 'Devin CLI · テキスト' },
  ];
  if (process.env.AI_PROVIDERS_FILE) {
    const custom = customSchema.parse(JSON.parse(await readFile(process.env.AI_PROVIDERS_FILE, 'utf8')));
    for (const item of custom) {
      if (providers.some(p => p.id === item.id)) throw new Error(`Provider ID is duplicated: ${item.id}`);
      providers.push({ ...item, kind: 'custom' });
    }
  }
  return providers;
}
async function executable(command: string) {
  const candidates = isAbsolute(command) ? [command] : (process.env.PATH || '').split(delimiter).map(p => join(p, command));
  for (const path of candidates) { try { await access(path, constants.X_OK); return true; } catch { /* next */ } }
  return false;
}
export async function providerStatus(providers: Provider[]): Promise<ProviderInfo[]> {
  return Promise.all(providers.map(async p => ({ id: p.id, name: p.name, description: p.description, supportsImages: p.supportsImages, available: await executable(p.command) })));
}
export type Runner = (request: ExplainRequest, signal: AbortSignal, onStatus: (text: string) => void) => Promise<Explanation>;
export function createRunner(providers: Provider[]): Runner {
  return async (request, signal, onStatus) => {
    const provider = providers.find(p => p.id === request.provider);
    if (!provider) throw new Error('この AI プロバイダーは登録されていません。');
    if (!(await executable(provider.command))) throw new Error(`${provider.name} CLI が見つかりません。インストールと PATH を確認してください。`);
    if (signal.aborted) throw new Error('キャンセルしました。');
    const workdir = await mkdtemp(join(tmpdir(), 'margin-ai-'));
    try {
      const schemaPath = join(workdir, 'response.schema.json');
      const outputPath = join(workdir, 'response.json');
      const promptPath = join(workdir, 'prompt.txt');
      let imagePath: string | undefined;
      if (request.context.image && provider.supportsImages) {
        imagePath = join(workdir, 'selection.png');
        const bytes = Buffer.from(request.context.image.split(',')[1], 'base64');
        if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('選択画像の形式が正しくありません。');
        await writeFile(imagePath, bytes, { mode: 0o600 });
      }
      const prompt = buildPrompt(request, imagePath);
      await writeFile(promptPath, prompt, { mode: 0o600 });
      await writeFile(schemaPath, JSON.stringify(outputSchema), { mode: 0o600 });
      let args: string[];
      if (provider.kind === 'codex') {
        args = ['exec', '--ignore-user-config', '--disable', 'shell_tool', '--disable', 'unified_exec', '--disable', 'multi_agent', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--color', 'never', '--output-schema', schemaPath, '--output-last-message', outputPath];
        if (process.env.CODEX_MODEL) args.push('--model', process.env.CODEX_MODEL);
        if (imagePath) args.push('--image', imagePath);
        args.push('-');
      } else if (provider.kind === 'devin') {
        // Preserve workspace trust and permission checks. Never opt into dangerous mode.
        args = ['--print', '--permission-mode', 'auto', '--prompt-file', promptPath];
        if (process.env.DEVIN_MODEL) args.push('--model', process.env.DEVIN_MODEL);
      } else {
        args = provider.args.map(arg => arg.replaceAll('{promptFile}', promptPath).replaceAll('{schemaFile}', schemaPath).replaceAll('{imageFile}', imagePath || '').replaceAll('{outputFile}', outputPath));
      }
      onStatus(`${provider.name} が選択した箇所を読み解いています`);
      const raw = await runProcess(provider.command, args, provider.kind === 'devin' ? process.cwd() : workdir, prompt, signal);
      let result = raw;
      if (provider.kind === 'codex') {
        try { result = await readFile(outputPath, 'utf8'); } catch { throw new Error('Codex が最終回答を保存できませんでした。CLI のログイン状態を確認してください。'); }
      } else if (provider.kind === 'custom') {
        try { result = await readFile(outputPath, 'utf8'); } catch { /* stdout provider */ }
      }
      return parseExplanation(result);
    } finally { await rm(workdir, { recursive: true, force: true }); }
  };
}
export function runProcess(command: string, args: string[], cwd: string, input: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('キャンセルしました。')); return; }
    const child = spawn(command, args, { cwd, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
    let stdout = '', stderr = '', failure: Error | undefined;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      const kill = (sig: NodeJS.Signals) => {
        try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, sig); else child.kill(sig); } catch { /* exited */ }
      };
      kill('SIGTERM');
      forceTimer = setTimeout(() => kill('SIGKILL'), 1500);
      forceTimer.unref();
    };
    const abort = () => stop(new Error('キャンセルしました。'));
    signal.addEventListener('abort', abort, { once: true });
    const timeoutMs = Number(process.env.AI_TIMEOUT_MS || 300000);
    const timer = setTimeout(() => stop(new Error('AI の応答がタイムアウトしました。CLI のログイン状態を確認するか、質問を短くしてください。')), Math.max(1000, Math.min(900000, Number.isFinite(timeoutMs) ? timeoutMs : 300000)));
    const cleanup = () => { clearTimeout(timer); if (forceTimer) clearTimeout(forceTimer); signal.removeEventListener('abort', abort); };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => { if (failure) return; stdout += data; if (stdout.length > 1000000) stop(new Error('CLI の出力が上限を超えました。')); });
    child.stderr.on('data', (data: string) => { stderr = (stderr + data).slice(-8000); });
    child.stdin.on('error', () => { /* a CLI may exit before reading stdin; handled in close */ });
    child.once('error', error => { cleanup(); reject(new Error(`CLI を起動できませんでした: ${error.message}`)); });
    child.once('close', code => {
      cleanup();
      if (failure && child.pid && process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group has exited */ } }
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`CLI が終了しました (code ${code})。${stderr.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').slice(-1600) || '認証・利用制限・ワークスペースの信頼設定を確認してください。'}`));
      else resolve(stdout);
    });
    child.stdin.end(input);
  });
}
