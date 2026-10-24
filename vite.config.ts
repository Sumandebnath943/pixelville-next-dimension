import { defineConfig } from 'vitest/config';
import { loadEnv, type Plugin } from 'vite';

/** the villager chat proxy in development: the same code as the Vercel function (api/_chat.ts),
    with the key from .env.local, which only this server process ever sees */
function chatApi(): Plugin {
  return {
    name: 'pixelville-chat-api',
    configureServer(server) {
      const env = loadEnv('development', '.', '');
      server.middlewares.use('/api/chat', (req: any, res: any) => {
        let raw = '';
        req.on('data', (c: any) => {
          raw += c;
          if (raw.length > 20_000) req.destroy();
        });
        req.on('end', async () => {
          const { handleChat, ready } = await server.ssrLoadModule('/api/_chat.ts');
          let r = { status: 200, json: ready({ GROQ_API_KEY: env.GROQ_API_KEY }) as Record<string, unknown> };
          if (req.method === 'POST') {
            let body: unknown = null;
            try { body = JSON.parse(raw); } catch { /* handled as a bad request */ }
            r = await handleChat(body, { GROQ_API_KEY: env.GROQ_API_KEY, GROQ_MODEL: env.GROQ_MODEL }, req.socket?.remoteAddress || 'local');
          }
          res.statusCode = r.status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(r.json));
        });
      });
    },
  };
}

export default defineConfig({
  server: { port: 5173 },
  plugins: [chatApi()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      // the game, and the V2 look lab (vertical slice)
      input: { main: 'index.html', slice: 'slice.html' },
    },
  },
  // texture workers import three.js as an ES module
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
