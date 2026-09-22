import { useMemo, useState } from 'react';
import {
  Search, ChevronDown, Mail, Bug, KeyRound, Download, Shield, Keyboard, LifeBuoy, X,
} from 'lucide-react';
import type { Theme } from './theme';

/**
 * Settings → Help & Support.
 *
 * Every answer here describes what SoulLog actually does today — the
 * same rule as the rest of the app. If a feature changes, its answer
 * changes with it; an FAQ that promises more than the product does is
 * just another fake button.
 */

type SectionLink = 'privacy' | 'notifications' | 'journaling' | 'data' | 'social';

interface Faq {
  q: string;
  a: string;
  /** A Settings section that answers the question by letting you do it. */
  open?: { section: SectionLink; label: string };
}

const FAQ_GROUPS: { title: string; items: Faq[] }[] = [
  {
    title: 'Getting started',
    items: [
      {
        q: 'How do I write my first entry?',
        a: 'Open Journal in the left bar and choose "Write New Entry", or tap the Prompt of the Day on your Dashboard to start with a question already in place. Add a mood if you like, then save.',
      },
      {
        q: 'What is a mood check-in?',
        a: "A quick note of how you feel, without writing an entry. Tap a feeling under \"How are you feeling?\" on the Dashboard and save it, or use \"More moods\" to add how strongly you feel it and why. Check-ins colour your 14-day grid and feed your Insights.",
      },
      {
        q: 'How does my streak work?',
        a: 'Your streak counts the days in a row on which you wrote an entry or checked in. Today doesn\'t need anything yet — the streak only breaks once a whole day passes with nothing logged.',
      },
      {
        q: 'Can I change my daily goal?',
        a: 'Yes. Your Dashboard\'s goal ring and weekly bar use the goals you set in Settings → Journaling.',
        open: { section: 'journaling', label: 'Open Journaling settings' },
      },
    ],
  },
  {
    title: 'Privacy',
    items: [
      {
        q: 'Who can read my journal?',
        a: 'Only you, unless you choose otherwise. New entries are private by default. When you share one you pick who sees it — My Connections or the Community — and you can share it anonymously, and leave out the mood or date.',
      },
      {
        q: 'Who can message me or send connection requests?',
        a: 'You decide: Everyone, Friends only, or No one for messages (Privacy & Security), and the same kind of choice for connection requests (Social Features).',
        open: { section: 'privacy', label: 'Open Privacy & Security' },
      },
      {
        q: 'How do I block someone?',
        a: 'Open their profile and choose Block. You stop seeing each other\'s posts and messages, and any connection between you is removed. You can unblock people later from Settings → Social Features.',
        open: { section: 'social', label: 'See blocked accounts' },
      },
    ],
  },
  {
    title: 'Insights & badges',
    items: [
      {
        q: 'Why don\'t I see any insights yet?',
        a: 'Insights are only shown when your own entries and check-ins actually support them — usually after a handful of each. Until then SoulLog says nothing rather than guessing.',
      },
      {
        q: 'How do I earn badges?',
        a: 'Automatically, by using SoulLog — your first entry, a week-long streak, a number of check-ins and so on. Your profile shows the ones you\'ve earned and the next few within reach.',
      },
    ],
  },
  {
    title: 'Account & data',
    items: [
      {
        q: 'I forgot my password.',
        a: 'Sign out, then choose "Forgot password?" on the sign-in screen. We\'ll email you a link to set a new one. If you still know it, you can change it in Settings → Profile & Account.',
      },
      {
        q: 'Can I download everything I\'ve written?',
        a: 'Yes. Settings → Your Data → Export My Data downloads your entries, check-ins, posts and settings as one file.',
        open: { section: 'data', label: 'Open Your Data' },
      },
      {
        q: 'How do I delete my account?',
        a: 'Settings → Your Data → Delete Account. You\'ll be asked for your password, and everything is removed permanently — export first if you want a copy.',
        open: { section: 'data', label: 'Open Your Data' },
      },
      {
        q: 'I\'m getting too many notifications.',
        a: 'Turn off the kinds you don\'t want, or switch Notifications off entirely, in Settings → Notifications.',
        open: { section: 'notifications', label: 'Open Notifications' },
      },
    ],
  },
];

const SHORTCUTS: [string, string][] = [
  ['V', 'Open your journal'],
  ['T', "Today's goal — start writing"],
  ['P', 'Write about the Prompt of the Day'],
  ['M', 'Mood check-in'],
];

const SUPPORT_EMAIL = 'support@soullog.app';

