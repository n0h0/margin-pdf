import 'dotenv/config';
import express from 'express';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { createApp } from './app.ts';
import { loadProviders, providerStatus, createRunner } from './providers.ts';

const providers = await loadProviders();
const app = createApp({ runner: createRunner(providers), providers: () => providerStatus(providers), libraryDir: resolve('pdf') });
const server = createServer(app);
for (const asset of ['cmaps', 'standard_fonts', 'wasm']) {
  app.use(`/pdf-assets/${asset}`, express.static(resolve(`node_modules/pdfjs-dist/${asset}`)));
}
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ server: { middlewareMode: true, ws: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 4317);
server.listen(port, '127.0.0.1', () => console.log(`\n  Margin is ready → http://127.0.0.1:${port}\n`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.locals.abortJobs();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
