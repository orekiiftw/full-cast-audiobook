import type { BookStatus, Chapter, ChapterStatus, PipelineEvent } from "@/api/types";
import type { DetailState } from "@/playback/detailsData";
import { formatSegmentReadyCue } from "@/playback/detailsData";
import { isChapterPlayable } from "@/playback/playbackSelection";

// The add flow used to end at "Adding…". The web client instead narrates the whole pipeline on
// the book's page — acquisition, download, parsing, casting, then a per-chapter voicing bar —
// from the same event stream. This module is that narration as a pure reducer so the add sheet
// and the book detail screen drive one panel from one stream.
//
// Stages only move forward. A `progress_log` may arrive out of order or repeat (the server
// replays the discovery stage to a late subscriber), and a snapshot poll can lag the stream;
// monotonic advancement keeps the ladder honest without jitter.

export type StagingStageId = "acquire" | "download" | "read" | "cast" | "voice";

export interface StagingStageMeta {
  id: StagingStageId;
  label: string;
  // What the stage is doing while it is the active one.
  hint: string;
}

export const STAGING_STAGES: readonly StagingStageMeta[] = [
  { id: "acquire", label: "Finding a copy", hint: "Searching DRM-free sources" },
  { id: "download", label: "Downloading", hint: "Pulling the EPUB down" },
  { id: "read", label: "Reading the EPUB", hint: "Parsing the spine into chapters" },
  { id: "cast", label: "Casting and annotating", hint: "Naming the cast, marking beats" },
  { id: "voice", label: "Voicing", hint: "Synthesising lines, chapter by chapter" },
];

export const STAGING_LOG_LIMIT = 24;

export const STAGING_FAILED_MESSAGE = "The performance stopped before it finished. Retry to pick it up again.";

export type StageState = "pending" | "active" | "done" | "failed";

export interface LogLine {
  id: number;
  text: string;
}

export interface ChapterVoicing {
  chapterId: string;
  chapterIndex: number;
  title: string;
  status: ChapterStatus | null;
  done: number;
  total: number;
}

export interface StagingState {
  // 0..4 names the active stage; STAGING_STAGES.length means every stage finished.
  stageIndex: number;
  bookStatus: BookStatus | null;
  title: string | null;
  log: LogLine[];
  nextLogId: number;
  chapters: ChapterVoicing[];
  error: string | null;
  playableChapterId: string | null;
  readyCount: number;
}

export interface StagingSeed {
  title?: string | null;
  bookStatus?: BookStatus | null;
}

export function createStagingState(seed: StagingSeed = {}): StagingState {
  return {
    stageIndex: stageFloorForStatus(seed.bookStatus ?? null, 0),
    bookStatus: seed.bookStatus ?? null,
    title: seed.title ?? null,
    log: [],
    nextLogId: 1,
    chapters: [],
    error: null,
    playableChapterId: null,
    readyCount: 0,
  };
}

export function stageStateOf(state: StagingState, index: number): StageState {
  if (state.bookStatus === "failed" && index === state.stageIndex) return "failed";
  if (index < state.stageIndex) return "done";
  if (index === state.stageIndex) {
    if (state.bookStatus === "ready" || state.bookStatus === "failed") return "done";
    return "active";
  }
  return "pending";
}

export function currentStage(state: StagingState): StagingStageMeta | null {
  return STAGING_STAGES[state.stageIndex] ?? null;
}

export function stagingHeadline(state: StagingState): string {
  if (state.bookStatus === "failed") return "The studio stopped";
  if (state.bookStatus === "ready") return "Every chapter is voiced";
  return currentStage(state)?.hint ?? "Waiting for the studio";
}

export function isSettled(state: StagingState): boolean {
  return state.bookStatus === "ready" || state.bookStatus === "failed";
}

export interface VoicingSummary {
  // "Ch. 03 · 24/86 lines"
  label: string;
  chapterIndex: number;
  done: number;
  total: number;
  ratio: number;
  // Whole-book ratio, for the header readout.
  overallDone: number;
  overallTotal: number;
  overallRatio: number;
}

export function chapterRatio(chapter: Pick<ChapterVoicing, "done" | "total">): number {
  return chapter.total > 0 ? Math.min(1, chapter.done / chapter.total) : 0;
}

