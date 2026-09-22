/**
 * Profile onboarding — spec §15's "Complete profile or Skip for now".
 *
 * This component was found fully built and never reachable: nothing in
 * the app imported it, and its submit handler validated the form, logged
 * the result to the console, showed an alert telling the user to "check
 * the console for your complete profile data", and reset the fields.
 *
 * It is now wired into the app (Dashboard routes to it for a user whose
 * profile isn't complete) and saves to the real profile API. The form
 * pre-fills from whatever is already on the account, so it works as an
 * edit screen as well as a first-run one.
 *
 * It keeps its own theme fallback so it still renders standalone, but
 * takes `theme` from the app when given one.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { User, MapPin, Target, Heart, Save, Eye, Upload, Award } from 'lucide-react';
import { ApiError, api, get } from './api';
import { buildTheme } from './theme';
import type { Theme } from './theme';
import type { JournalStats, MyProfile } from './types';

interface ProfileFormProps {
  theme?: Partial<Theme>;
  darkMode?: boolean;
  /** Called once the profile has been saved. */
  onDone?: () => void;
  /** Shown as "Skip for now" when provided. */
  onSkip?: () => void;
  /**
   * 'edit' when opened from Edit Profile: the way out is "Cancel", not
   * the first-run "Skip for now".
   */
  mode?: 'onboarding' | 'edit';
}

/**
 * The form's own state, which is not the profile's shape: every field is
 * a string because it is bound to an input, and the two stat fields are
 * display-only strings read back from `/journal/stats/`.
 */
interface ProfileFormData {
  name: string;
  email: string;
  phone: string;
  title: string;
  location: string;
  about: string;
  currentFocus: string;
  growthAreas: string;
  values: string;
  totalEntries: string;
  streakDays: string;
  coverPhoto: string | null;
  profilePhoto: string | null;
  favoriteTopics: string[];
}

interface FormCardProps {
  children: React.ReactNode;
  title: string;
  /** A lucide icon element; cloned below to take the card's accent colour. */
  icon: React.ReactElement<{ className?: string; style?: React.CSSProperties }>;
}

interface InputProps {
  label: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  type?: string;
  placeholder?: string;
  rows?: number;
  required?: boolean;
}

type ButtonVariant = 'primary' | 'secondary' | 'outline';

interface ButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
}

/*
 * These three live at module scope on purpose.
 *
 * They used to be declared inside SoulLogProfileForm. A component declared
 * inside another component is a brand-new component on every render, so
 * React threw away each <input> and built a fresh one after every
 * keystroke — which is why typing one letter dropped the cursor out of
 * the field and you had to click back in for the next. Declared out
 * here they keep their identity, and the input keeps focus.
 */
const FormCard = ({ children, title, icon, theme }: FormCardProps & { theme: Theme }) => (
  <div 
    className="rounded-lg shadow border p-4 mb-4"
    style={{ 
      backgroundColor: theme.cardBg, 
      borderColor: theme.border,
      color: theme.text
    }}
  >
    <div className="flex items-center gap-2 mb-4">
      {React.cloneElement(icon, { className: "w-5 h-5", style: { color: theme.accent } })}
      <h2 className="text-lg font-semibold">{title}</h2>
    </div>
    {children}
  </div>
);

const Input = ({ label, value, onChange, type = "text", placeholder, rows, required = false, theme }: InputProps & { theme: Theme }) => (
  <div className="mb-3">
    <label className="block text-sm font-medium mb-1 opacity-90">
      {label} {required && <span style={{ color: '#ff4757' }}>*</span>}
    </label>
    {type === 'textarea' ? (
      <textarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows || 3}
        required={required}
        className="w-full p-2 rounded border resize-none focus:outline-none focus:ring-1 text-sm"
        style={{ 
          backgroundColor: theme.inputBg,
          borderColor: theme.border,
          color: theme.text
        }}
      />
    ) : (
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        className="w-full p-2 rounded border focus:outline-none focus:ring-1 text-sm"
        style={{ 
          backgroundColor: theme.inputBg,
          borderColor: theme.border,
          color: theme.text
        }}
      />
    )}
  </div>
);

