/**
 * The Sanctuary feed.
 *
 * The cards, the composer and the comment drawer are the same design that
 * was already here. What changed is that none of it is invented any more:
 * three hardcoded posts with borrowed stock photography, fabricated like
 * and share counts, and a `handleShare` that called `alert()` have been
 * replaced by a real feed.
 *
 * Every number on a card is a count of rows in the database. `liked` and
 * `bookmarked` are this viewer's own state, not a coin flip. Media is
 * uploaded, validated and stored rather than held as a base64 string in
 * component state that vanishes on refresh.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, del, get, patch as apiPatch, post as apiPost, upload } from './api';
import { Avatar, EditedMark, InlineEditor } from './ui';
import PullToRefresh from './PullToRefresh';
import type { Theme } from './theme';

interface MediaFile {
  type: 'image' | 'video';
  name: string;
  file: File;
}

interface PostMedia {
  type: 'image' | 'video';
  url: string;
  alt: string;
  thumbnail?: string;
}

interface Comment {
  id: number;
  author: string;
  avatar: string;
  avatarUrl?: string | null;
  content: string;
  timestamp: string;
  likes: number;
  liked?: boolean;
  editedAt?: string | null;
  isOwn?: boolean;
}

interface Post {
  id: number;
  author: {
    id?: number;
    username?: string;
    name: string;
    avatar: string;
    avatarUrl?: string | null;
    verified: boolean;
  };
  content: string;
  tags: string[];
  timestamp: string;
  likes: number;
  comments: number;
  shares: number;
  liked: boolean;
  bookmarked: boolean;
  showComments: boolean;
  media?: PostMedia | null;
  commentsList: Comment[];
  isOwn?: boolean;
}

const PAGE_SIZE = 20;

// The icons are plain SVG with no dependence on the screen's state, so
// they live out here. Declared inside the component they were re-created
// on every render, which remounts every icon in the feed each time.
const HeartIcon = ({ filled = false, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
  </svg>
);

const MessageIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);

const ShareIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="18" cy="5" r="3"/>
    <circle cx="6" cy="12" r="3"/>
    <circle cx="18" cy="19" r="3"/>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
  </svg>
);

const BookmarkIcon = ({ filled = false, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
  </svg>
);

const MoreIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="1"/>
    <circle cx="19" cy="12" r="1"/>
    <circle cx="5" cy="12" r="1"/>
  </svg>
);

const SendIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="22" y1="2" x2="11" y2="13"/>
    <polygon points="22,2 15,22 11,13 2,9"/>
  </svg>
);

const CloseIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const CameraIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
    <circle cx="12" cy="13" r="4"/>
  </svg>
);

function Sanctuary({
  theme,
  darkMode,
  onViewProfile,
  focusPostId,
  onFocusHandled,
}: {
  theme: Theme;
  darkMode?: boolean;
  onViewProfile?: (username: string) => void;
  /** Show this post first, with its comments open (a shared link, or
   * "Comment" on someone's profile). */
  focusPostId?: number | null;
  onFocusHandled?: () => void;
}) {
    const [newPost, setNewPost] = useState<string>('');
    const [commentInputs, setCommentInputs] = useState<Record<number, string>>({});
    const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
    const [selectedMedia, setSelectedMedia] = useState<MediaFile | null>(null);
    const [mediaPreview, setMediaPreview] = useState<string | null>(null);

    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);
    const [posting, setPosting] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const offsetRef = useRef(0);

    // Tapping a hashtag narrows the feed to that tag. The hashtags always
    // looked tappable and did nothing; the server has supported ?tag= all
    // along, so this only had to be wired up.
    const [activeTag, setActiveTag] = useState<string | null>(null);

    const loadFeed = useCallback(async (append = false) => {
      try {
        const offset = append ? offsetRef.current : 0;
        const tagParam = activeTag ? `&tag=${encodeURIComponent(activeTag)}` : '';
        const data = await get<{ posts: Post[]; hasMore: boolean }>(
          `/sanctuary/posts/?limit=${PAGE_SIZE}&offset=${offset}${tagParam}`,
        );
        offsetRef.current = offset + data.posts.length;
        setPosts((current) => (append ? [...current, ...data.posts] : data.posts));
        setHasMore(data.hasMore);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load the Sanctuary.');
      } finally {
        setLoading(false);
      }
    }, [activeTag]);

    useEffect(() => {
      loadFeed();
    }, [loadFeed]);

    // The post someone opened directly: fetched on its own (it may be far
    // down the feed, or not in it at all), put first, comments open.
    const [focusedId, setFocusedId] = useState<number | null>(null);
    useEffect(() => {
      if (!focusPostId || loading) return;
      let cancelled = false;
      (async () => {
        try {
          const found = await get<Post>(`/sanctuary/posts/${focusPostId}/`);
          if (cancelled) return;
          const comments = await get<Comment[]>(`/sanctuary/posts/${focusPostId}/comments/`).catch(() => []);
          setPosts((current) => [
            { ...found, showComments: true, commentsList: comments },
            ...current.filter((row) => row.id !== focusPostId),
          ]);
          setFocusedId(focusPostId);
        } catch {
          if (!cancelled) setError("That post isn't available — it may have been removed, or it isn't shared with you.");
        } finally {
          onFocusHandled?.();
        }
      })();
      return () => { cancelled = true; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusPostId, loading]);

    /** Update one post in place without refetching the whole feed. */
    const patchPost = (postId: number, changes: Partial<Post>) =>
      setPosts((current) =>
        current.map((row) => (row.id === postId ? { ...row, ...changes } : row)),
      );

      const VideoIcon = ({ size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="23,7 16,12 23,17"/>
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
    </svg>
  );

  const handleLike = async (postId: number): Promise<void> => {
    const current = posts.find((row) => row.id === postId);
    if (!current) return;

    // Optimistic, then corrected by the server's real count — so a
    // double-tap or a failed request can't leave a wrong number on screen.
    patchPost(postId, {
      liked: !current.liked,
      likes: current.likes + (current.liked ? -1 : 1),
    });

    try {
      const result = await apiPost<{ liked: boolean; likes: number }>(
        `/sanctuary/posts/${postId}/like/`,
      );
      patchPost(postId, { liked: result.liked, likes: result.likes });
    } catch {
      patchPost(postId, { liked: current.liked, likes: current.likes });
    }
  };

  const handleBookmark = async (postId: number): Promise<void> => {
    const current = posts.find((row) => row.id === postId);
    if (!current) return;

    patchPost(postId, { bookmarked: !current.bookmarked });
    try {
      const result = await apiPost<{ bookmarked: boolean }>(
        `/sanctuary/posts/${postId}/bookmark/`,
      );
      patchPost(postId, { bookmarked: result.bookmarked });
    } catch {
      patchPost(postId, { bookmarked: current.bookmarked });
    }
  };

  const toggleComments = async (postId: number): Promise<void> => {
    const current = posts.find((row) => row.id === postId);
    if (!current) return;

    const opening = !current.showComments;
    patchPost(postId, { showComments: opening });

    // Comments are fetched when the drawer opens rather than shipped with
    // every card in the feed — most cards are never opened.
    if (opening && current.commentsList.length === 0 && current.comments > 0) {
      try {
        const comments = await get<Comment[]>(`/sanctuary/posts/${postId}/comments/`);
        patchPost(postId, { commentsList: comments });
      } catch {
        setError('Could not load those comments.');
      }
    }
  };

  const handleComment = async (postId: number): Promise<void> => {
    const commentText = commentInputs[postId];
    if (!commentText?.trim()) return;

    setCommentInputs({ ...commentInputs, [postId]: '' });
    try {
      const comment = await apiPost<Comment>(`/sanctuary/posts/${postId}/comments/`, {
        content: commentText.trim(),
      });
      const current = posts.find((row) => row.id === postId);
      patchPost(postId, {
        comments: (current?.comments || 0) + 1,
        commentsList: [...(current?.commentsList || []), comment],
      });
    } catch (err) {
      setCommentInputs({ ...commentInputs, [postId]: commentText });
      setError(err instanceof ApiError ? err.message : 'That comment did not post.');
    }
  };

  /**
   * Correct one of your own comments.
   *
   * Throws on failure rather than swallowing it, so the inline editor
   * stays open with the text still in it instead of discarding the
   * correction and silently showing the old version.
   */
  const saveCommentEdit = async (postId: number, commentId: number, text: string): Promise<void> => {
    const updated = await apiPatch<Comment>(
      `/sanctuary/posts/${postId}/comments/${commentId}/`,
      { content: text },
    );
    const current = posts.find((row) => row.id === postId);
    patchPost(postId, {
      commentsList: (current?.commentsList || []).map((row) =>
        row.id === commentId ? { ...row, ...updated } : row,
      ),
    });
    setEditingCommentId(null);
  };

  const handleShare = async (postId?: number): Promise<void> => {
    if (!postId) return;
    try {
      const result = await apiPost<{ shares: number }>(`/sanctuary/posts/${postId}/share/`);
      patchPost(postId, { shares: result.shares });

      // Offer the OS share sheet where there is one; otherwise the share
      // is still recorded, which is the part that was fake before.
      const link = `${window.location.origin}/#/sanctuary/${postId}`;
      if (navigator.share) {
        await navigator.share({ title: 'SoulLog', url: link }).catch(() => {});
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(link).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not share that.');
    }
  };

  const handleDeletePost = async (postId: number): Promise<void> => {
    try {
      await del(`/sanctuary/posts/${postId}/`);
      setPosts((current) => current.filter((row) => row.id !== postId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove that post.');
    }
  };

  const handleNewPost = async (): Promise<void> => {
    if ((!newPost.trim() && !selectedMedia) || posting) return;

    setPosting(true);
    try {
      // Hashtags typed into the text become real tags, which is what makes
      // the trending-tag list and tag search mean anything.
      const tags = (newPost.match(/#[\w-]+/g) || []).slice(0, 10);

      let created: Post;
      if (selectedMedia) {
        const form = new FormData();
        form.append('content', newPost.trim());
        form.append('tags', tags.join(','));
        form.append('media', selectedMedia.file);
        form.append('alt', selectedMedia.name);
        created = await upload<Post>('/sanctuary/posts/', form);
      } else {
        created = await apiPost<Post>('/sanctuary/posts/', {
          content: newPost.trim(),
          tags,
        });
      }

      setPosts((current) => [created, ...current]);
      setNewPost('');
      setSelectedMedia(null);
      setMediaPreview(null);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That post did not go through.');
    } finally {
      setPosting(false);
    }
  };

  const handleMediaUpload = (event: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'video'): void => {
    const file = event.target.files?.[0];
    // Clear the picker so picking again after a warning still works.
    event.target.value = '';
    if (!file) return;

    // A client-side check for a fast, friendly message. The real limit is
    // enforced on the server, which is the one that counts.
    const validImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const validVideoTypes = ['video/mp4', 'video/webm', 'video/quicktime'];

    if (type === 'image' && !validImageTypes.includes(file.type)) {
      setError('Please choose a JPEG, PNG, GIF or WebP image.');
      return;
    }
    if (type === 'video' && !validVideoTypes.includes(file.type)) {
      setError('Please choose an MP4, WebM or MOV video.');
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      const sizeMb = Math.round(file.size / (1024 * 1024));
      setError(`That ${type === 'video' ? 'video' : 'photo'} is ${sizeMb} MB. The limit is 100 MB, so please choose a smaller one.`);
      return;
    }

    setError(null);
    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>): void => {
      setSelectedMedia({ type, name: file.name, file });
      setMediaPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const removeMedia = (): void => {
    setSelectedMedia(null);
    setMediaPreview(null);
  };
  return (
    <PullToRefresh theme={theme} onRefresh={() => loadFeed(false)}>
    <div>

        {/* Create Post */}
        <div className='my-[0.5rem] mx-2' style={{
          background: theme.surface,
          borderRadius: '1rem',
          padding: '1rem',
          border: `1px solid ${theme.border}`,
          boxShadow: darkMode ? '0 4px 6px -1px rgba(0, 0, 0, 0.1)' : '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem'
          }}>
            <div style={{
              width: '2.5rem',
              height: '2.5rem',
              background: `linear-gradient(135deg, ${theme.secondary}, ${theme.accent})`,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.125rem',
              flexShrink: 0
            }}>
              😊
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <textarea
                value={newPost}
                onChange={(e) => setNewPost(e.target.value)}
                placeholder="Share your thoughts..."
                aria-label="Share your thoughts"
                style={{
                  width: '100%',
                  background: 'transparent',
                  resize: 'none',
                  border: 'none',
                  outline: 'none',
                  color: theme.text,
                  fontFamily: 'inherit',
                  minHeight: '3rem'
                }}
                rows={2}
              />
              
              {mediaPreview && (
                <div style={{ marginTop: '0.75rem', position: 'relative' }}>
                  <div style={{
                    position: 'relative',
                    borderRadius: '0.5rem',
                    overflow: 'hidden',
                    background: theme.surface
                  }}>
                    {selectedMedia?.type === 'image' ? (
                      <img 
                        src={mediaPreview} 
                        alt="Preview" 
                        style={{
                          width: '100%',
                          height: '12rem',
                          objectFit: 'cover'
                        }}
                      />
                    ) : (
                      <video 
                        src={mediaPreview} 
                        controls 
                        style={{
                          width: '100%',
                          height: '12rem',
                          objectFit: 'cover'
                        }}
                      />
                    )}
                    <button
                      onClick={removeMedia}
                      style={{
                        position: 'absolute',
                        top: '0.5rem',
                        right: '0.5rem',
                        background: 'rgba(0, 0, 0, 0.5)',
                        borderRadius: '50%',
                        padding: '0.25rem',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'white',
                        transition: 'background 0.3s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.7)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.5)'}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                  <p style={{
                    fontSize: '0.75rem',
                    color: `${theme.text}80`,
                    marginTop: '0.25rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {selectedMedia?.name} • {selectedMedia?.type}
                  </p>
                </div>
              )}

              </div>
            </div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '0.5rem',
            flexWrap: 'wrap',
            gap: '0.5rem'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              flexWrap: 'wrap'
            }}>
              <label
              title="Add a photo"
              aria-label="Add a photo"
              style={{
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '0.35rem',
                borderRadius: '9999px',
                color: `${theme.text}80`,
                transition: 'color 0.3s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = theme.secondary}
              onMouseLeave={(e) => e.currentTarget.style.color = `${theme.text}80`}
              >
                <CameraIcon />
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleMediaUpload(e, 'image')}
                  style={{ display: 'none' }}
                />
              </label>

              <label
              title="Add a video"
              aria-label="Add a video"
              style={{
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '0.35rem',
                borderRadius: '9999px',
                color: `${theme.text}80`,
                transition: 'color 0.3s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = theme.secondary}
              onMouseLeave={(e) => e.currentTarget.style.color = `${theme.text}80`}
              >
                <VideoIcon />
                <input
                  type="file"
                  accept="video/*"
                  onChange={(e) => handleMediaUpload(e, 'video')}
                  style={{ display: 'none' }}
                />
              </label>

            </div>
            
            <button
              onClick={handleNewPost}
              disabled={(!newPost.trim() && !selectedMedia) || posting}
              style={{
                background: newPost.trim() ? `linear-gradient(135deg, ${theme.secondary}, ${theme.accent})` : `${theme.border}80`,
                color: newPost.trim() ? theme.background : `${theme.text}60`,
                padding: '0.375rem 1rem',
                borderRadius: '0.5rem',
                fontWeight: '500',
                transition: 'all 0.3s ease',
                fontSize: '0.875rem',
                whiteSpace: 'nowrap',
                border: 'none',
                cursor: (newPost.trim() || selectedMedia) ? 'pointer' : 'not-allowed'
              }}
            >
              {posting ? 'Sharing…' : 'Share'}
            </button>
          </div>
        </div>

        {error && (
          <div className='mx-2 mb-2' style={{
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            borderRadius: '0.75rem',
            padding: '0.75rem 1rem',
            color: theme.text,
            fontSize: '0.875rem',
          }}>
            {error}
          </div>
        )}

        {/* Posts Feed */}
        <div className='space-y-2 text-left mx-2'>
          {posts.length === 0 && (
            <div style={{
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: '1rem',
              padding: '3rem 1.5rem',
              textAlign: 'center',
              color: theme.text,
            }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🕊️</div>
              <p style={{ opacity: 0.7, margin: 0 }}>
                {loading
                  ? 'Loading the Sanctuary…'
                  : 'Nothing here yet. Share a thought, or connect with someone to see theirs.'}
              </p>
            </div>
          )}
          {activeTag && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0.6rem 1rem', marginBottom: '0.75rem', borderRadius: '0.75rem',
              background: theme.surface, border: `1px solid ${theme.secondary}66`, color: theme.text,
              fontSize: '0.9rem',
            }}>
              <span>Showing posts tagged <strong style={{ color: theme.secondary }}>#{activeTag.replace(/^#/, '')}</strong></span>
              <button
                onClick={() => setActiveTag(null)}
                aria-label="Show all posts"
                style={{ background: 'none', border: 'none', color: theme.text, cursor: 'pointer', fontSize: '1rem', padding: '0 0.25rem' }}
              >
                ✕
              </button>
            </div>
          )}
          {posts.map((post: Post) => (
            <div key={post.id} style={{
              background: theme.surface,
              borderRadius: '1rem',
              // The post opened directly is outlined, so it's clear which one.
              border: post.id === focusedId ? `2px solid ${theme.accent}` : `1px solid ${theme.border}`,
              boxShadow: darkMode ? '0 4px 6px -1px rgba(0, 0, 0, 0.1)' : '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
              overflow: 'hidden',
            }}>
              {/* Post Header */}
              <div style={{ padding: '1.5rem', paddingBottom: '1rem' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  marginBottom: '1rem'
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    minWidth: 0,
                    flex: 1
                  }}>
                    <Avatar
                      user={{ name: post.author.name, initials: post.author.avatar, avatarUrl: post.author.avatarUrl }}
                      size={48}
                      background={`linear-gradient(135deg, ${theme.secondary}, ${theme.accent})`}
                      color={theme.text}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <h3
                      onClick={() => post.author?.username && onViewProfile?.(post.author.username)}
                      style={{
                        cursor: post.author?.username ? 'pointer' : 'default',
                          fontWeight: '600',
                          color: theme.text,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          margin: 0,
                          fontSize: '1rem'
                        }}>
                          {post.author.name}
                        </h3>
                        {post.author.verified && (
                          <div style={{
                            width: '1.25rem',
                            height: '1.25rem',
                            background: theme.secondary,
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                          }}>
                            <span style={{ color: 'white', fontSize: '0.75rem' }}>✓</span>
                          </div>
                        )}
                      </div>
                      <p style={{
                        color: `${theme.text}80`,
                        fontSize: '0.875rem',
                        margin: 0
                      }}>
                        {post.timestamp}
                      </p>
                    </div>
                  </div>
                  {/* The overflow button had no behaviour at all. On your
                      own post it now removes it; on someone else's there is
                      nothing here to offer yet, so it isn't drawn. */}
                  {post.isOwn && (
                    <button
                      title="Remove this post"
                      onClick={() => handleDeletePost(post.id)}
                      style={{
                        color: `${theme.text}80`,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        flexShrink: 0,
                        transition: 'color 0.3s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.color = theme.text}
                      onMouseLeave={(e) => e.currentTarget.style.color = `${theme.text}80`}
                    >
                      <MoreIcon />
                    </button>
                  )}
                </div>

                <p style={{
                  color: theme.text,
                  lineHeight: '1.6',
                  marginBottom: '1rem',
                  margin: '0 0 1rem 0'
                }}>
                  {post.content}
                </p>

                {post.media && (
                  <div style={{
                    marginBottom: '1rem',
                    borderRadius: '0.5rem',
                    overflow: 'hidden',
                    background: theme.surface
                  }}>
                    {post.media.type === 'image' ? (
                      <img 
                        src={post.media.url} 
                        alt={post.media.alt}
                        style={{
                          width: '100%',
                          height: '24rem',
                          objectFit: 'cover',
                          cursor: 'pointer',
                          transition: 'opacity 0.3s ease'
                        }}
                        onClick={() => {
                          window.open(post.media?.url, '_blank');
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.opacity = '0.95'}
                        onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                      />
                    ) : post.media.type === 'video' ? (
                      <video 
                        src={post.media.url}
                        poster={post.media.thumbnail}
                        controls
                        style={{
                          width: '100%',
                          height: '24rem',
                          objectFit: 'cover'
                        }}
                        preload="metadata"
                      />
                    ) : null}
                  </div>
                )}

                {post.tags.length > 0 && (
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                    marginBottom: '1rem'
                  }}>
                    {post.tags.map((tag: string) => (
                      <button key={tag} onClick={() => { setActiveTag(tag); window.scrollTo({ top: 0, behavior: 'smooth' }); }} style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        color: theme.secondary,
                        fontSize: '0.875rem',
                        cursor: 'pointer',
                        transition: 'color 0.3s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.color = theme.accent}
                      onMouseLeave={(e) => e.currentTarget.style.color = theme.secondary}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Post Actions */}
              <div style={{
                padding: '0 1.5rem 0.75rem 1.5rem',
                borderTop: `1px solid ${theme.border}`
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: '0.75rem'
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1.5rem'
                  }}>
                    <button
                      onClick={() => handleLike(post.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        transition: 'color 0.3s ease',
                        color: post.liked ? '#ef4444' : `${theme.text}80`,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer'
                      }}
                      onMouseEnter={(e) => {
                        if (!post.liked) e.currentTarget.style.color = '#ef4444';
                      }}
                      onMouseLeave={(e) => {
                        if (!post.liked) e.currentTarget.style.color = `${theme.text}80`;
                      }}
                    >
                      <HeartIcon filled={post.liked} />
                      <span style={{ fontSize: '0.875rem' }}>{post.likes}</span>
                    </button>
                    
                    <button
                      onClick={() => toggleComments(post.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        color: `${theme.text}80`,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'color 0.3s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.color = theme.secondary}
                      onMouseLeave={(e) => e.currentTarget.style.color = `${theme.text}80`}
                    >
                      <MessageIcon />
                      <span style={{ fontSize: '0.875rem' }}>{post.comments}</span>
                    </button>
                    
                    <button
                      onClick={() => handleShare(post.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        color: `${theme.text}80`,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'color 0.3s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.color = '#22c55e'}
                      onMouseLeave={(e) => e.currentTarget.style.color = `${theme.text}80`}
                    >
                      <ShareIcon />
                      <span style={{ fontSize: '0.875rem' }}>{post.shares}</span>
                    </button>
                  </div>
                  
                  <button
                    onClick={() => handleBookmark(post.id)}
                    style={{
                      transition: 'color 0.3s ease',
                      color: post.bookmarked ? '#eab308' : `${theme.text}80`,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer'
                    }}
                    onMouseEnter={(e) => {
                      if (!post.bookmarked) e.currentTarget.style.color = '#eab308';
                    }}
                    onMouseLeave={(e) => {
                      if (!post.bookmarked) e.currentTarget.style.color = `${theme.text}80`;
                    }}
                  >
                    <BookmarkIcon filled={post.bookmarked} />
                  </button>
                </div>
              </div>

              {/* Comments Section */}
              {post.showComments && (
                <div style={{ borderTop: `1px solid ${theme.border}` }}>
                  {/* Existing Comments */}
                  {post.commentsList.map((comment: Comment) => (
                    <div key={comment.id} style={{
                      padding: '1rem',
                      borderBottom: `1px solid ${theme.border}40`
                    }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.75rem'
                      }}>
                        <Avatar
                          user={{ name: comment.author, initials: comment.avatar, avatarUrl: comment.avatarUrl }}
                          size={32}
                          background={`linear-gradient(135deg, #22c55e, ${theme.secondary})`}
                          color={theme.text}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            marginBottom: '0.25rem'
                          }}>
                            <span style={{
                              fontWeight: '500',
                              color: theme.text,
                              fontSize: '0.875rem',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}>
                              {comment.author}
                            </span>
                            <span style={{
                              color: `${theme.text}80`,
                              fontSize: '0.75rem'
                            }}>
                              {comment.timestamp}
                            </span>
                          </div>
                          {editingCommentId === comment.id ? (
                            <InlineEditor
                              value={comment.content}
                              theme={theme}
                              onSave={(text) => saveCommentEdit(post.id, comment.id, text)}
                              onCancel={() => setEditingCommentId(null)}
                              placeholder="Edit your comment…"
                            />
                          ) : (
                            <>
                              <p style={{
                                color: `${theme.text}E6`,
                                fontSize: '0.875rem',
                                margin: 0,
                                lineHeight: '1.4'
                              }}>
                                {comment.content} <EditedMark editedAt={comment.editedAt} theme={theme} />
                              </p>
                              {comment.isOwn && (
                                <button
                                  onClick={() => setEditingCommentId(comment.id)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: '0.25rem 0 0 0',
                                    color: `${theme.text}80`,
                                    fontSize: '0.75rem',
                                    cursor: 'pointer'
                                  }}
                                >
                                  Edit
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Add Comment */}
                  <div style={{ padding: '1rem' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem'
                    }}>
                      <div style={{
                        width: '2rem',
                        height: '2rem',
                        background: `linear-gradient(135deg, ${theme.secondary}, ${theme.accent})`,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.875rem',
                        flexShrink: 0
                      }}>
                        😊
                      </div>
                      <div style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                      }}>
                        <input
                          type="text"
                          value={commentInputs[post.id] || ''}
                          onChange={(e) => setCommentInputs({ ...commentInputs, [post.id]: e.target.value })}
                          placeholder="Add a thoughtful comment..."
                          style={{
                            flex: 1,
                            background: theme.surface,
                            border: `1px solid ${theme.border}`,
                            borderRadius: '0.5rem',
                            padding: '0.5rem 0.75rem',
                            color: theme.text,
                            fontSize: '0.875rem',
                            fontFamily: 'inherit',
                            outline: 'none'
                          }}
                          onKeyPress={(e) => e.key === 'Enter' && handleComment(post.id)}
                          onFocus={(e) => e.currentTarget.style.borderColor = theme.secondary}
                          onBlur={(e) => e.currentTarget.style.borderColor = theme.border}
                        />
                        <button
                          onClick={() => handleComment(post.id)}
                          style={{
                            color: theme.secondary,
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            flexShrink: 0,
                            transition: 'color 0.3s ease'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.color = theme.accent}
                          onMouseLeave={(e) => e.currentTarget.style.color = theme.secondary}
                        >
                          <SendIcon />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Load More */}
        <div style={{ textAlign: 'center', marginTop: '2rem', display: hasMore ? 'block' : 'none' }}>
          <button
          onClick={() => loadFeed(true)}
          style={{
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            padding: '0.75rem 1.5rem',
            borderRadius: '0.5rem',
            color: theme.text,
            transition: 'all 0.3s ease',
            cursor: 'pointer',
            fontFamily: 'inherit'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = theme.surface;
            e.currentTarget.style.borderColor = theme.accent;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = theme.cardBg;
            e.currentTarget.style.borderColor = theme.border;
          }}
          >
            Load More Posts
          </button>
        </div>
      </div>
    </PullToRefresh>
  )
}

export default Sanctuary
