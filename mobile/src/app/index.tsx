import { useState } from "react";
import { useRouter } from "expo-router";
import type { Book } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { LibraryView } from "@/components/library/LibraryView";
import { AddBookSheet } from "@/components/library/AddBookSheet";
import { PlayerDock } from "@/components/player/PlayerDock";
import { useToast } from "@/components/ui";
import { useAddBook } from "@/hooks/useAddBook";
import { useLibrary } from "@/hooks/useLibrary";
import { addBookToast } from "@/lib/addBookToast";

export default function LibraryScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { showToast } = useToast();
  const library = useLibrary();
  const addBook = useAddBook();
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleDelete = async (book: Book) => {
    const removed = await library.remove(book);
    showToast(removed ? `Deleted “${book.title}”.` : "Could not delete this book.", removed ? "info" : "error");
  };

  // The sheet narrates the add; this is the hand-off once the studio has something to play.
  const handleOpenBook = (book: Book) => {
    setSheetOpen(false);
    showToast(addBookToast(book));
    void library.reload();
    router.push(`/book/${book.id}`);
  };

  return (
    <>
      <LibraryView
        books={library.books}
        loading={library.loading}
        refreshing={library.refreshing}
        error={library.error}
        signedInAs={user?.email ?? null}
        onRetry={() => void library.reload()}
        onRefresh={() => void library.refresh()}
        onAddBook={() => setSheetOpen(true)}
        onSelectBook={(book) => router.push(`/book/${book.id}`)}
        onDeleteBook={(book) => void handleDelete(book)}
        onSignOut={() => void signOut()}
        dock={<PlayerDock />}
      />
      <AddBookSheet visible={sheetOpen} model={addBook} onClose={() => setSheetOpen(false)} onOpenBook={handleOpenBook} />
    </>
  );
}
