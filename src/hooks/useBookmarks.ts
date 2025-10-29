import { useState, useEffect, useCallback, useMemo } from 'react';
import { BookmarkManager, BookmarkedArtifact } from '../utils/bookmarkUtils';

// Custom event to notify all components when bookmarks change
const BOOKMARKS_CHANGED_EVENT = 'bookmarks-changed';

export function useBookmarks(artifactManager: any) {
  const [bookmarks, setBookmarks] = useState<BookmarkedArtifact[]>([]);
  const [loading, setLoading] = useState(false);

  // Create a new BookmarkManager when artifactManager changes
  const bookmarkManager = useMemo(() => {
    return new BookmarkManager(artifactManager);
  }, [artifactManager]);

  const loadBookmarks = useCallback(async () => {
    if (!artifactManager) {
      setBookmarks([]);
      return;
    }
    setLoading(true);
    try {
      const bookmarks = await bookmarkManager.getBookmarks();
      setBookmarks(bookmarks);
    } catch (error) {
      console.error('Error loading bookmarks:', error);
      setBookmarks([]);
    } finally {
      setLoading(false);
    }
  }, [artifactManager, bookmarkManager]);

  useEffect(() => {
    loadBookmarks();

    // Listen for bookmark changes from other components
    const handleBookmarksChanged = () => {
      loadBookmarks();
    };

    window.addEventListener(BOOKMARKS_CHANGED_EVENT, handleBookmarksChanged);

    return () => {
      window.removeEventListener(BOOKMARKS_CHANGED_EVENT, handleBookmarksChanged);
    };
  }, [loadBookmarks]);

  const addBookmark = useCallback(async (artifact: BookmarkedArtifact) => {
    try {
      await bookmarkManager.addBookmark(artifact);
      await loadBookmarks();
      // Notify other components that bookmarks have changed
      window.dispatchEvent(new CustomEvent(BOOKMARKS_CHANGED_EVENT));
    } catch (error) {
      console.error('Error adding bookmark:', error);
      throw error;
    }
  }, [bookmarkManager, loadBookmarks]);

  const removeBookmark = useCallback(async (artifactId: string) => {
    try {
      await bookmarkManager.removeBookmark(artifactId);
      await loadBookmarks();
      // Notify other components that bookmarks have changed
      window.dispatchEvent(new CustomEvent(BOOKMARKS_CHANGED_EVENT));
    } catch (error) {
      console.error('Error removing bookmark:', error);
      throw error;
    }
  }, [bookmarkManager, loadBookmarks]);

  const isBookmarked = useCallback((artifactId: string) => {
    return bookmarks.some(b => b.id === artifactId);
  }, [bookmarks]);

  const toggleBookmark = useCallback(async (artifact: BookmarkedArtifact) => {
    if (isBookmarked(artifact.id)) {
      await removeBookmark(artifact.id);
    } else {
      await addBookmark(artifact);
    }
  }, [isBookmarked, addBookmark, removeBookmark]);

  return {
    bookmarks,
    loading,
    addBookmark,
    removeBookmark,
    isBookmarked,
    toggleBookmark,
    refreshBookmarks: loadBookmarks
  };
}
