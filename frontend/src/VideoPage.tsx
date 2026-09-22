/**
 * The content library — the Videos tab inside Community.
 *
 * Six invented videos with fabricated view counts, a `handleLike` that
 * called `console.log`, and two hardcoded comments signed "Sarah Chen"
 * have been replaced by the real library. Categories come from the
 * database, search hits the server, and likes, saves, shares, views and
 * comments are all rows.
 *
 * One honest limitation is visible in the player: a library item can have
 * a real uploaded file or an external link, and demo items have neither.
 * When there is nothing to play, the card says so instead of showing a
 * play button that does nothing when pressed.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, VolumeX, Heart, MessageCircle, Share, Bookmark, MoreHorizontal, Clock, Eye, Send } from 'lucide-react';
import { ApiError, del, get, patch, post } from './api';
import type { LibraryComment, Theme } from './types';
import { Avatar, EditedMark, InlineEditor } from './ui';
import PullToRefresh from './PullToRefresh';

interface MessagePageProps {
  theme: Theme;
  darkMode?: boolean;
  isMobile?: boolean;
  setHideExtra?: (hidden: boolean) => void;
  setDarkMode?: (dark: boolean) => void;
}

type LibraryItem = {
  id: number;
  title: string;
  author: string;
  authorId: number;
  authorAvatar: string;
  authorAvatarUrl: string | null;
  thumbnail: string;
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  medium: string;
  duration: string;
  views: number;
  likes: number;
  shares: number;
  commentCount: number;
  timeAgo: string;
  description: string;
  category: string;
  tags: string[];
  liked: boolean;
  saved: boolean;
  isOwn: boolean;
  progressSeconds: number;
};

const VideoInterface = ({ theme, darkMode }: MessagePageProps) => {
  const [activeVideo, setActiveVideo] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [showComments, setShowComments] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  // Keyed by item id; a ref callback stores null when a card unmounts.
  const videoRefs = useRef<Record<number, HTMLVideoElement | null>>({});

  const [videos, setVideos] = useState<LibraryItem[]>([]);
  // The "…" menu on a card you uploaded. It was drawn on every card and
  // did nothing; like, save and share already sit on the card, so the only
  // action it adds is deleting your own upload, asked twice.
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deleteItem = async (videoId: number) => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await del(`/content/${videoId}/`);
      setVideos((rows) => rows.filter((row) => row.id !== videoId));
      setMenuFor(null);
      setConfirmDelete(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete that.');
    }
  };
  const [categories, setCategories] = useState<{ id: string; label: string; icon: string }[]>([
    { id: 'all', label: 'All Videos', icon: '🎬' },
  ]);
  const [commentsByVideo, setCommentsByVideo] = useState<Record<number, LibraryComment[]>>({});
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedCategory && selectedCategory !== 'all') params.set('category', selectedCategory);
      if (searchQuery.trim()) params.set('q', searchQuery.trim());

      const data = await get<{ content: LibraryItem[] }>(`/content/?${params.toString()}`);
      setVideos(data.content);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the library.');
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, searchQuery]);

  useEffect(() => {
    // Debounced so typing in the search box doesn't fire a request per
    // keystroke — search is a server round trip here, not a local filter.
    const timer = setTimeout(load, searchQuery ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, searchQuery]);

  useEffect(() => {
    (async () => {
      try {
        const rows = await get<{ id: string; label: string; icon: string; count: number }[]>(
          '/content/categories/',
        );
        setCategories([
          { id: 'all', label: 'All Videos', icon: '🎬' },
          // Categories with nothing in them are left out rather than
          // offering a chip that leads to an empty page.
          ...rows.filter((row) => row.count > 0),
        ]);
      } catch {
        // The "All Videos" chip alone still works.
      }
    })();
  }, []);

  const patchVideo = (id: number, changes: Partial<LibraryItem>) =>
    setVideos((current) => current.map((row) => (row.id === id ? { ...row, ...changes } : row)));

  // Server-side filtering already applied; this keeps the render simple.
  const filteredVideos = videos;

  const handlePlayPause = (videoId: number) => {
    const videoElement = videoRefs.current[videoId];
    if (videoElement) {
      if (activeVideo === videoId) {
        videoElement.pause();
        setActiveVideo(null);
      } else {
        // Pause all other videos
        Object.keys(videoRefs.current).forEach(id => {
          const other = videoRefs.current[Number(id)];
          if (id !== videoId.toString() && other) {
            other.pause();
          }
        });
        videoElement.play();
        setActiveVideo(videoId);
      }
    }
  };


  const handleMute = (videoId: number) => {
    const videoElement = videoRefs.current[(videoId)];
    if (videoElement) {
      videoElement.muted = !muted;
      setMuted(!muted);
    }
  };

  const handleLike = async (videoId: number) => {
    const current = videos.find((row) => row.id === videoId);
    if (!current) return;

    patchVideo(videoId, { liked: !current.liked, likes: current.likes + (current.liked ? -1 : 1) });
    try {
      const result = await post<{ liked: boolean; likes: number }>(`/content/${videoId}/like/`);
      patchVideo(videoId, { liked: result.liked, likes: result.likes });
    } catch {
      patchVideo(videoId, { liked: current.liked, likes: current.likes });
    }
  };

  const handleSave = async (videoId: number) => {
    const current = videos.find((row) => row.id === videoId);
    if (!current) return;

    patchVideo(videoId, { saved: !current.saved });
    try {
      const result = await post<{ saved: boolean }>(`/content/${videoId}/save/`);
      patchVideo(videoId, { saved: result.saved });
    } catch {
      patchVideo(videoId, { saved: current.saved });
    }
  };

  const handleComment = async (videoId: number) => {
    const opening = showComments !== videoId;
    setShowComments(opening ? videoId : null);

    if (opening && !commentsByVideo[videoId]) {
      try {
        const rows = await get<LibraryComment[]>(`/content/${videoId}/comments/`);
        setCommentsByVideo((current) => ({ ...current, [videoId]: rows }));
      } catch {
        setError('Could not load those comments.');
      }
    }
  };

  const handleShare = async (videoId: number) => {
    try {
      const result = await post<{ shares: number }>(`/content/${videoId}/share/`);
      patchVideo(videoId, { shares: result.shares });

      const link = `${window.location.origin}/#/library/${videoId}`;
      if (navigator.share) {
        await navigator.share({ title: 'SoulLog', url: link }).catch(() => {});
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(link).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not share that.');
    }
  };

  const handleSendComment = async (videoId: number) => {
    const body = comment.trim();
    if (!body) return;

    setComment('');
    try {
      const created = await post<LibraryComment>(`/content/${videoId}/comments/`, { body });
      setCommentsByVideo((current) => ({
        ...current,
        [videoId]: [created, ...(current[videoId] || [])],
      }));
      const existing = videos.find((row) => row.id === videoId);
      patchVideo(videoId, { commentCount: (existing?.commentCount || 0) + 1 });
    } catch (err) {
      setComment(body);
      setError(err instanceof ApiError ? err.message : 'That comment did not post.');
    }
  };

  /**
   * Correct one of your own comments. Throws on failure so the inline
   * editor keeps what you typed instead of dropping it.
   */
  const saveCommentEdit = async (videoId: number, commentId: number, text: string) => {
    const updated = await patch<LibraryComment>(
      `/content/${videoId}/comments/${commentId}/`,
      { body: text },
    );
    setCommentsByVideo((current) => ({
      ...current,
      [videoId]: (current[videoId] || []).map((row) =>
        row.id === commentId ? { ...row, ...updated } : row,
      ),
    }));
    setEditingCommentId(null);
  };

  /**
   * Record how far through an item the viewer got.
   *
   * Also what counts a view — on the server, only the first time, so
   * replaying something doesn't inflate its numbers.
   */
  const recordProgress = async (videoId: number, seconds: number, completed = false) => {
    try {
      const result = await post<{ views: number }>(`/content/${videoId}/progress/`, {
        seconds: Math.floor(seconds),
        completed,
      });
      patchVideo(videoId, { views: result.views });
    } catch {
      // Progress is a convenience; losing one update is not worth a message.
    }
  };

  // Called as a function rather than rendered as a component: declared
  // inside this screen, a component is re-created on every render, and
  // React would rebuild everything in it — losing focus and local state.
  const renderVideoCard = ({ video }: { video: LibraryItem }) => (
    <div 
      className="text-left overflow-hidden shadow-lg transition-all duration-300 mx-2"
      style={{ 
        backgroundColor: theme.surface,
        borderRadius: '1rem',
        border: `1px solid ${theme.border}`,
        boxShadow: darkMode ? '0 4px 6px -1px rgba(0, 0, 0, 0.1)' : '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
      }}
    >
      {/* Video Header */}
      <div className="flex items-center gap-3 p-4">
        <Avatar
          user={{ name: video.author, initials: video.authorAvatar, avatarUrl: video.authorAvatarUrl }}
          theme={theme}
          size={40}
        />
        <div className="flex-1">
          <h3 className="font-semibold text-sm" style={{ color: theme.text }}>
            {video.author}
          </h3>
          <div className="flex items-center gap-2 text-xs" style={{ color: theme.text, opacity: 0.6 }}>
            <Clock size={12} />
            <span>{video.timeAgo}</span>
            <span>•</span>
            <Eye size={12} />
            <span>{video.views.toLocaleString()} views</span>
          </div>
        </div>
        {video.isOwn && (
          <div className="relative">
            <button
              className="p-2 rounded-lg hover:bg-opacity-10 hover:bg-white"
              aria-label="Options for your upload"
              aria-expanded={menuFor === video.id}
              onClick={() => { setMenuFor(menuFor === video.id ? null : video.id); setConfirmDelete(false); }}
            >
              <MoreHorizontal size={16} style={{ color: theme.text }} />
            </button>
            {menuFor === video.id && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 z-20 rounded-xl shadow-lg overflow-hidden text-sm"
                style={{ background: theme.surface, border: `1px solid ${theme.border}`, minWidth: '200px' }}
              >
                <button
                  role="menuitem"
                  className="w-full text-left px-4 py-3"
                  style={{ color: theme.error, background: 'transparent' }}
                  onClick={() => deleteItem(video.id)}
                >
                  {confirmDelete ? 'Tap again to delete for good' : 'Delete this upload'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Video Title */}
      <div className="px-4 pb-3">
        <h2 className="font-bold text-lg mb-2" style={{ color: theme.text }}>
          {video.title}
        </h2>
        <p className="text-sm" style={{ color: theme.text, opacity: 0.7 }}>
          {video.description}
        </p>
      </div>

      {/* Video Player */}
      <div className="relative bg-black">
        <div 
          className="aspect-video flex items-center justify-center cursor-pointer relative"
          style={{ backgroundColor: theme.surface }}
          onClick={() => video.mediaUrl && handlePlayPause(video.id)}
        >
          {/* The real player, when there is something to play. Previously
              this was always an emoji and the play button was inert —
              videoRefs was never populated with an element. */}
          {video.mediaUrl ? (
            <video
              ref={(element) => { videoRefs.current[video.id] = element; }}
              src={video.mediaUrl}
              poster={video.thumbnailUrl || undefined}
              className="absolute inset-0 w-full h-full object-contain bg-black"
              playsInline
              onTimeUpdate={(e) => {
                const element = e.currentTarget;
                // Report progress about every 15 seconds rather than 4
                // times a second, which is all the resolution a resume
                // position needs.
                if (Math.floor(element.currentTime) % 15 === 0 && element.currentTime > 0) {
                  recordProgress(video.id, element.currentTime);
                }
              }}
              onEnded={(e) => {
                recordProgress(video.id, e.currentTarget.duration, true);
                setActiveVideo(null);
              }}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              {video.thumbnailUrl ? (
                <img src={video.thumbnailUrl} alt={video.title} className="w-full h-full object-cover" />
              ) : (
                <div className="text-8xl">{video.thumbnail}</div>
              )}
            </div>
          )}
          
          {/* Play/Pause — only offered when there is media behind it. */}
          {video.mediaUrl ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <button 
                className="bg-black bg-opacity-50 rounded-full p-4 hover:bg-opacity-70 transition-all"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePlayPause(video.id);
                }}
              >
                {activeVideo === video.id ? (
                  <Pause size={32} style={{ color: 'white' }} />
                ) : (
                  <Play size={32} style={{ color: 'white' }} />
                )}
              </button>
            </div>
          ) : (
            <div className="absolute bottom-2 left-2 right-2 text-center">
              <span
                className="px-3 py-1 rounded-full text-xs"
                style={{ background: `${theme.background}cc`, color: theme.text, opacity: 0.85 }}
              >
                {video.medium === 'article' ? 'Written piece — open to read' : 'No media uploaded for this item yet'}
              </span>
            </div>
          )}

          {/* Duration */}
          {video.duration && (
            <div className="absolute bottom-2 right-2 bg-black bg-opacity-70 px-2 py-1 rounded text-white text-xs">
              {video.duration}
            </div>
          )}

          {/* Volume Control */}
          {video.mediaUrl && (
            <div className="absolute bottom-2 left-2 flex items-center gap-2">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleMute(video.id);
                }}
                className="bg-black bg-opacity-50 rounded p-1 hover:bg-opacity-70"
              >
                {muted ? (
                  <VolumeX size={16} style={{ color: 'white' }} />
                ) : (
                  <Volume2 size={16} style={{ color: 'white' }} />
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Video Tags */}
      <div className="px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {video.tags.map((tag: string, index: number) => (
            <span 
              key={index}
              className="px-2 py-1 rounded-full text-xs"
              style={{ 
                backgroundColor: theme.secondary,
                color: 'white'
              }}
            >
              #{tag}
            </span>
          ))}
        </div>
      </div>

      {/* Video Actions */}
      <div className="flex items-center justify-between p-2 border-t" style={{ borderColor: theme.border }}>
        <div className="flex items-center gap-6">
          <button 
            onClick={() => handleLike(video.id)}
            className="flex items-center gap-2 hover:bg-opacity-10 hover:bg-red-500 rounded-lg p-2 transition-colors"
          >
            <Heart
              size={18}
              fill={video.liked ? '#ef4444' : 'none'}
              style={{ color: video.liked ? '#ef4444' : theme.text }}
            />
            <span className="text-sm" style={{ color: theme.text }}>{video.likes}</span>
          </button>
          
          <button 
            onClick={() => handleComment(video.id)}
            className="flex items-center gap-2 hover:bg-opacity-10 hover:bg-blue-500 rounded-lg p-2 transition-colors"
          >
            <MessageCircle size={18} style={{ color: theme.text }} />
            <span className="text-sm" style={{ color: theme.text }}>{video.commentCount}</span>
          </button>
          
          <button 
            onClick={() => handleShare(video.id)}
            className="flex items-center gap-2 hover:bg-opacity-10 hover:bg-green-500 rounded-lg p-2 transition-colors"
          >
            <Share size={18} style={{ color: theme.text }} />
            <span className="text-sm" style={{ color: theme.text }}>{video.shares}</span>
          </button>
        </div>
        
        <button
          onClick={() => handleSave(video.id)}
          className="p-2 rounded-lg hover:bg-opacity-10 hover:bg-yellow-500 transition-colors"
        >
          <Bookmark
            size={18}
            fill={video.saved ? '#eab308' : 'none'}
            style={{ color: video.saved ? '#eab308' : theme.text }}
          />
        </button>
      </div>

      {/* Comments Section */}
      {showComments === video.id && (
        <div className="border-t" style={{ borderColor: theme.border }}>
          <div className="p-4">
            <div className="flex gap-3 mb-4">
              <div className="text-xl">👤</div>
              <div 
                className="flex-1 flex gap-2 p-2 rounded-lg border"
                style={{ 
                  backgroundColor: theme.surface,
                  borderColor: theme.border
                }}
              >
                <input
                  type="text"
                  placeholder="Share your thoughts on this journey..."
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="flex-1 bg-transparent outline-none text-sm"
                  style={{ color: theme.text }}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleSendComment(video.id);
                    }
                  }}
                />
                <button 
                  onClick={() => handleSendComment(video.id)}
                  className="p-1 rounded"
                  style={{ color: theme.secondary }}
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
            
            {/* Real comments, or an honest empty line. */}
            <div className="space-y-3">
              {(commentsByVideo[video.id] || []).length === 0 && (
                <p className="text-sm" style={{ color: theme.text, opacity: 0.6 }}>
                  No comments yet.
                </p>
              )}
              {(commentsByVideo[video.id] || []).map((row) => (
                <div key={row.id} className="flex gap-3">
                  <Avatar
                    user={{ name: row.author, initials: row.avatar, avatarUrl: row.avatarUrl }}
                    theme={theme}
                    size={32}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm" style={{ color: theme.text }}>{row.author}</span>
                      <span className="text-xs" style={{ color: theme.text, opacity: 0.6 }}>{row.timestamp}</span>
                    </div>
                    {editingCommentId === row.id ? (
                      <InlineEditor
                        value={row.content}
                        theme={theme}
                        onSave={(text) => saveCommentEdit(video.id, row.id, text)}
                        onCancel={() => setEditingCommentId(null)}
                        placeholder="Edit your comment…"
                      />
                    ) : (
                      <>
                        <p className="text-sm" style={{ color: theme.text, opacity: 0.8 }}>
                          {row.content} <EditedMark editedAt={row.editedAt} theme={theme} />
                        </p>
                        {row.isOwn && (
                          <button
                            onClick={() => setEditingCommentId(row.id)}
                            className="text-xs mt-1"
                            style={{ background: 'none', border: 'none', padding: 0,
                                     color: theme.text, opacity: 0.6, cursor: 'pointer' }}
                          >
                            Edit
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <PullToRefresh theme={theme} onRefresh={load}>
    <div 
      className="min-h-screen"
      style={{ background: theme.background }}
    >
      {/* Header */}
      <div 
        className="backdrop-blur-sm w-full"
        style={{ 
          borderColor: theme.border 
        }}
      >
        <div className="max-w-[900px] mx-auto my-[0.5rem]">
          <div className="px-2 pb-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search the library..."
              className="w-full px-3 py-2 rounded-lg outline-none text-sm"
              style={{
                backgroundColor: theme.surface,
                border: `1px solid ${theme.border}`,
                color: theme.text,
              }}
            />
          </div>

          {/* Categories */}
          <div className="flex gap-1 px-2 overflow-x-auto" style={{scrollbarColor: 'none', scrollbarWidth: 'none'}}>
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`flex items-center gap-2 !px-3 whitespace-nowrap transition-all border-0 !outline-0 ring-0`}
                style={{
                  backgroundColor: selectedCategory === category.id ? theme.accent : theme.surface,
                  color: theme.text,
                }}
              >
                <span>{category.icon}</span>
                <span className="text-sm font-medium">{category.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Video Feed */}
      <div className="max-w-4xl mx-auto space-y-2">
        {filteredVideos.length > 0 ? (
          filteredVideos.map((video) => (
            <Fragment key={video.id}>{renderVideoCard({ video })}</Fragment>
          ))
        ) : (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">🎬</div>
            <h3 className="text-xl font-semibold mb-2" style={{ color: theme.text }}>
              {loading ? 'Loading the library…' : 'Nothing here yet'}
            </h3>
            <p style={{ color: theme.text, opacity: 0.7 }}>
              {loading
                ? ' '
                : error
                  ? error
                  : searchQuery || selectedCategory !== 'all'
                    ? 'Try adjusting your search or category filters'
                    : 'The library is empty. Anything shared here will show up on this page.'}
            </p>
          </div>
        )}
      </div>
    </div>
    </PullToRefresh>
  );
};

export default VideoInterface;