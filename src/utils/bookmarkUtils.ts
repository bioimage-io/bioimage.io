export interface BookmarkedArtifact {
  id: string;
  name: string;
  description: string;
  covers?: string[];
  icon?: string;
}

export interface BookmarkManifest {
  artifacts: BookmarkedArtifact[];
}

export class BookmarkManager {
  private artifactManager: any;
  private readonly BOOKMARK_ALIAS = 'ri-scale-bookmarks';
  private bookmarkArtifactId: string | null = null;

  constructor(artifactManager: any) {
    this.artifactManager = artifactManager;
  }

  private async getBookmarkArtifactId(): Promise<string | null> {
    if (this.bookmarkArtifactId) {
      return this.bookmarkArtifactId;
    }

    if (!this.artifactManager) {
      return null;
    }

    try {
      // Method 1: Try to list artifacts with the bookmark type
      const response = await this.artifactManager.list({
        filters: { type: 'bookmark' },
        limit: 100, // Get more items in case there are multiple bookmarks
        _rkwargs: true
      });

      if (response.items && response.items.length > 0) {
        // Find the one with our specific alias
        const bookmarkArtifact = response.items.find(
          (item: any) => item.alias === this.BOOKMARK_ALIAS
        );

        if (bookmarkArtifact) {
          this.bookmarkArtifactId = bookmarkArtifact.id;
          return this.bookmarkArtifactId;
        }
      }
    } catch (error) {
      console.log('Error finding bookmark artifact with list:', error);
    }

    // Method 2: If list didn't work, try to read directly by alias
    // The API might support reading by alias directly
    try {
      const artifact = await this.artifactManager.read({
        artifact_id: this.BOOKMARK_ALIAS,
        _rkwargs: true
      });

      if (artifact && artifact.id) {
        this.bookmarkArtifactId = artifact.id;
        return this.bookmarkArtifactId;
      }
    } catch (error) {
      console.log('Error reading bookmark artifact by alias:', error);
    }

    return null;
  }

  async getBookmarks(): Promise<BookmarkedArtifact[]> {
    if (!this.artifactManager) {
      return [];
    }

    try {
      const artifactId = await this.getBookmarkArtifactId();
      if (!artifactId) {
        return [];
      }

      const artifact = await this.artifactManager.read({
        artifact_id: artifactId,
        _rkwargs: true
      });
      return artifact.manifest?.artifacts || [];
    } catch (error) {
      // Bookmark artifact doesn't exist yet
      console.log('No bookmarks found:', error);
      return [];
    }
  }

  async addBookmark(bookmarkedArtifact: BookmarkedArtifact): Promise<void> {
    if (!this.artifactManager) {
      console.warn('Artifact manager not initialized, waiting...');
      // Wait a bit for the artifact manager to initialize
      await new Promise(resolve => setTimeout(resolve, 500));
      if (!this.artifactManager) {
        throw new Error('Artifact manager not initialized');
      }
    }

    try {
      let artifactId = await this.getBookmarkArtifactId();

      if (artifactId) {
        // Bookmark artifact exists, update it
        const artifact = await this.artifactManager.read({
          artifact_id: artifactId,
          _rkwargs: true
        });

        const existingArtifacts = artifact.manifest?.artifacts || [];

        // Check if already bookmarked
        if (existingArtifacts.some((a: BookmarkedArtifact) => a.id === bookmarkedArtifact.id)) {
          console.log('Artifact already bookmarked');
          return;
        }

        // Add new bookmark
        const updatedArtifacts = [...existingArtifacts, bookmarkedArtifact];

        await this.artifactManager.edit({
          artifact_id: artifactId,
          manifest: {
            name: 'My Bookmarks',
            description: 'Bookmarked artifacts',
            artifacts: updatedArtifacts
          },
          _rkwargs: true
        });
      } else {
        // Bookmark artifact doesn't exist, create it
        try {
          const newArtifact = await this.artifactManager.create({
            alias: this.BOOKMARK_ALIAS,
            type: 'bookmark',
            manifest: {
              name: 'My Bookmarks',
              description: 'Bookmarked artifacts',
              artifacts: [bookmarkedArtifact]
            },
            _rkwargs: true
          });

          // Store the artifact ID for future use
          this.bookmarkArtifactId = newArtifact.id;
        } catch (createError: any) {
          // Check if the error is because the artifact already exists
          if (createError.message && createError.message.includes('already exists')) {
            console.log('Bookmark artifact already exists, trying to find and update it...');
            // Reset the cached ID and try to find it again
            this.bookmarkArtifactId = null;
            artifactId = await this.getBookmarkArtifactId();

            if (artifactId) {
              // Found it, now update it
              const artifact = await this.artifactManager.read({
                artifact_id: artifactId,
                _rkwargs: true
              });

              const existingArtifacts = artifact.manifest?.artifacts || [];

              // Check if already bookmarked
              if (existingArtifacts.some((a: BookmarkedArtifact) => a.id === bookmarkedArtifact.id)) {
                console.log('Artifact already bookmarked');
                return;
              }

              // Add new bookmark
              const updatedArtifacts = [...existingArtifacts, bookmarkedArtifact];

              await this.artifactManager.edit({
                artifact_id: artifactId,
                manifest: {
                  name: 'My Bookmarks',
                  description: 'Bookmarked artifacts',
                  artifacts: updatedArtifacts
                },
                _rkwargs: true
              });
            } else {
              throw new Error('Could not find or create bookmark artifact');
            }
          } else {
            throw createError;
          }
        }
      }
    } catch (error) {
      console.error('Error adding bookmark:', error);
      throw error;
    }
  }

  async removeBookmark(artifactId: string): Promise<void> {
    if (!this.artifactManager) {
      throw new Error('Artifact manager not initialized');
    }

    try {
      const bookmarkArtifactId = await this.getBookmarkArtifactId();
      if (!bookmarkArtifactId) {
        console.log('No bookmark artifact found');
        return;
      }

      const artifact = await this.artifactManager.read({
        artifact_id: bookmarkArtifactId,
        _rkwargs: true
      });

      const existingArtifacts = artifact.manifest?.artifacts || [];
      const updatedArtifacts = existingArtifacts.filter(
        (a: BookmarkedArtifact) => a.id !== artifactId
      );

      await this.artifactManager.edit({
        artifact_id: bookmarkArtifactId,
        manifest: {
          name: 'My Bookmarks',
          description: 'Bookmarked artifacts',
          artifacts: updatedArtifacts
        },
        _rkwargs: true
      });
    } catch (error) {
      console.error('Error removing bookmark:', error);
      throw error;
    }
  }

  async isBookmarked(artifactId: string): Promise<boolean> {
    const bookmarks = await this.getBookmarks();
    return bookmarks.some(a => a.id === artifactId);
  }
}
