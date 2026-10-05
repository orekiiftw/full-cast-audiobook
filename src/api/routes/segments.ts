import { json } from "../response";
import { type RouteContext, type RouteTable } from "../route";
import { ValidationError, optionalString, requireUuid } from "../../lib/validators";
import { readJsonWithLimit } from "../body";
import { ownedSegment } from "../../books/ownership";
import { regenerateSegment, type RegenerationTarget } from "../../orchestrator/regeneration";

const MAX_INSTRUCTION_LENGTH = 500;

export const segmentRoutes: RouteTable = {
  "POST /api/segments/:segmentId/regenerate": handleSegmentRegeneration,
};

async function handleSegmentRegeneration({ req, user, params }: RouteContext): Promise<Response> {
  const segmentId = requireUuid(params.segmentId, "segmentId");
  const body = (await readJsonWithLimit(req)) as Record<string, unknown>;
  const instruction = readInstruction(body);

  const target = await resolveRegenerationTarget(user.id, segmentId);
  if (!target) {
    return json({ error: "Segment not found" }, 404);
  }

  const result = await regenerateSegment(target, instruction);
  return result.ok ? json({ success: true, audioUrl: result.audioUrl }) : json({ error: result.error }, 409);
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
