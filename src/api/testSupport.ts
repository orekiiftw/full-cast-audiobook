import { json } from "./response";
import { matchRoute, type RouteHandler } from "./route";
import type { AuthUser } from "../auth";

export async function dispatchRoute<Handler extends RouteHandler>(
  table: Record<string, Handler>,
  req: Request,
  user: AuthUser,
  connectionIp = "unknown",
): Promise<Response> {
  const path = new URL(req.url).pathname;
  const match = matchRoute(table, req.method, path);
  if (!match) return json({ error: "Endpoint not found" }, 404);
  return match.handler({ req, path, params: match.params, user, connectionIp });
}
