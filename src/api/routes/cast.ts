import { getVoicePreview } from "../../narration/preview";
import { binary, json } from "../response";
import { type RouteContext, type RouteTable } from "../route";
import { requireUuid } from "../../lib/validators";
import { ownedCastMember } from "../../books/ownership";

export const castRoutes: RouteTable = {
  "GET /api/cast/:castId/preview": voicePreview,
};

async function voicePreview({ user, params }: RouteContext): Promise<Response> {
  const castId = requireUuid(params.castId, "castId");
  const owned = await ownedCastMember(user.id, castId);
  const castMember = owned?.castMember;
  if (!castMember) {
    return json({ error: "Cast member not found" }, 404);
  }

  const audioBuffer = await getVoicePreview(castMember, castId);
  return audioBuffer ? binary(audioBuffer, "audio/wav") : json({ error: "TTS preview failed. Please try again later." }, 500);
}