export function voicingSummary(state: StagingState): VoicingSummary | null {
  if (state.chapters.length === 0) return null;

  // Voicing runs in chapter order, so the live chapter is the highest one still working — not
  // the first partially voiced chapter, which stays partial for the rest of the book.
  const byIndexDesc = [...state.chapters].sort((left, right) => right.chapterIndex - left.chapterIndex);
  const target =
    byIndexDesc.find((chapter) => chapter.status === "processing") ??
    byIndexDesc.find((chapter) => chapter.status === "partial_ready") ??
    byIndexDesc.find((chapter) => chapter.done > 0 && chapter.status !== "ready") ??
    state.chapters[0];

  let overallDone = 0;
  let overallTotal = 0;
  for (const chapter of state.chapters) {
    overallDone += chapter.done;
    overallTotal += chapter.total;
  }

  return {
    label: `Ch. ${String(target.chapterIndex).padStart(2, "0")} · ${target.done}/${target.total || "?"} lines`,
    chapterIndex: target.chapterIndex,
    done: target.done,
    total: target.total,
    ratio: chapterRatio(target),
    overallDone,
    overallTotal,
    overallRatio: overallTotal > 0 ? Math.min(1, overallDone / overallTotal) : 0,
  };
}

export interface StagingSnapshot {
  title: string;
  bookStatus: BookStatus;
  chapters: Chapter[];
  segmentProgress?: Record<string, { total: number; done: number }>;
}

// A poll of `GET /api/books/:id` is the ground truth between events: it fills in chapter titles,
// counters and a status the stream may have moved past while the client was disconnected.
export function mergeStagingSnapshot(state: StagingState, snapshot: StagingSnapshot): StagingState {
  const chapters: ChapterVoicing[] = snapshot.chapters.map((chapter) => {
    const entry = snapshot.segmentProgress?.[chapter.id];
    return {
      chapterId: chapter.id,
      chapterIndex: chapter.chapterIndex,
      title: chapter.title,
      status: chapter.status,
      done: entry ? entry.done : chapter.voicedCount,
      total: entry ? entry.total : chapter.totalCount,
    };
  });

  const voicedLines = chapters.reduce((sum, chapter) => sum + chapter.done, 0);
  // The payload's status is a floor; the newest line can already be further along than it says
  // (a poll lags the stream), so its stage is folded in too.
  const latestStage = state.log[0] ? classifyProgressText(state.log[0].text) : null;
  const floor = Math.max(stageFloorForStatus(snapshot.bookStatus, voicedLines), latestStage === null ? 0 : stageIndexOf(latestStage));
  const playable = snapshot.chapters.find((chapter) =>
    isChapterPlayable(chapter, chapters.find((candidate) => candidate.chapterId === chapter.id)?.done),
  );

  return {
    ...state,
    stageIndex: Math.max(state.stageIndex, floor),
    bookStatus: snapshot.bookStatus,
    title: snapshot.title || state.title,
    chapters,
    readyCount: snapshot.chapters.filter((chapter) => chapter.status === "ready").length,
    playableChapterId: playable?.id ?? state.playableChapterId,
    error: snapshot.bookStatus === "failed" ? (state.error ?? STAGING_FAILED_MESSAGE) : null,
  };
}

// The detail screen already reduces the stream into `DetailState`; the panel reads the same shape.
export function stagingFromDetail(detail: DetailState): StagingState {
  const base: StagingState = { ...createStagingState(), log: detail.log, nextLogId: detail.nextLogId };
  if (!detail.data) return base;

  return mergeStagingSnapshot(base, {
    title: detail.data.book.title,
    bookStatus: detail.data.book.status,
    chapters: detail.data.chapters,
    segmentProgress: detail.segmentProgress,
  });
}

