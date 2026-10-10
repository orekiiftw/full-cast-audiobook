import { useState } from "react";
import { Library } from "./components/Library";
import { BookDetail } from "./components/BookDetail";
import { Player } from "./components/Player";
import { AuthScreen } from "./components/AuthScreen";
import { AppBar, BrandLogo, Button, Icon, LevelMeter, useToast } from "./components/ui";
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
    <div className="relative flex min-h-screen flex-col bg-surface-0 text-ink-primary">
      <a
        href="#main"
        className="sr-only z-toast rounded-full bg-gold-300 px-4 py-2 text-caption font-semibold text-ink-inverse focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        Skip to content
      </a>
      <AppHeader email={user.email} signingOut={signingOut} onSignOut={signOut} onHome={route.returnToLibrary} />

      <main id="main" tabIndex={-1} className={`relative flex-1 focus:outline-none ${playerOpen ? "player-dock-spacer" : "pb-20"}`}>
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
  const initial = email.trim().charAt(0).toUpperCase() || "?";

  return (
    <AppBar>
      <button type="button" className="-ml-1 shrink-0 rounded-tile p-1" onClick={onHome} aria-label="Go to library">
        <BrandLogo />
      </button>

      <div className="flex min-w-0 items-center gap-3">
        <p className="hidden h-8 items-center gap-2 rounded-full border border-line-hairline bg-surface-1 px-3 text-micro font-semibold uppercase text-ink-tertiary md:flex">
          <LevelMeter bars={3} active={false} className="h-3 text-success-300" />
          Live studio
          <span className="sr-only">: connected</span>
        </p>

        <div className="flex h-11 min-w-0 items-center gap-1 rounded-full border border-line-hairline bg-surface-1 py-1 pl-1 pr-1 shadow-e-1">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold-300 font-serif text-body font-semibold text-ink-inverse"
          >
            {initial}
          </span>
          <span className="hidden min-w-0 max-w-56 truncate px-2 text-caption text-ink-secondary sm:block" title={email}>
            {email}
          </span>
          <Button
            variant="ghost"
            size="sm"
            isLoading={signingOut}
            onClick={onSignOut}
            aria-label={`Sign out ${email}`}
            className="h-9 px-2.5 sm:px-3"
          >
            {!signingOut && <Icon name="logout" size={16} />}
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </div>
    </AppBar>
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