const Button = ({ children, variant = "primary", onClick, className = "", type = "button", theme }: ButtonProps & { theme: Theme }) => {
  const variants: Record<ButtonVariant, React.CSSProperties> = {
    primary: { backgroundColor: theme.accent, color: '#FFFFFF' },
    secondary: { backgroundColor: theme.secondary, color: '#FFFFFF' },
    outline: { backgroundColor: 'transparent', color: theme.accent, border: `1px solid ${theme.accent}` }
  };
  
  return (
    <button 
      type={type}
      className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 hover:shadow-lg hover:scale-105 ${className}`}
      style={variants[variant]}
      onClick={onClick}
    >
      {children}
    </button>
  );
};

const SoulLogProfileForm = ({ theme: themeProp, darkMode: darkModeProp, onDone, onSkip, mode = 'onboarding' }: ProfileFormProps) => {
  const [darkMode] = useState(darkModeProp ?? true);
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [formData, setFormData] = useState<ProfileFormData>({
    // Essential Profile Info
    name: '',
    email: '',
    phone: '',
    title: '',
    location: '',
    about: '',
    
    // Journey Focus Areas
    currentFocus: '',
    growthAreas: '',
    values: '',
    
    // Basic Stats (will start at 0 for new users)
    totalEntries: '0',
    streakDays: '0',
    
    // Profile Settings
    coverPhoto: null,
    profilePhoto: null,
    
    // Favorite Topics (for initial setup)
    favoriteTopics: []
  });

  /**
   * Pre-fill from the account that already exists.
   *
   * Registration collects a name and an email, and a returning user may
   * have filled some of this in already — showing them an empty form and
   * asking again would be the app forgetting what it knows.
   */
  const load = useCallback(async () => {
    try {
      const profile = await get<MyProfile>('/profile/');
      // Partial: the catch below stands in an empty object for a stats
      // call that failed, so neither field is guaranteed.
      const stats = await get<Partial<JournalStats>>('/journal/stats/').catch(
        (): Partial<JournalStats> => ({}),
      );

      setTopicsText((profile.interests || []).join(', '));
      setFormData((current) => ({
        ...current,
        name: profile.name || '',
        email: profile.email || '',
        phone: profile.phone || '',
        title: profile.tagline || '',
        location: profile.location || '',
        about: profile.bio || '',
        currentFocus: profile.current_focus || '',
        growthAreas: profile.growth_areas || '',
        values: profile.values || '',
        favoriteTopics: profile.interests || [],
        profilePhoto: profile.avatar_url || null,
        coverPhoto: profile.coverUrl || null,
        totalEntries: String(stats.total_entries ?? 0),
        streakDays: String(stats.current_streak_days ?? 0),
      }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your profile.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The app passes a theme in; the fallback keeps this component
  // renderable on its own, which is how it was originally written.
  const theme: Theme = { ...buildTheme(darkMode), ...(themeProp ?? {}) };

  // Generic over the field so the value has to match that field's type,
  // rather than every field accepting anything.
  const handleInputChange = <K extends keyof ProfileFormData>(field: K, value: ProfileFormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  /**
   * The interests box holds exactly what was typed.
   *
   * It used to be bound to `favoriteTopics.join(', ')` and to re-split
   * the text into tags on every keystroke. That trimmed and dropped
   * empties as you typed, so a trailing comma or space vanished the
   * moment it was entered — you could not type "self care" or start a
   * second interest. The raw text is kept as typed now, and turned into
   * tags as it changes without being written back into the box.
   */
  const [topicsText, setTopicsText] = useState('');
  const handleTagsChange = (value: string) => {
    setTopicsText(value);
    const tags = value.split(',').map((tag: string) => tag.trim()).filter((tag: string) => tag);
    setFormData((prev) => ({ ...prev, favoriteTopics: tags }));
  };

  const handlePhotoUpload = (photoType: 'profilePhoto' | 'coverPhoto') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (event: Event) => {
      // The event fires on the input created just above, so its target is
      // that element.
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const form = new FormData();
      form.append(photoType === 'profilePhoto' ? 'profile_image' : 'cover_image', file);

      try {
        // Uploaded immediately rather than carried in form state: an image
        // held as base64 until submit is lost if the form is abandoned,
        // and it was never sent anywhere in the first place.
        const updated = await api<MyProfile>('/profile/', { method: 'PATCH', formData: form });
        setFormData((prev) => ({
          ...prev,
          profilePhoto: updated.avatar_url ?? prev.profilePhoto,
          coverPhoto: updated.coverUrl ?? prev.coverPhoto,
        }));
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'That image did not upload.');
      }
    };
    input.click();
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Inline messages rather than alert(): a browser dialog in the middle
    // of a form is a jarring way to say "you missed a field".
    if (!formData.name.trim()) {
      setError('Please enter your full name.');
      return;
    }
    if (!formData.about.trim()) {
      setError('Please tell us a little about your journey.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await api('/profile/', {
        method: 'PATCH',
        body: {
          name: formData.name.trim(),
          phone: formData.phone.trim(),
          location: formData.location.trim(),
          bio: formData.about.trim(),
          tagline: formData.title.trim(),
          currentFocus: formData.currentFocus.trim(),
          growthAreas: formData.growthAreas.trim(),
          values: formData.values.trim(),
          interests: formData.favoriteTopics,
        },
      });

      setNotice('Your profile is saved.');
      onDone?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };

  const togglePreview = () => {
    setShowPreview(!showPreview);
  };

  if (showPreview) {
    return (
      <div style={{ backgroundColor: theme.background, minHeight: '100vh', color: theme.text, fontFamily: "'Poppins', sans-serif" }}>
        <div className="max-w-6xl mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold">Profile Preview</h1>
            <Button theme={theme} onClick={togglePreview}>
              Back to Form
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-8">
              {/* Hero Section */}
              <div 
                className="rounded-xl shadow-lg border p-6 transition-all duration-300"
                style={{ 
                  backgroundColor: theme.cardBg, 
                  borderColor: theme.border,
                  boxShadow: `0 8px 32px rgba(207, 174, 97, 0.3), 0 0 0 1px ${theme.accent}20`
                }}
              >
                {/* Profile Info */}
                <div className="text-center lg:text-left">
                  <h1 className="text-3xl md:text-4xl font-bold mb-3">
                    {formData.name || 'Your Name'}
                  </h1>
                  
                  <p className="text-xl mb-3 opacity-90 flex items-center justify-center lg:justify-start gap-2">
                    <span className="w-5 h-5" style={{ color: theme.accent }}>✨</span>
                    {formData.title || 'Your Journey Title'}
                  </p>
                  
                  <div className="flex flex-wrap items-center justify-center lg:justify-start gap-6 text-sm opacity-75 mb-6">
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full" style={{ backgroundColor: `${theme.secondary}15` }}>
                      <MapPin className="w-4 h-4" />
                      {formData.location || 'Your Location'}
                    </div>
                    {formData.email && (
                      <div className="flex items-center gap-2 px-3 py-1 rounded-full" style={{ backgroundColor: `${theme.accent}15` }}>
                        <span>📧</span>
                        {formData.email}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* About & Journey Section */}
              <div 
                className="rounded-xl shadow-lg border p-6"
                style={{ 
                  backgroundColor: theme.cardBg, 
                  borderColor: theme.border
                }}
              >
                <div className="flex items-center mb-6">
                  <h2 className="text-2xl font-semibold flex items-center gap-2">
                    <Target className="w-6 h-6" style={{ color: theme.accent }} />
                    My Journey
                  </h2>
                </div>
                
                <div className="relative p-6 rounded-xl mb-6" style={{ backgroundColor: `${theme.accent}10`, border: `1px solid ${theme.accent}20` }}>
                  <p className="leading-relaxed text-lg">
                    {formData.about || 'Tell your story here...'}
                  </p>
                </div>

                {(formData.currentFocus || formData.growthAreas || formData.values) && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="text-center p-3 rounded-lg" style={{ backgroundColor: `${theme.accent}15`, border: `1px solid ${theme.accent}30` }}>
                      <Target className="w-5 h-5 mx-auto mb-2" style={{ color: theme.accent }} />
                      <p className="font-medium text-sm">Current Focus</p>
                      <p className="text-xs opacity-75 mt-1">{formData.currentFocus || 'Not set'}</p>
                    </div>
                    <div className="text-center p-3 rounded-lg" style={{ backgroundColor: `${theme.secondary}15`, border: `1px solid ${theme.secondary}30` }}>
                      <Award className="w-5 h-5 mx-auto mb-2" style={{ color: theme.secondary }} />
                      <p className="font-medium text-sm">Growth Areas</p>
                      <p className="text-xs opacity-75 mt-1">{formData.growthAreas || 'Not set'}</p>
                    </div>
                    <div className="text-center p-3 rounded-lg" style={{ backgroundColor: `${theme.accent}15`, border: `1px solid ${theme.accent}30` }}>
                      <Heart className="w-5 h-5 mx-auto mb-2" style={{ color: theme.accent }} />
                      <p className="font-medium text-sm">Values</p>
                      <p className="text-xs opacity-75 mt-1">{formData.values || 'Not set'}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Getting Started Section */}
              <div 
                className="rounded-xl shadow-lg border p-6"
                style={{ 
                  backgroundColor: theme.cardBg, 
                  borderColor: theme.border
                }}
              >
                <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2">
                  <span style={{ color: theme.secondary }}>🌱</span>
                  Getting Started
                </h2>
                <div className="text-center py-8">
                  <div className="text-6xl mb-4">🎉</div>
                  <h3 className="text-xl font-semibold mb-2">Welcome to SoulLog!</h3>
                  <p className="opacity-75">Your reflections and milestones will appear here as you begin your journey.</p>
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Contact Info */}
              <div 
                className="rounded-xl shadow-lg border p-6"
                style={{ 
                  backgroundColor: theme.cardBg, 
                  borderColor: theme.border
                }}
              >
                <h3 className="font-semibold mb-4 text-lg flex items-center gap-2">
                  <User className="w-5 h-5" style={{ color: theme.accent }} />
                  Contact Info
                </h3>
                <div className="space-y-3">
                  {formData.email && (
                    <div className="flex items-center gap-3 p-2 rounded" style={{ backgroundColor: `${theme.accent}08` }}>
                      <span>📧</span>
                      <span className="text-sm">{formData.email}</span>
                    </div>
                  )}
                  {formData.phone && (
                    <div className="flex items-center gap-3 p-2 rounded" style={{ backgroundColor: `${theme.secondary}08` }}>
                      <span>📞</span>
                      <span className="text-sm">{formData.phone}</span>
                    </div>
                  )}
                  {formData.location && (
                    <div className="flex items-center gap-3 p-2 rounded" style={{ backgroundColor: `${theme.accent}08` }}>
                      <MapPin className="w-4 h-4" />
                      <span className="text-sm">{formData.location}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Favorite Topics */}
              {formData.favoriteTopics.length > 0 && (
                <div 
                  className="rounded-xl shadow-lg border p-6"
                  style={{ 
                    backgroundColor: theme.cardBg, 
                    borderColor: theme.border
                  }}
                >
                  <h3 className="font-semibold mb-4 text-lg flex items-center gap-2">
                    <Heart className="w-5 h-5" style={{ color: theme.accent }} />
                    Favorite Topics
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {formData.favoriteTopics.map((topic: string) => (
                      <span 
                        key={topic}
                        className="px-3 py-2 rounded-full text-sm font-medium"
                        style={{ 
                          backgroundColor: `${theme.secondary}20`, 
                          color: theme.secondary,
                          border: `1px solid ${theme.secondary}30`
                        }}
                      >
                        #{topic}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Welcome Message */}
              <div 
                className="rounded-xl shadow-lg border p-6"
                style={{ 
                  backgroundColor: theme.cardBg, 
                  borderColor: theme.border
                }}
              >
                <h3 className="font-semibold mb-4 text-lg flex items-center gap-2">
                  <span style={{ color: theme.secondary }}>🌟</span>
                  Welcome!
                </h3>
                <div className="text-center">
                  <p className="text-sm opacity-75 mb-3">
                    Ready to start your mindful journey? Your first reflection is just a click away!
                  </p>
                  <div 
                    className="inline-block px-4 py-2 rounded-full text-sm font-medium"
                    style={{ backgroundColor: `${theme.accent}15`, color: theme.accent }}
                  >
                    🚀 Begin Your Journey
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: theme.background, minHeight: '100vh', color: theme.text, fontFamily: "'Poppins', sans-serif" }}>
      <div className="max-w-2xl mx-auto p-4">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold mb-2">Create Your SoulLog Profile</h1>
          <p className="text-base opacity-75">Tell us about yourself and your journey</p>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Basic Profile Information */}
          <FormCard theme={theme} title="Basic Information" icon={<User />}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                theme={theme}
                label="Full Name"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                placeholder="Enter your full name"
                required
              />
              {/* Your sign-in email, shown but not editable here. This box
                  used to accept edits and silently drop them: changing the
                  address an account signs in with needs a confirmation
                  step, which SoulLog doesn't have yet. */}
              <div className="mb-3">
                <label className="block text-sm font-medium mb-1 opacity-90">Email Address</label>
                <input
                  type="email"
                  value={formData.email}
                  readOnly
                  aria-readonly="true"
                  className="w-full p-2 rounded border text-sm"
                  style={{ backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text, opacity: 0.7 }}
                />
                <p className="text-xs mt-1 opacity-60">This is the email you sign in with. It can't be changed here.</p>
              </div>
              <Input
                theme={theme}
                label="Phone Number"
                type="tel"
                value={formData.phone}
                onChange={(e) => handleInputChange('phone', e.target.value)}
                placeholder="+1 (555) 123-4567"
              />
              <Input
                theme={theme}
                label="Title/Tagline"
                value={formData.title}
                onChange={(e) => handleInputChange('title', e.target.value)}
                placeholder="e.g., Mindful Explorer & Growth Seeker"
              />
            </div>
            
            <Input
              theme={theme}
              label="Location"
              value={formData.location}
              onChange={(e) => handleInputChange('location', e.target.value)}
              placeholder="City, State/Country"
            />
            
            <Input
              theme={theme}
              label="About Your Journey"
              type="textarea"
              rows={3}
              value={formData.about}
              onChange={(e) => handleInputChange('about', e.target.value)}
              placeholder="Share your story, what brings you to SoulLog, and what you hope to achieve..."
              required
            />
          </FormCard>

          {/* Journey Focus */}
          <FormCard theme={theme} title="Your Journey Focus" icon={<Target />}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                theme={theme}
                label="Current Focus"
                value={formData.currentFocus}
                onChange={(e) => handleInputChange('currentFocus', e.target.value)}
                placeholder="e.g., Mindfulness & Creativity"
              />
              <Input
                theme={theme}
                label="Growth Areas"
                value={formData.growthAreas}
                onChange={(e) => handleInputChange('growthAreas', e.target.value)}
                placeholder="e.g., Emotional Intelligence"
              />
              <Input
                theme={theme}
                label="Core Values"
                value={formData.values}
                onChange={(e) => handleInputChange('values', e.target.value)}
                placeholder="e.g., Authenticity & Connection"
              />
            </div>
          </FormCard>



          {/* Photos — the handler existed in this component from the
              start but nothing rendered a control for it, so there was no
              way to reach it. */}
          <FormCard theme={theme} title="Photos" icon={<Upload />}>
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex items-center gap-3">
                <div
                  className="rounded-full overflow-hidden flex items-center justify-center"
                  style={{
                    width: '3.5rem',
                    height: '3.5rem',
                    backgroundColor: theme.accent,
                    color: theme.background,
                    fontWeight: 600,
                  }}
                >
                  {formData.profilePhoto ? (
                    <img src={formData.profilePhoto} alt="Your avatar" className="w-full h-full object-cover" />
                  ) : (
                    (formData.name || '?').slice(0, 1).toUpperCase()
                  )}
                </div>
                <Button theme={theme} variant="outline" type="button" onClick={() => handlePhotoUpload('profilePhoto')}>
                  {formData.profilePhoto ? 'Change photo' : 'Add a photo'}
                </Button>
              </div>

              <div className="flex items-center gap-3">
                <div
                  className="rounded overflow-hidden"
                  style={{
                    width: '6rem',
                    height: '3.5rem',
                    backgroundColor: theme.inputBg,
                    border: `1px solid ${theme.border}`,
                  }}
                >
                  {formData.coverPhoto && (
                    <img src={formData.coverPhoto} alt="Your cover" className="w-full h-full object-cover" />
                  )}
                </div>
                <Button theme={theme} variant="outline" type="button" onClick={() => handlePhotoUpload('coverPhoto')}>
                  {formData.coverPhoto ? 'Change cover' : 'Add a cover'}
                </Button>
              </div>
            </div>
            <p className="text-sm opacity-60 mt-2">
              Photos upload as soon as you choose them.
            </p>
          </FormCard>

          {/* Interests */}
          <FormCard theme={theme} title="Interests & Topics" icon={<Heart />}>
            <Input
              theme={theme}
              label="Favorite Topics"
              value={topicsText}
              onChange={(e) => handleTagsChange(e.target.value)}
              placeholder="mindfulness, creativity, relationships, growth, gratitude, nature"
            />
            <p className="text-sm opacity-60 mt-1">Separate topics with commas</p>
          </FormCard>

          {(error || notice || loading) && (
            <div
              className="rounded-lg px-3 py-2 mb-3 text-sm"
              style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.border}`, color: theme.text }}
            >
              {error || notice || 'Loading your details…'}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
            <Button theme={theme} variant="outline" onClick={togglePreview} type="button">
              <Eye className="w-4 h-4 mr-2" />
              Preview Profile
            </Button>
            <Button theme={theme} type="submit" className="px-6 py-2">
              <Save className="w-4 h-4 mr-2" />
              {saving ? 'Saving…' : 'Save Profile'}
            </Button>
            {onSkip && (
              <Button theme={theme} variant="outline" type="button" onClick={onSkip}>
                {mode === 'edit' ? 'Cancel' : 'Skip for now'}
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default SoulLogProfileForm;