export function reduceStagingEvent(state: StagingState, event: PipelineEvent): StagingState {
  switch (event.type) {
    case "progress_log": {
      if (state.log[0]?.text === event.message) return state;
      const stage = classifyProgressText(event.message);
      return withLog(stage === null ? state : advanceTo(state, stageIndexOf(stage)), event.message);
    }

    case "status_change": {
      const text = event.message ?? `Studio status: ${event.status}`;
      if (event.status === "failed") {
        return {
          ...withLog(state, text),
          bookStatus: "failed",
          error: event.error ?? event.message ?? STAGING_FAILED_MESSAGE,
        };
      }

      const advanced = advanceTo({ ...state, bookStatus: event.status }, stageFloorForStatus(event.status, voicedLines(state)));
      const withMessage = classifyStatusMessage(event.status, event.message);
      const staged = withMessage === null ? advanced : advanceTo(advanced, stageIndexOf(withMessage));
      return state.log[0]?.text === text ? staged : withLog(staged, text);
    }

    case "chapter_status": {
      const chapters = state.chapters.some((chapter) => chapter.chapterId === event.chapterId)
        ? state.chapters.map((chapter) =>
            chapter.chapterId === event.chapterId
              ? { ...chapter, status: event.status, chapterIndex: event.chapterIndex ?? chapter.chapterIndex }
              : chapter,
          )
        : [
            ...state.chapters,
            {
              chapterId: event.chapterId,
              chapterIndex: event.chapterIndex ?? state.chapters.length + 1,
              title: "",
              status: event.status,
              done: 0,
              total: 0,
            },
          ].sort((left, right) => left.chapterIndex - right.chapterIndex);

      const next: StagingState = {
        ...state,
        chapters,
        readyCount: chapters.filter((chapter) => chapter.status === "ready").length,
        playableChapterId:
          event.status === "partial_ready" || event.status === "ready"
            ? (state.playableChapterId ?? event.chapterId)
            : state.playableChapterId,
      };

      if (event.status === "processing" || event.status === "partial_ready") {
        const advanced = advanceTo(next, stageIndexOf("voice"));
        return event.message ? withLog(advanced, event.message) : advanced;
      }
      if (event.status === "failed" && event.error) {
        return withLog(next, `Chapter ${event.chapterIndex ?? ""} failed: ${event.error}`.trim());
      }
      return event.message ? withLog(next, event.message) : next;
    }

    case "segment_ready": {
      // A stream that joins mid-chapter can deliver a line before the chapter row is known:
      // create it rather than dropping the counter on the floor.
      const known = state.chapters.some((chapter) => chapter.chapterId === event.chapterId);
      const done = event.total > 0 ? Math.min(event.total, event.done) : event.done;
      const chapters = known
        ? state.chapters.map((chapter) =>
            chapter.chapterId === event.chapterId
              ? {
                  ...chapter,
                  chapterIndex: event.chapterIndex || chapter.chapterIndex,
                  status:
                    chapter.status === "ready" || chapter.status === "partial_ready" ? chapter.status : ("partial_ready" as ChapterStatus),
                  done,
                  total: event.total > 0 ? event.total : chapter.total,
                }
              : chapter,
          )
        : [
            ...state.chapters,
            {
              chapterId: event.chapterId,
              chapterIndex: event.chapterIndex || state.chapters.length + 1,
              title: "",
              status: "partial_ready" as ChapterStatus,
              done,
              total: event.total,
            },
          ].sort((left, right) => left.chapterIndex - right.chapterIndex);

      const advanced = advanceTo(
        { ...state, chapters, playableChapterId: done > 0 ? (state.playableChapterId ?? event.chapterId) : state.playableChapterId },
        stageIndexOf("voice"),
      );
      return withLog(advanced, formatSegmentReadyCue(event));
    }

    case "segment_failed":
      return withLog(state, `Segment failed: ${event.error}`);

    case "quota_exceeded":
      return withLog(state, event.message ?? "TTS quota exhausted — voicing is paused.");

    default:
      return state;
  }
}

function advanceTo(state: StagingState, index: number): StagingState {
  return index > state.stageIndex ? { ...state, stageIndex: index } : state;
}

function withLog(state: StagingState, text: string): StagingState {
  return {
    ...state,
    log: [{ id: state.nextLogId, text }, ...state.log.slice(0, STAGING_LOG_LIMIT - 1)],
    nextLogId: state.nextLogId + 1,
  };
}

function voicedLines(state: StagingState): number {
  return state.chapters.reduce((sum, chapter) => sum + chapter.done, 0);
}

function stageIndexOf(id: StagingStageId): number {
  return STAGING_STAGES.findIndex((stage) => stage.id === id);
}

export function stageFloorForStatus(status: BookStatus | null, voiced: number): number {
  switch (status) {
    case "discovering":
      return stageIndexOf("acquire");
    case "casting":
      return stageIndexOf("cast");
    case "in_progress":
      return voiced > 0 ? stageIndexOf("voice") : stageIndexOf("cast");
    case "ready":
      return STAGING_STAGES.length;
    default:
      return 0;
  }
}

// Acquisition writes its stages into the log text, and those lines are the only signal for
// "downloading" versus "looking": `status_change` stays `discovering` through both.
const PROGRESS_TEXT_STAGES: readonly { stage: StagingStageId; pattern: RegExp }[] = [
  { stage: "voice", pattern: /synthesi[sz]|voic|schedul\w* audio/i },
  { stage: "cast", pattern: /cast|annotat|beats?\b|narrator/i },
  { stage: "read", pattern: /pars(e|ing)|spine|structur|chapter/i },
  { stage: "download", pattern: /download|fetch|transfer|seed|\d(\.\d+)?\s?MB|\bMB\b/i },
  { stage: "acquire", pattern: /search|checking|catalogue|indexer|torrent|provider|acquiring|discover/i },
];

export function classifyProgressText(message: string): StagingStageId | null {
  for (const { stage, pattern } of PROGRESS_TEXT_STAGES) {
    if (pattern.test(message)) return stage;
  }
  return null;
}

function classifyStatusMessage(status: BookStatus, message: string | undefined): StagingStageId | null {
  if (!message) return null;
  if (status === "discovering") return classifyProgressText(message);
  if (status === "in_progress" && /pars|spine|structur/i.test(message)) return "read";
  return null;
}