/** A pre-filled problem report: the details support always has to ask for. */
function reportLink() {
  const body = [
    'What happened:',
    '',
    'What I expected:',
    '',
    'Steps to get there:',
    '1. ',
    '',
    '---',
    `Browser: ${navigator.userAgent}`,
    `Screen: ${window.innerWidth}×${window.innerHeight}`,
    `Time: ${new Date().toString()}`,
  ].join('\n');
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('SoulLog problem report')}&body=${encodeURIComponent(body)}`;
}

const HelpCenter = ({ theme, onOpenSection }: { theme: Theme; onOpenSection: (section: SectionLink) => void }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return FAQ_GROUPS;
    return FAQ_GROUPS
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => `${item.q} ${item.a}`.toLowerCase().includes(needle)),
      }))
      .filter((group) => group.items.length);
  }, [query]);

  const card = { backgroundColor: theme.surface, border: `1px solid ${theme.border}` };

  return (
    <div className="space-y-6">
      {/* Quick actions */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('SoulLog question')}`} className="flex items-start gap-3 p-4 rounded-lg" style={{ ...card, color: theme.text }}>
          <Mail className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: theme.accent }} />
          <span>
            <span className="block font-medium">Contact support</span>
            <span className="block text-sm opacity-60">Questions or ideas — {SUPPORT_EMAIL}</span>
          </span>
        </a>
        <a href={reportLink()} className="flex items-start gap-3 p-4 rounded-lg" style={{ ...card, color: theme.text }}>
          <Bug className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: theme.accent }} />
          <span>
            <span className="block font-medium">Report a problem</span>
            <span className="block text-sm opacity-60">Opens an email with your browser details filled in</span>
          </span>
        </a>
        <button onClick={() => onOpenSection('privacy')} className="flex items-start gap-3 rounded-lg text-left" style={{ ...card, color: theme.text, padding: '1rem' }}>
          <Shield className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: theme.accent }} />
          <span>
            <span className="block font-medium">Privacy controls</span>
            <span className="block text-sm opacity-60">Who can see you and message you</span>
          </span>
        </button>
        <button onClick={() => onOpenSection('data')} className="flex items-start gap-3 rounded-lg text-left" style={{ ...card, color: theme.text, padding: '1rem' }}>
          <Download className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: theme.accent }} />
          <span>
            <span className="block font-medium">Export your data</span>
            <span className="block text-sm opacity-60">Download everything you've written</span>
          </span>
        </button>
      </div>

      {/* Search + FAQ */}
      <div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg mb-4" style={card}>
          <Search className="w-4 h-4 opacity-60" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search help — e.g. password, streak, block"
            aria-label="Search help"
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: theme.text }}
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search" className="opacity-60">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {groups.length === 0 && (
          <p className="text-sm opacity-70">
            Nothing matches "{query}". Try another word, or{' '}
            <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Question: ${query}`)}`} style={{ color: theme.accent }} className="underline">ask us directly</a>.
          </p>
        )}

        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.title}>
              <h4 className="text-xs font-semibold uppercase tracking-wider opacity-60 mb-2">{group.title}</h4>
              <div className="space-y-2">
                {group.items.map((item) => {
                  const isOpen = open === item.q || Boolean(query.trim());
                  return (
                    <div key={item.q} className="rounded-lg" style={card}>
                      <button
                        onClick={() => setOpen(open === item.q ? null : item.q)}
                        aria-expanded={isOpen}
                        className="w-full flex items-center justify-between gap-3 text-left"
                        style={{ color: theme.text, padding: '1rem', background: 'transparent' }}
                      >
                        <span className="font-medium">{item.q}</span>
                        <ChevronDown className="w-4 h-4 flex-shrink-0 transition-transform" style={{ transform: isOpen ? 'rotate(180deg)' : 'none', opacity: 0.6 }} />
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-4 -mt-1 text-sm leading-relaxed" style={{ opacity: 0.85 }}>
                          <p>{item.a}</p>
                          {item.open && (
                            <button
                              onClick={() => onOpenSection(item.open!.section)}
                              className="mt-3 text-sm font-medium underline"
                              style={{ color: theme.accent }}
                            >
                              {item.open.label} →
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Shortcuts */}
      <div className="p-4 rounded-lg" style={card}>
        <div className="flex items-center gap-2 mb-3">
          <Keyboard className="w-5 h-5" style={{ color: theme.accent }} />
          <h4 className="font-medium">Keyboard shortcuts on the Dashboard</h4>
        </div>
        <div className="grid gap-2 text-sm" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {SHORTCUTS.map(([key, what]) => (
            <div key={key} className="flex items-center gap-3">
              <kbd className="min-w-[1.75rem] text-center px-2 py-0.5 rounded border text-xs font-semibold" style={{ borderColor: theme.border, backgroundColor: theme.background }}>{key}</kbd>
              <span className="opacity-80">{what}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Not a crisis service */}
      <div className="p-4 rounded-lg flex items-start gap-3" style={{ backgroundColor: `${theme.secondary}15`, border: `1px solid ${theme.secondary}40` }}>
        <LifeBuoy className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: theme.secondary }} />
        <div className="text-sm leading-relaxed">
          <p className="font-medium mb-1">If you're going through something heavy</p>
          <p className="opacity-85">
            SoulLog is a place to reflect, not a crisis or medical service, and nobody monitors what you write.
            If you're in danger or thinking about harming yourself, please contact your local emergency number
            or a crisis line near you, or reach out to someone you trust.
          </p>
        </div>
      </div>

      <p className="text-xs opacity-50 flex items-center gap-2">
        <KeyRound className="w-3 h-3" />
        We will never ask for your password by email or message.
      </p>
    </div>
  );
};

export default HelpCenter;
