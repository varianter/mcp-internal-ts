import { randomUUID } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig } from './config/config.js';
import { log } from './log.js';
import { SecretsLoader } from './secrets/secrets.js';
import { registerGetCvForConsultant } from './tools/getCvForConsultant.js';
import { registerGithubAppExists } from './tools/githubAppExists.js';
import { registerGithubDeployApp } from './tools/githubDeployApp.js';
import { registerRandomJoke } from './tools/randomJoke.js';
import { registerSearchCvByKeyword } from './tools/searchCvByKeyword.js';

function buildServer(loader: SecretsLoader): McpServer {
  const server = new McpServer({
    name: 'variant-internal-mcp',
    version: '0.1.0',
  });

  registerRandomJoke(server);
  registerGetCvForConsultant(server, loader);
  registerSearchCvByKeyword(server, loader);
  registerGithubAppExists(server, loader);
  registerGithubDeployApp(server, loader);

  return server;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString();
      if (!text) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const loader = new SecretsLoader(cfg.keyVaultUrl);

  // Map session ID → transport (stateful sessions, matching Go implementation).
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpSrv = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // Health check
      if (req.url === '/healthz') {
        res.writeHead(200);
        res.end();
        return;
      }

      // MCP endpoint
      if (req.url === cfg.mcpPath || req.url?.startsWith(`${cfg.mcpPath}?`)) {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        // Reuse existing session transport
        const existingTransport = sessionId ? transports.get(sessionId) : undefined;
        if (existingTransport) {
          const transport = existingTransport;
          let body: unknown;
          if (req.method === 'POST') body = await readBody(req);
          await transport.handleRequest(req, res, body);
          return;
        }

        // New session — must be POST (initial MCP initialize request)
        if (req.method !== 'POST') {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Bad request: session not found');
          return;
        }

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            log('info', 'mcp session opened', { sessionId: id });
            transports.set(id, transport);
          },
        });

        transport.onclose = () => {
          const id = transport.sessionId;
          if (id) {
            log('info', 'mcp session closed', { sessionId: id });
            transports.delete(id);
          }
        };

        const server = buildServer(loader);
        await server.connect(transport);

        const body = await readBody(req);
        await transport.handleRequest(req, res, body);
        return;
      }

      // Not found
      res.writeHead(404);
      res.end();
    } catch (err) {
      log('error', 'request error', { error: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Internal server error');
      }
    }
  });

  const addr = `${cfg.host}:${cfg.port}`;
  httpSrv.listen(cfg.port, cfg.host, () => {
    log('info', 'server started', { addr, mcp: cfg.mcpPath, health: '/healthz' });
  });

  // Graceful shutdown
  const shutdown = (): void => {
    log('info', 'shutting down server');
    const deadline = setTimeout(() => process.exit(1), 30_000);
    deadline.unref();

    httpSrv.close(() => {
      log('info', 'http server closed');
      clearTimeout(deadline);
      process.exit(0);
    });

    // Close all active transports
    for (const transport of transports.values()) {
      transport.close().catch(() => undefined);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  process.stderr.write(
    `${JSON.stringify({ level: 'error', msg: 'startup failed', error: String(err) })}\n`,
  );
  process.exit(1);
});
