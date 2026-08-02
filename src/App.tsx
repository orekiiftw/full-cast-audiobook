import { useState, useEffect, useRef, useCallback } from "react";
import Library from "./components/Library";
import BookDetail from "./components/BookDetail";
import Player from "./components/Player";
import AuthScreen from "./components/AuthScreen";
import { Button } from "./components/ui/Button";
import { BrandLogo } from "./components/ui/BrandLogo";
import { Icon } from "./components/ui/Icon";
import { useToast } from "./components/ui/Toast";
import { useSleepTimer } from "./hooks/useSleepTimer";
import { AUTH_EXPIRED_EVENT, apiFetch, authUserFromResponse } from "./lib/api";
import { PLAYBACK } from "./lib/constants";
import { clearSessionHint, hasSessionHint, markSessionHint } from "./lib/sessionHint";
import { resetSharedAudio, unlockSharedAudio } from "./lib/sharedAudio";
import type { AuthResponse, AuthUser, Book, Chapter, Segment } from "./types/api";

type AuthStatus = "loading" | "authenticated" | "anonymous";

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  /**
   * Library prefetch fired in parallel with the session check (only when the
   * user was signed in before). Turns the cold-boot waterfall
   * auth/me → mount → /api/books into max(auth/me, /api/books).
   * Cleared on login/logout so a different account never sees stale books.
   */
  const bootBooksRef = useRef<Promise<Response> | null>(null);

  const clearSession = useCallback((expired: boolean) => {
    resetSharedAudio();
    clearSessionHint();
    bootBooksRef.current = null;
    setUser(null);
    setSessionExpired(expired);
    setAuthStatus("anonymous");
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (hasSessionHint()) {
      bootBooksRef.current = apiFetch(
        "/api/books",
        { method: "GET" },
        { notifyOnUnauthorized: false }
      );
    }

    const loadSession = async () => {
      try {
        const response = await apiFetch(
          "/api/auth/me",
          { method: "GET" },
          { notifyOnUnauthorized: false }
        );
        if (!response.ok) {
          if (!cancelled) clearSession(false);
          return;
        }
        const payload = (await response.json()) as AuthResponse | AuthUser;
        const authenticatedUser = authUserFromResponse(payload);
        if (!cancelled && authenticatedUser) {
          // Restore marking too: keeps optimistic boot working when the hint
          // was lost (storage eviction) but the cookie is still valid.
          markSessionHint();
          setUser(authenticatedUser);
          setAuthStatus("authenticated");
        } else if (!cancelled) {
          clearSession(false);
        }
      } catch (error) {
        console.error("Unable to restore auth session:", error);
        if (!cancelled) clearSession(false);
      }
    };

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  useEffect(() => {
    const handleAuthExpired = () => clearSession(true);
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, [clearSession]);

  const handleAuthenticated = (authenticatedUser: AuthUser) => {
    markSessionHint();
    // A fresh login must never inherit a prior account's prefetched library.
    bootBooksRef.current = null;
    setUser(authenticatedUser);
    setSessionExpired(false);
    setAuthStatus("authenticated");
  };

  const handleLogout = async () => {
    try {
      await apiFetch(
        "/api/auth/logout",
        { method: "POST" },
        { notifyOnUnauthorized: false }
      );
    } catch (error) {
      console.error("Logout request failed:", error);
    } finally {
      clearSession(false);
    }
  };

  if (authStatus === "loading") {
    // Returning user: show the app shell (header + skeletons) immediately
    // instead of a blocking gate — the session check races in the background.
    // First-ever visit keeps the quiet branded gate (no shell flash before login).
    return hasSessionHint() ? <BootShell /> : <AuthLoadingGate />;
  }
  if (authStatus !== "authenticated" || !user) {
    return <AuthScreen onAuthenticated={handleAuthenticated} sessionExpired={sessionExpired} />;
  }

  return (
    <AuthenticatedApp
      key={user.id ?? user.email}
      user={user}
      onLogout={handleLogout}
      bootBooks={bootBooksRef.current}
    />
  );
}

/**
 * Instant first paint for returning users while /api/auth/me is in flight.
 * Mirrors the authenticated chrome + library skeletons so the swap to real
 * content is seamless instead of a gate → app flash.
 */
function BootShell() {
  return (
    <div className="min-h-screen text-cinema-100 flex flex-col font-sans grainy" aria-busy="true" aria-label="Restoring your Narratea session">
      <header className="app-header sticky top-0 z-40 border-b border-white/[0.04]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 h-16 flex justify-between items-center gap-4">
          <BrandLogo />
        </div>
      </header>
      <main className="flex-1 relative z-10 pb-16">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 py-12 sm:py-16">
          <div className="mb-14 space-y-4">
            <div className="h-3 w-24 rounded-md bg-white/[0.05]" />
            <div className="h-10 w-48 rounded-md bg-white/[0.06]" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-10">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-3">
                <div className="aspect-[2/3] rounded-2xl bg-cinema-900 shimmer" />
                <div className="h-4 w-3/4 rounded-md bg-white/[0.05]" />
                <div className="h-3 w-1/2 rounded-md bg-white/[0.04]" />
              </div>
            ))}
          </div>
        </div>
      </main>
      <span className="sr-only">Loading</span>
    </div>
  );
}

