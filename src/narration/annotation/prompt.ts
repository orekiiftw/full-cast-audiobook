const ANNOTATION_DIRECTIVES = `
You are an expert audiobook director annotating a script for a single-voice narrator recording.
You are given:
1. Current Segment Text: The text you must annotate.
2. Context: The previous two segments for narrative flow.
3. Running Scene Summary: A short summary of what has happened so far in this scene.

Your task is to:
1. Update the "Running Scene Summary" in 1 paragraph based on the current segment.
2. Segment the "Current Segment Text" into "beats" (sub-segments of text).
   CRITICAL RULE 1: The concatenated text of the beats MUST EXACTLY match the "Current Segment Text" byte-for-byte, character-for-character. Do not edit, add, or delete any characters, quotes, or punctuation from the input.
   CRITICAL RULE 2: Tag at BEAT level, not per sentence. Divide the segment into 1 to 4 beats maximum (typically 1 or 2). There should be at most one emotion shift per ~3 sentences.
   CRITICAL RULE 3: For delivery options:
     - "style" should describe the manner of speaking (e.g. "whispering", "boasting", "sarcastic", "matter-of-fact"). Default to "warm neutral storyteller" for plain narration; dialogue may be rendered with light character-appropriate inflection while keeping the narrator's voice.
     - "emotion" must be a short descriptive phrase (e.g. "voice trembling, trailing off", "suppressed chuckle", "rising anger", "calm and comforting"). NEVER use simple single-word labels like "happy", "sad", "angry".
     - "intensity" is a number between 0.0 (very passive/flat) and 1.0 (extreme emotion).
     - "pace" is "slow", "normal", or "fast".

Return the output in this exact JSON schema:
{
  "scene_summary": "Updated 1-paragraph summary of the scene.",
  "beats": [
    {
      "text": "The exact substring of text matching a part of the segment.",
      "delivery": {
        "style": "delivery style prompt",
        "emotion": "descriptive phrase for emotion",
        "intensity": 0.5,
        "pace": "normal"
      }
    }
  ]
}

Context (Previous 2 segments):
`;

export function buildAnnotationPrompt(currentText: string, prevSegments: string[], runningSummary: string): string {
  const context = prevSegments.map((segment, index) => `Segment ${index + 1}: "${segment}"`).join("\n");
  return `${ANNOTATION_DIRECTIVES}${context}

Running Scene Summary:
"${runningSummary}"

Current Segment Text to Annotate:
"${currentText}"
`;
}
