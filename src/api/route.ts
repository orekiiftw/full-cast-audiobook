import type { AuthUser } from "../auth";

export type RouteParams = Readonly<Record<string, string>>;

export interface PublicRouteContext {
  req: Request;
  path: string;
  params: RouteParams;
  user: AuthUser | null;
  connectionIp: string;
}

export interface RouteContext extends Omit<PublicRouteContext, "user"> {
  user: AuthUser;
}

export type PublicRouteHandler = (ctx: PublicRouteContext) => Promise<Response>;
export type RouteHandler = (ctx: RouteContext) => Promise<Response>;

export type PublicRouteTable = Record<string, PublicRouteHandler>;
export type RouteTable = Record<string, RouteHandler>;

export interface RouteMatch<Handler> {
  handler: Handler;
  params: RouteParams;
}

const PATH_PARAM_RE = /^:([A-Za-z][A-Za-z0-9_]*)$/;

export function matchRoute<Handler extends RouteHandler | PublicRouteHandler>(
  table: Record<string, Handler>,
  method: string,
  path: string,
): RouteMatch<Handler> | null {
  const pathSegments = path.split("/");
  for (const [pattern, handler] of Object.entries(table)) {
    const [patternMethod, patternPath] = splitPattern(pattern);
    if (patternMethod !== method) continue;
    const params = matchPathSegments(patternPath, pathSegments);
    if (params) return { handler, params };
  }
  return null;
}

function splitPattern(pattern: string): [string, string] {
  const separator = pattern.indexOf(" ");
  return [pattern.slice(0, separator), pattern.slice(separator + 1)];
}

function matchPathSegments(pattern: string, pathSegments: string[]): RouteParams | null {
  const patternSegments = pattern.split("/");
  if (patternSegments.length !== pathSegments.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegments.length; i++) {
    const patternSegment = patternSegments[i];
    const pathSegment = pathSegments[i];
    const param = patternSegment.match(PATH_PARAM_RE);

    if (!param) {
      if (patternSegment !== pathSegment) return null;
      continue;
    }
    if (pathSegment.length === 0) return null;
    params[param[1]] = pathSegment;
  }
  return params;
}
