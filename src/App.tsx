import { useState } from "react";
import { Library } from "./components/Library";
import { BookDetail } from "./components/BookDetail";
import { Player } from "./components/Player";
import { AuthScreen } from "./components/AuthScreen";
import { BrandLogo, Button, useToast } from "./components/ui";
import { AuthLoadingGate } from "./components/auth/AuthLoadingGate";
import { BootShell } from "./components/auth/BootShell";
import { useAuthSession } from "./hooks/useAuthSession";
import { usePlaybackSession, type PlaybackSession } from "./hooks/usePlaybackSession";
import { useSleepTimer, type SleepTimer } from "./hooks/useSleepTimer";
import { hasSessionHint } from "./lib/sessionHint";
import { resetSharedAudio } from "./lib/sharedAudio";
import type { AuthUser, Book, Chapter } from "./types/api";

export function App() {
  const { authStatus, user, sessionExpired, bootBooks, handleAuthenticated, handleLogout } = useAuthSession();

  if (authStatus === "loading") {
    return hasSessionHint() ? <BootShell /> : <AuthLoadingGate />;
  }
  if (authStatus !== "authenticated" || !user) {
    return <AuthScreen onAuthenticated={handleAuthenticated} sessionExpired={sessionExpired} />;
  }

  return <AuthenticatedApp key={user.id ?? user.email} user={user} onLogout={handleLogout} bootBooks={bootBooks} />;
}

interface AuthenticatedAppProps {
  user: AuthUser;
  onLogout: () => Promise<void>;
  bootBooks?: Promise<Book[] | null> | null;
}

function AuthenticatedApp({ user, onLogout, bootBooks }: AuthenticatedAppProps) {
  const { showToast } = useToast();
  const playback = usePlaybackSession(showToast);
  const sleepTimer = useSleepTimer(playback.setIsPlaying, playback.isPlaying);
  const route = useLibraryRoute();
  const { signingOut, signOut } = useSignOut(onLogout, playback.setIsPlaying);
  const { activeBook, activeChapter } = playback;
  const playerOpen = !!(activeBook && activeChapter);

  return (
    <div className="min-h-screen text-cinema-100 flex flex-col font-sans grainy">
      <AppHeader email={user.email} signingOut={signingOut} onSignOut={signOut} onHome={route.returnToLibrary} />

      <main className={`flex-1 relative z-10 ${playerOpen ? "pb-[calc(9rem+env(safe-area-inset-bottom))]" : "pb-16"}`}>
        {route.view === "library" ? (
          <Library onSelectBook={route.openBook} bootBooks={bootBooks} />
        ) : route.selectedBookId ? (
          <BookDetail
            bookId={route.selectedBookId}
            onBack={route.returnToLibrary}
            onPlayChapter={playback.playChapter}
            activeChapterId={activeChapter?.id}
          />
        ) : null}
      </main>

      {playerOpen && <PlaybackPlayer book={activeBook} chapter={activeChapter} playback={playback} sleepTimer={sleepTimer} />}
    </div>
  );
}

interface PlaybackPlayerProps {
  book: Book;
  chapter: Chapter;
  playback: PlaybackSession;
  sleepTimer: SleepTimer;
}

function PlaybackPlayer({ book, chapter, playback, sleepTimer }: PlaybackPlayerProps) {
  return (
    <Player
      key={`${book.id}:${playback.playSession}`}
      book={book}
      chapter={chapter}
      isPlaying={playback.isPlaying}
      setIsPlaying={playback.setIsPlaying}
      sleepPreset={sleepTimer.sleepPreset}
      setSleepPreset={sleepTimer.setSleepPreset}
      sleepTimeLeft={sleepTimer.sleepTimeLeft}
      setSleepTimeLeft={sleepTimer.setSleepTimeLeft}
      playbackSpeed={playback.playbackSpeed}
      setPlaybackSpeed={playback.setPlaybackSpeed}
      positionRef={playback.positionRef}
      segmentsList={playback.segments}
      setSegmentsList={playback.setSegments}
      currentSegmentIndex={playback.currentSegmentIndex}
      setCurrentSegmentIndex={playback.setCurrentSegmentIndex}
      initialPositionMs={playback.resumePositionMs}
      onChapterEnded={playback.handleChapterEnded}
    />
  );
}

interface AppHeaderProps {
  email: string;
  signingOut: boolean;
  onSignOut: () => void;
  onHome: () => void;
}

function AppHeader({ email, signingOut, onSignOut, onHome }: AppHeaderProps) {
  return (
    <header className="app-header sticky top-0 z-40 border-b border-white/[0.04]">
      <div className="max-w-6xl mx-auto px-5 sm:px-6 h-16 flex justify-between items-center gap-4">
        <button className="flex items-center gap-3 group shrink-0" onClick={onHome} aria-label="Go to library">
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
          <span className="max-w-[9rem] truncate text-xs text-cinema-300 sm:max-w-[14rem]" title={email}>
            {email}
          </span>
          <Button type="button" variant="ghost" size="sm" isLoading={signingOut} onClick={onSignOut} aria-label={`Sign out ${email}`}>
            <span className="hidden sm:inline">Sign out</span>
            <span className="sm:hidden">Out</span>
          </Button>
        </div>
      </div>
    </header>
  );
}

function useLibraryRoute() {
  const [view, setView] = useState<"library" | "detail">("library");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);

  const openBook = (bookId: string) => {
    setSelectedBookId(bookId);
    setView("detail");
  };

  const returnToLibrary = () => {
    setView("library");
    setSelectedBookId(null);
  };

  return { view, selectedBookId, openBook, returnToLibrary };
}

function useSignOut(onLogout: () => Promise<void>, setIsPlaying: (playing: boolean) => void) {
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setIsPlaying(false);
    resetSharedAudio();
    await onLogout();
  };

  return { signingOut, signOut };
}
