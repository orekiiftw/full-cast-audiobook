import { json } from "../response";
import { type RouteContext, type RouteTable } from "../route";
import { ValidationError, optionalString, requireUuid } from "../../lib/validators";
import { readJsonWithLimit } from "../body";
import { acquireLock, releaseLock } from "../../queue";
import { ownedSegment } from "../ownership";
import { runRegeneration, type RegenerationTarget } from "./segmentRegeneration";

const MAX_INSTRUCTION_LENGTH = 500;
const REGEN_LOCK_TTL_MS = 5 * 60_000;

export const segmentRoutes: RouteTable = {
  "POST /api/segments/:segmentId/regenerate": regenerateSegment,
};

async function regenerateSegment({ req, user, params }: RouteContext): Promise<Response> {
  const segmentId = requireUuid(params.segmentId, "segmentId");
  const body = (await readJsonWithLimit(req)) as Record<string, unknown>;
  const instruction = readInstruction(body);

  const target = await resolveRegenerationTarget(user.id, segmentId);
  if (!target) {
    return json({ error: "Segment not found" }, 404);
  }

  return withRegenerationLock(segmentId, () => runRegeneration(target, instruction));
}

async function withRegenerationLock(segmentId: string, run: () => Promise<Response>): Promise<Response> {
  const lockToken = await acquireLock(`regen:${segmentId}`, REGEN_LOCK_TTL_MS);
  if (!lockToken) {
    return json({ error: "This segment is already being regenerated. Please wait for it to finish." }, 409);
  }

  try {
    return await run();
  } finally {
    await releaseLock(`regen:${segmentId}`, lockToken);
  }
}

async function resolveRegenerationTarget(userId: string, segmentId: string): Promise<RegenerationTarget | null> {
  const owned = await ownedSegment(userId, segmentId);
  if (!owned?.segment || !owned.chapter) return null;
  return {
    segmentId,
    segment: owned.segment,
    chapter: owned.chapter,
    bookId: owned.chapter.bookId,
  };
}

function readInstruction(body: Record<string, unknown>): string | undefined {
  const instruction = optionalString(body, "instruction");
  if (instruction && instruction.length > MAX_INSTRUCTION_LENGTH) {
    throw new ValidationError(`instruction must be ${MAX_INSTRUCTION_LENGTH} characters or fewer`);
  }
  return instruction;
}