function AuthLoadingGate() {
  return (
    <main className="auth-shell grainy flex min-h-screen items-center justify-center px-5 text-cinema-100" aria-busy="true" aria-label="Restoring your Narratea session">
      <div className="relative z-10 flex flex-col items-center animate-fade-in">
        <span className="flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-gradient-to-br from-gold-300 via-gold-500 to-gold-700 shadow-glow">
          <Icon name="sparkle" size={21} className="text-cinema-950" />
        </span>
        <span className="mt-5 font-display text-sm font-semibold uppercase tracking-[0.24em] text-gradient">Narratea</span>
        <span className="mt-6 h-4 w-4 animate-spin rounded-full border-2 border-gold-400/25 border-t-gold-400" aria-hidden="true" />
        <span className="sr-only">Loading</span>
      </div>
    </main>
  );
}

interface AuthenticatedAppProps {
  user: AuthUser;
  onLogout: () => Promise<void>;
  /** In-flight library prefetch started at boot (parallel to auth/me), if any. */
  bootBooks?: Promise<Response> | null;
}

function AuthenticatedApp({ user, onLogout, bootBooks }: AuthenticatedAppProps) {
  const { showToast } = useToast();
  const [currentView, setCurrentView] = useState<"library" | "detail">("library");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [activeChapter, setActiveChapter] = useState<Chapter | null>(null);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0);
  const [activeSegmentsList, setActiveSegmentsList] = useState<Segment[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [resumePositionMs, setResumePositionMs] = useState(0);
  const [playSession, setPlaySession] = useState(0);

  // Sleep timer lives here, not in Player: Player is remounted (via key) on
  // every chapter change, which used to reset the timer mid-book — exactly the
  // all-night-playback scenario it exists for.
  const { sleepPreset, setSleepPreset, sleepTimeLeft, setSleepTimeLeft } = useSleepTimer(setIsPlaying, isPlaying);

  const positionRef = useRef(0);
  /**
   * Which book/chapter `positionRef` currently describes. Updated
   * synchronously in handlePlayChapter — together with positionRef — so the
   * pair is always a consistent tuple. (The old effect-closure version synced
   * the NEW chapter's 0-position into the OLD chapter's row on every switch.)
   */
  const playbackSessionRef = useRef<{ bookId: string; chapterId: string } | null>(null);
  /** Monotonic counter so concurrent chapter taps settle in LAST-CLICKED order,
   *  not last-resolved: a slow fetch for an older tap must not overwrite the
   *  chapter the user most recently asked for. */
  const playRequestRef = useRef(0);
  /** 1-based DB segmentIndex of the line currently playing — the server
   *  re-centers its just-in-time voicing window on it with every sync. */
  const segmentIndexRef = useRef(1);
  useEffect(() => {
    const seg = activeSegmentsList[activeSegmentIndex];
    if (seg) segmentIndexRef.current = seg.segmentIndex;
  }, [activeSegmentIndex, activeSegmentsList]);

  const activeBookId = activeBook?.id ?? null;
  const activeChapterId = activeChapter?.id ?? null;
  const activeBookRef = useRef(activeBook);
  const activeChapterRef = useRef(activeChapter);
  useEffect(() => {
    activeBookRef.current = activeBook;
  }, [activeBook]);
  useEffect(() => {
    activeChapterRef.current = activeChapter;
  }, [activeChapter]);

  const syncPosition = useCallback(() => {
    const session = playbackSessionRef.current;
    if (!session) return;
    apiFetch("/api/playback", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId: session.bookId,
        chapterId: session.chapterId,
        positionMs: positionRef.current,
        segmentIndex: segmentIndexRef.current,
      }),
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!activeBookId || !activeChapterId) return;

    const interval = setInterval(syncPosition, PLAYBACK.POSITION_SYNC_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      syncPosition();
    };
  }, [activeBookId, activeChapterId, syncPosition]);

  const handlePlayChapter = useCallback(
    async (book: Book, chapter: Chapter, resumeMs = 0) => {
      const requestId = ++playRequestRef.current;
      const unlocked = unlockSharedAudio();

      try {
        const [response] = await Promise.all([
          apiFetch(`/api/chapters/${chapter.id}/segments`),
          unlocked,
        ]);
        if (requestId !== playRequestRef.current) return; // superseded by a newer chapter tap
        if (!response.ok) throw new Error("Failed to load chapter segments");
        const data = (await response.json()) as { segments?: Segment[] };
        const segments = data.segments ?? [];

        if (segments.length === 0) {
          showToast("This chapter has no lines yet. Try again shortly.", "error");
          return;
        }

        let startIndex = 0;
        if (resumeMs > 0) {
          let accumulated = 0;
          for (let index = 0; index < segments.length; index++) {
            const duration = segments[index].durationMs ?? 0;
            if (duration <= 0) {
              if (index === segments.length - 1) {
                startIndex = index;
                break;
              }
              continue;
            }
            if (accumulated + duration > resumeMs) {
              startIndex = index;
              break;
            }
            accumulated += duration;
            if (index === segments.length - 1) startIndex = index;
          }
          if (segments[startIndex]?.status !== "voiced" || !segments[startIndex]?.audioUrl) {
            const voicedNear = segments.findIndex(
              (segment, index) => index >= startIndex && segment.status === "voiced" && segment.audioUrl
            );
            if (voicedNear >= 0) startIndex = voicedNear;
            else {
              const firstVoiced = segments.findIndex(
                (segment) => segment.status === "voiced" && segment.audioUrl
              );
              if (firstVoiced >= 0) startIndex = firstVoiced;
            }
          }
        } else {
          const firstVoiced = segments.findIndex(
            (segment) => segment.status === "voiced" && segment.audioUrl
          );
          if (firstVoiced >= 0) startIndex = firstVoiced;
        }

        if (requestId !== playRequestRef.current) return; // re-check before swapping state
        // Flush the outgoing chapter's progress BEFORE swapping refs: the
        // session/position pair must never describe different chapters.
        syncPosition();
        playbackSessionRef.current = { bookId: book.id, chapterId: chapter.id };
        positionRef.current = resumeMs;

        setActiveBook(book);
        setActiveChapter(chapter);
        setActiveSegmentsList(segments);
        setActiveSegmentIndex(startIndex);
        setResumePositionMs(resumeMs);
        setIsPlaying(true);
        setPlaySession((current) => current + 1);
      } catch (error) {
        if (requestId !== playRequestRef.current) return; // a stale request must not toast
        console.error(error);
        showToast("This chapter is still processing. Try again shortly.", "error");
      }
    },
    [showToast, syncPosition]
  );

  const handleChapterEnded = useCallback(async () => {
    const book = activeBookRef.current;
    const chapter = activeChapterRef.current;
    if (!book || !chapter) return;

    try {
      const response = await apiFetch(`/api/books/${book.id}`);
      if (!response.ok) return;
      const data = (await response.json()) as { chapters?: Chapter[] };
      const chapters = data.chapters ?? [];
      // The counter columns are exact (pipeline keeps them atomic), so a
      // voicedCount>0 check replaces the old extra /segments fetch we used
      // to run just to ask "does chapter N+1 have audio yet?".
      const next = chapters.find(
        (candidate) =>
          candidate.chapterIndex > chapter.chapterIndex &&
          candidate.voicedCount > 0 &&
          (candidate.status === "ready" ||
            candidate.status === "partial_ready" ||
            candidate.status === "processing")
      );
      if (!next) return;

      showToast(`Continuing · ${next.title}`);
      await handlePlayChapter(book, next, 0);
    } catch (error) {
      console.error("Auto-advance chapter failed:", error);
    }
  }, [handlePlayChapter, showToast]);

  const handleSelectBook = (bookId: string) => {
    setSelectedBookId(bookId);
    setCurrentView("detail");
  };

  const handleBackToLibrary = () => {
    setCurrentView("library");
    setSelectedBookId(null);
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setIsPlaying(false);
    resetSharedAudio();
    await onLogout();
  };

  const playerOpen = !!(activeBook && activeChapter);

  return (
    <div className="min-h-screen text-cinema-100 flex flex-col font-sans grainy">
      <header className="app-header sticky top-0 z-40 border-b border-white/[0.04]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 h-16 flex justify-between items-center gap-4">
          <button className="flex items-center gap-3 group shrink-0" onClick={handleBackToLibrary} aria-label="Go to library">
            <BrandLogo />
          </button>

          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <div className="hidden md:flex items-center gap-2 text-[10px] text-cinema-400 font-medium tracking-[0.18em] uppercase">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              Live Studio
            </div>
            <span className="hidden h-4 w-px bg-white/[0.07] md:block" />
            <span className="max-w-[9rem] truncate text-xs text-cinema-300 sm:max-w-[14rem]" title={user.email}>
              {user.email}
            </span>
            <Button type="button" variant="ghost" size="sm" isLoading={loggingOut} onClick={handleLogout} aria-label={`Sign out ${user.email}`}>
              <span className="hidden sm:inline">Sign out</span>
              <span className="sm:hidden">Out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className={`flex-1 relative z-10 ${playerOpen ? "pb-[calc(9rem+env(safe-area-inset-bottom))]" : "pb-16"}`}>
        {currentView === "library" ? (
          <Library onSelectBook={handleSelectBook} bootBooks={bootBooks} />
        ) : selectedBookId ? (
          <BookDetail
            bookId={selectedBookId}
            onBack={handleBackToLibrary}
            onPlayChapter={handlePlayChapter}
            activeChapterId={activeChapter?.id}
          />
        ) : null}
      </main>

      {playerOpen && (
        <Player
          key={`${activeChapter.id}:${playSession}`}
          book={activeBook}
          chapter={activeChapter}
          isPlaying={isPlaying}
          setIsPlaying={setIsPlaying}
          sleepPreset={sleepPreset}
          setSleepPreset={setSleepPreset}
          sleepTimeLeft={sleepTimeLeft}
          setSleepTimeLeft={setSleepTimeLeft}
          playbackSpeed={playbackSpeed}
          setPlaybackSpeed={setPlaybackSpeed}
          positionRef={positionRef}
          segmentsList={activeSegmentsList}
          setSegmentsList={setActiveSegmentsList}
          currentSegmentIndex={activeSegmentIndex}
          setCurrentSegmentIndex={setActiveSegmentIndex}
          initialPositionMs={resumePositionMs}
          onChapterEnded={handleChapterEnded}
        />
      )}
    </div>
  );
}
