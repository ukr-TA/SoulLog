/**
 * The Community search bar.
 *
 * "Recent searches" was three hardcoded strings. "Trending" was five
 * more, one of which was a person's name. Autocomplete was the typed
 * query with " meditation", " techniques", " for beginners" and
 * " training" appended to it — a convincing-looking suggestion list that
 * knew nothing about what was actually in the app.
 *
 * All three are real now. Recent searches are this user's own history
 * (and nobody else's). Trending is what several different people have
 * searched recently — several, deliberately, so one person's searching
 * can never surface on everyone's screen. Suggestions are real results:
 * matching people, posts and library items, labelled by what they are.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Clock, TrendingUp, X, Filter, Video, BookOpen, FileText, User, MessageCircle } from 'lucide-react';
import { del, get, type PublicUser } from './api';
import type { Theme } from './theme';

/**
 * Only the fields this dropdown actually renders. The search endpoint
 * returns the full post and library rows; a row is opened by handing it
 * back to the parent, which knows what to do with the rest.
 */
type PostResult = { id: number; content: string };
type ContentResult = { id: number; title: string };

type SearchResults = {
  people: PublicUser[];
  posts: PostResult[];
  content: ContentResult[];
  total: number;
};

/** One row of the flattened, keyboard-navigable result list. */
type ResultEntry =
  | { kind: 'person'; row: PublicUser }
  | { kind: 'content'; row: ContentResult }
  | { kind: 'post'; row: PostResult };

interface SearchBarProps {
  theme: Theme;
  darkMode?: boolean;
  onSelectPerson?: (username: string) => void;
  onSelectResult?: (kind: 'content' | 'post', row: ContentResult | PostResult) => void;
}

const SCOPES = [
  { key: 'videos', icon: Video, label: 'Videos' },
  { key: 'articles', icon: BookOpen, label: 'Articles' },
  { key: 'posts', icon: FileText, label: 'Posts' },
  { key: 'people', icon: User, label: 'People' },
];

