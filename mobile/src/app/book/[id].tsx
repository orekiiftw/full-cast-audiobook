import { Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Chapter } from "@/api/types";
import { deleteBook } from "@/api/books";
import { useBookDetail } from "@/hooks/useBookDetail";
import { usePlayer } from "@/playback/PlayerProvider";
import { BookDetailView } from "@/components/bookDetail/BookDetailView";
import { PlayerDock } from "@/components/player/PlayerDock";
import { useToast } from "@/components/ui";

export default function BookDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useBookDetail(typeof id === "string" ? id : undefined);
  const player = usePlayer();
  const { showToast } = useToast();

  const playChapter = (chapter: Chapter) => {
    if (!detail.book) return;
    const resumeMs = detail.resumeMsFor(chapter);
    void player.playChapter(detail.book, chapter, resumeMs).then(() => router.push("/player"));
  };

  const remove = () => {
    if (!detail.book) return;
    Alert.alert(`Delete "${detail.book.title}"?`, "The performance is removed from your library.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void deleteBook(detail.book!.id)
            .then(() => {
              if (player.activeBook?.id === detail.book?.id) player.stop();
              showToast("Book deleted.");
              router.back();
            })
            .catch(() => showToast("Could not delete this book.", "error"));
        },
      },
    ]);
  };

  return (
    <BookDetailView
      detail={detail}
      activeChapterId={player.activeBook?.id === detail.book?.id ? (player.activeChapter?.id ?? null) : null}
      onBack={() => router.back()}
      onPlayChapter={playChapter}
      onDelete={remove}
      dock={player.activeBook?.id === detail.book?.id ? <PlayerDock /> : null}
    />
  );
}
