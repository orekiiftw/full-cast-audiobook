import { json } from "./response";
import { ValidationError } from "../lib/validators";
import { AcquisitionError } from "../acquisition";

export function errorResponse(error: unknown, req: Request, path: string): Response {
  if (error instanceof ValidationError) {
    return json({ error: error.message }, 400);
  }
  if (error instanceof SyntaxError || error instanceof URIError) {
    return json({ error: "Invalid request" }, 400);
  }
  if (error instanceof AcquisitionError) {
    return json({ error: error.message }, error.retryable ? 502 : 400);
  }
  console.error(`API error on ${req.method} ${path}:`, error);
  return json({ error: "Internal server error" }, 500);
}
