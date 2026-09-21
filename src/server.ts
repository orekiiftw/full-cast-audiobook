import { handleRequest } from "./api/router";
import { startPipeline } from "./orchestrator";
import { stopPipeline } from "./queue";
import { parsedClientIp } from "./auth";
import { serveStaticFile } from "./staticFiles";
import { reportEnvironment } from "./environment";

reportEnvironment();

await startPipeline();

const host = process.env.HOST || "127.0.0.1";

const server = Bun.serve({
  port: Number(process.env.PORT) || 3000,
  hostname: host,
  idleTimeout: 120,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/healthz" || url.pathname === "/health") {
      return new Response("ok", {
        headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
      });
    }

    if (url.pathname.startsWith("/api")) {
      return handleRequest(req, connectionIp(req));
    }

    try {
      const staticResponse = await serveStaticFile(req);
      if (staticResponse) return staticResponse;
    } catch (error) {
      console.error("Static serve error:", error);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`🚀 AI Audiobook performance server running at http://${host}:${server.port}`);

function connectionIp(req: Request): string {
  const socket = (server as { requestIP?: (r: Request) => { address: string } | null }).requestIP?.(req);
  return parsedClientIp(req, socket?.address ?? "unknown");
}

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down pipeline workers...`);

  const forceExit = setTimeout(() => {
    console.error("Shutdown grace period expired; force-exiting (active jobs will resume via stalled recovery).");
    process.exit(1);
  }, 30_000);

  try {
    server.stop();
    await stopPipeline();
  } catch (err) {
    console.error("Error during shutdown:", err);
  } finally {
    clearTimeout(forceExit);
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