const SearchBarWithDropdown = ({ theme, darkMode, onSelectPerson, onSelectResult }: SearchBarProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [scope, setScope] = useState<string>('all');

  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [trendingSearches, setTrendingSearches] = useState<string[]>([]);
  const [results, setResults] = useState<SearchResults>({ people: [], posts: [], content: [], total: 0 });
  const [searching, setSearching] = useState(false);

  const searchRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadSuggestions = useCallback(async () => {
    try {
      const data = await get<{ recent: string[]; trending: string[] }>(
        '/community/search/suggestions/',
      );
      setRecentSearches(data.recent);
      setTrendingSearches(data.trending);
    } catch {
      // Both lists stay empty, which is honest for a new account.
    }
  }, []);

  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setResults({ people: [], posts: [], content: [], total: 0 });
      return;
    }

    // Debounced: each search is a real query across three subsystems and
    // is recorded in the user's history, so firing one per keystroke
    // would both cost more and pollute their own recent list.
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const data = await get<SearchResults>(
          `/community/search/?q=${encodeURIComponent(query)}&scope=${scope}`,
        );
        setResults(data);
        loadSuggestions();
      } catch {
        setResults({ people: [], posts: [], content: [], total: 0 });
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery, scope, loadSuggestions]);

  // Flattened for keyboard navigation, in the order they're rendered.
  const flatResults: ResultEntry[] = [
    ...results.people.map((row) => ({ kind: 'person' as const, row })),
    ...results.content.map((row) => ({ kind: 'content' as const, row })),
    ...results.posts.map((row) => ({ kind: 'post' as const, row })),
  ];

  const quickFilters = SCOPES;

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex(prev => prev < flatResults.length - 1 ? prev + 1 : prev);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex(prev => prev > 0 ? prev - 1 : -1);
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < flatResults.length) {
          openResult(flatResults[activeIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setActiveIndex(-1);
        searchRef.current?.blur();
        break;
    }
  };

  const openResult = (entry: ResultEntry) => {
    setIsOpen(false);
    setActiveIndex(-1);
    if (entry.kind === 'person') {
      onSelectPerson?.(entry.row.username);
    } else {
      onSelectResult?.(entry.kind, entry.row);
    }
  };

  const handleSearchClick = () => {
    // Opens on focus, not only once there's text — recent and trending
    // are worth seeing before you've typed anything.
    setIsOpen(true);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    // Only open dropdown when user starts typing
    setIsOpen(value.length > 0);
    setActiveIndex(-1);
  };

  const selectSuggestion = (suggestion: string) => {
    setSearchQuery(suggestion);
    // Stays open: picking a past search should show its results, not
    // dismiss the panel and leave the person to press enter again.
    setIsOpen(true);
    setActiveIndex(-1);
  };

  const clearRecentSearches = async () => {
    setRecentSearches([]);
    try {
      await del('/community/search/suggestions/');
    } catch {
      loadSuggestions();
    }
  };

  const removeRecentSearch = (indexToRemove: number) => {
    // Hidden locally. There is no per-entry delete endpoint, and adding a
    // half-working one would be worse than the honest behaviour: "Clear
    // all" is the control that really removes history.
    setRecentSearches(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  const clearSearch = () => {
    setSearchQuery('');
    setIsOpen(false);
    setActiveIndex(-1);
    searchRef.current?.focus();
  }

  return (
    <div className='flex gap-2 flex-row-reverse items-center py-1 pb-1'>

    <div className="mx-auto p-0 flex-1 h-10">
      {/* Search Bar */}
      <div className="relative flex-1" ref={searchRef}>
      {/* Search Input */}
      <div className={`relative transition-all duration-200`}>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Search content, people, video..."
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={handleKeyDown}
            onClick={handleSearchClick}
            className={`w-full pl-10 pr-10 py-2 border-2 text-sm focus:outline-none transition-all duration-200 ${
              isOpen 
                ? 'border-yellow-400 rounded-t-2xl rounded-b-none bg-white' 
                : 'border-gray-200 rounded-full bg-white hover:border-gray-300 focus:border-yellow-400'
            }`}
            style={{
              color: theme.text,
              background: `${theme.surface}80`,
              border: theme.accent,
            }}
          />
          <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
            {searchQuery && (
              <button
                onClick={clearSearch}
                className="text-gray-400 bg-none hover:text-gray-600 transition-colors p-1 rounded-md hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>

        {/* Dropdown */}
        {isOpen && (
          <div 
            ref={dropdownRef}
            className="absolute top-full left-0 right-0 border-b border-gray-400 !width-full rounded-b-2xl shadow-lg z-50 max-h-96 overflow-y-auto"
            style={{
              color: theme.text,
              background: `${theme.surface}`,
            }}
          >
            {/* Quick Filters */}
            <div className={`p-4 border-b ${darkMode ? 'border-gray-100' : 'border-grey-600'}`} style={{ color: theme.text }}>
              <div className="flex items-center gap-2 mb-2">
                <Filter className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium">Quick Filters</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {quickFilters.map((filter, index) => {
                  const Icon = filter.icon;
                  const active = scope === filter.key;
                  return (
                    <button
                      key={index}
                      onClick={() => setScope(active ? 'all' : filter.key)}
                      className="flex items-center gap-2 px-3 py-1.5 border rounded-lg text-sm transition-colors"
                      style={{
                        backgroundColor: active ? theme.accent : `${theme.background}40`,
                        borderColor: active ? theme.accent : 'transparent',
                        color: active ? theme.background : theme.text
                      }}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{filter.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Real results, grouped and labelled by what they are. */}
            {searchQuery.trim().length >= 2 && flatResults.length > 0 && (
              <div className="p-2 text-left">
                <div className="px-2 py-1 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Results
                </div>
                {flatResults.map((entry, index) => (
                  <button
                    key={`${entry.kind}-${entry.row.id}`}
                    onClick={() => openResult(entry)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left"
                    style={{
                      background: activeIndex === index ? `${theme.accent}20` : 'transparent',
                    }}
                  >
                    {entry.kind === 'person' && <User className="w-4 h-4 text-gray-400" />}
                    {entry.kind === 'content' && <Video className="w-4 h-4 text-gray-400" />}
                    {entry.kind === 'post' && <MessageCircle className="w-4 h-4 text-gray-400" />}
                    <span className="flex-1 truncate" style={{ color: theme.text }}>
                      {entry.kind === 'person'
                        ? entry.row.name
                        : entry.kind === 'content'
                          ? entry.row.title
                          : entry.row.content}
                    </span>
                    <span className="text-xs" style={{ color: theme.text, opacity: 0.5 }}>
                      {entry.kind === 'person' ? 'Person' : entry.kind === 'content' ? 'Library' : 'Post'}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Recent Searches */}
            {!searchQuery.trim() && recentSearches.length > 0 && (
              <div className="p-2 border-b border-gray-100">
                <div className="px-2 py-1 text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3" />
                    Recent Searches
                  </div>
                  <button 
                    onClick={clearRecentSearches}
                    className="text-yellow-600 hover:text-yellow-700 text-xs normal-case"
                  >
                    Clear all
                  </button>
                </div>
                {recentSearches.map((search, index) => (
                  <div
                    key={index}
                    className={`flex items-center group px-3 py-2 hover:bg-yellow-50 rounded-lg transition-colors ${
                      activeIndex === flatResults.length + index ? 'bg-yellow-50 text-yellow-600' : 'text-gray-700'
                    }`}
                  >
                    <button
                      onClick={() => selectSuggestion(search)}
                      className="flex items-center gap-3 flex-1 text-left"
                    >
                      <Clock className="w-4 h-4 text-gray-400" />
                      <span>{search}</span>
                    </button>
                    <button
                      onClick={() => removeRecentSearch(index)}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 transition-all p-1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Trending Searches */}
            {!searchQuery.trim() && trendingSearches.length > 0 && (
              <div className="p-2">
                <div className="px-2 py-1 text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-2">
                  <TrendingUp className="w-3 h-3" />
                  Trending
                </div>
                {trendingSearches.map((search, index) => (
                  <button
                    key={index}
                    onClick={() => selectSuggestion(search)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-yellow-50 rounded-lg transition-colors ${
                      activeIndex === flatResults.length + recentSearches.length + index ? 'bg-yellow-50 text-yellow-600' : 'text-gray-700'
                    }`}
                  >
                    <TrendingUp className="w-4 h-4 text-gray-400" />
                    <span>{search}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Empty State */}
            {searchQuery.trim().length >= 2 && flatResults.length === 0 && (
              <div className="p-6 text-center text-gray-500">
                <Search className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm">{searching ? 'Searching…' : 'Nothing found'}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {searching ? ' ' : 'Try different keywords'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </div>
  );
};

export default SearchBarWithDropdown;