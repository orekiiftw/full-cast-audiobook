import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Segment } from "../../types/api";
import { sumDurationsBefore } from "./playbackMath";

interface UsePlaybackPositionOptions {
  initialPositionMs: number;
  segmentsList: Segment[];
  currentSegmentIndex: number;
  positionRef: MutableRefObject<number>;
}

export function usePlaybackPosition({ initialPositionMs, segmentsList, currentSegmentIndex, positionRef }: UsePlaybackPositionOptions) {
  const [positionMs, setPositionMsState] = useState(initialPositionMs);
  const precedingMsRef = useRef(0);

  useEffect(() => {
    precedingMsRef.current = sumDurationsBefore(segmentsList, currentSegmentIndex);
  }, [segmentsList, currentSegmentIndex]);

  const setPositionMs = useCallback(
    (position: number) => {
      positionRef.current = position;
      setPositionMsState((previous) =>
        position === 0 || Math.floor(position / 1000) !== Math.floor(previous / 1000) ? position : previous,
      );
    },
    [positionRef],
  );

  const handleSegmentProgress = useCallback(
    (segmentMs: number) => {
      setPositionMs(precedingMsRef.current + segmentMs);
    },
    [setPositionMs],
  );

  return { positionMs, setPositionMs, handleSegmentProgress };
}
