import { corsPreflight, json } from "./response";
import { matchRoute, type PublicRouteTable, type RouteTable } from "./route";
import { csrfGuard } from "./csrf";
import { errorResponse } from "./errors";
import { authRoutes } from "./routes/auth";
import { bookRoutes } from "./routes/books";
import { bookSearchRoutes } from "./routes/bookSearch";
import { chapterRoutes } from "./routes/chapters";
import { segmentRoutes } from "./routes/segments";
import { audioRoutes } from "./routes/audio";
import { castRoutes } from "./routes/cast";
import { playbackRoutes } from "./routes/playback";
import { pronunciationRoutes } from "./routes/pronunciation";
import { eventRoutes } from "./routes/events";
import { authenticateRequest } from "../auth";

const PUBLIC_ROUTES: PublicRouteTable = authRoutes;

const PROTECTED_ROUTES: RouteTable[] = [
  bookRoutes,
  bookSearchRoutes,
  chapterRoutes,
  segmentRoutes,
  audioRoutes,
  castRoutes,
  playbackRoutes,
  pronunciationRoutes,
  eventRoutes,
];

export async function handleRequest(req: Request, connectionIp = "unknown"): Promise<Response> {
  const path = new URL(req.url).pathname;

  if (req.method === "OPTIONS") {
    return corsPreflight();
  }

  const blocked = csrfGuard(req);
  if (blocked) return blocked;

  try {
    return await dispatch(req, path, connectionIp);
  } catch (error) {
    return errorResponse(error, req, path);
  }
}

async function dispatch(req: Request, path: string, connectionIp: string): Promise<Response> {
  const user = await authenticateRequest(req);

  const publicMatch = matchRoute(PUBLIC_ROUTES, req.method, path);
  if (publicMatch) {
    return publicMatch.handler({ req, path, params: publicMatch.params, user, connectionIp });
  }

  if (!user) return json({ error: "Authentication required" }, 401);

  for (const table of PROTECTED_ROUTES) {
    const match = matchRoute(table, req.method, path);
    if (match) {
      return match.handler({ req, path, params: match.params, user, connectionIp });
    }
  }

  return json({ error: "Endpoint not found" }, 404);
}
