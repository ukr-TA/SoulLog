import { useEffect, useState } from "react";
import { X } from "lucide-react"
import { Preferences } from "@capacitor/preferences";
import type { Theme } from "./theme";

const moods = [
    { label: 'Happy', emoji: '😊', color: '#4CAF50' },
    { label: 'Sad', emoji: '😢', color: '#2196F3' },
    { label: 'Angry', emoji: '😠', color: '#F44336' },
    { label: 'Excited', emoji: '🤩', color: '#FF9800' },
    { label: 'Anxious', emoji: '😰', color: '#9C27B0' },
    { label: 'Calm', emoji: '😌', color: '#009688' },
    { label: 'Frustrated', emoji: '😤', color: '#FF5722' },
    { label: 'Content', emoji: '😊', color: '#8BC34A' },
    { label: 'Lonely', emoji: '😔', color: '#607D8B' },
    { label: 'Grateful', emoji: '🥰', color: '#E91E63' },
    { label: 'Stressed', emoji: '😫', color: '#795548' },
    { label: 'Hopeful', emoji: '🤗', color: '#00BCD4' },
];

/** Mood label -> the reasons offered for it. Keyed by the `label`s above. */
const moodReasons: Record<string, string[]> = {
    'Happy': ['Achievement', 'Success', 'Good news', 'Celebration', 'Love', 'Friendship', 'Surprise', 'Compliment', 'Progress', 'Weather'],
    'Sad': ['Loss', 'Disappointment', 'Rejection', 'Loneliness', 'Bad news', 'Failure', 'Separation', 'Nostalgia', 'Weather', 'Ending'],
    'Angry': ['Injustice', 'Betrayal', 'Frustration', 'Disrespect', 'Delay', 'Conflict', 'Traffic', 'Incompetence', 'Unfairness', 'Interruption'],
    'Excited': ['Event', 'Opportunity', 'Adventure', 'Plans', 'Anticipation', 'Discovery', 'Competition', 'Travel', 'Meeting', 'Surprise'],
    'Anxious': ['Uncertainty', 'Deadline', 'Performance', 'Change', 'Health', 'Finance', 'Event', 'Decision', 'Future', 'Responsibility'],
    'Calm': ['Meditation', 'Nature', 'Rest', 'Completion', 'Peace', 'Solitude', 'Music', 'Reading', 'Breathing', 'Acceptance'],
    'Frustrated': ['Obstacles', 'Issues', 'Miscommunication', 'Slow progress', 'Repetition', 'Bureaucracy', 'Waiting', 'Complexity', 'Inefficiency', 'Interruption'],
    'Content': ['Satisfaction', 'Routine', 'Stability', 'Comfort', 'Balance', 'Gratitude', 'Simple pleasures', 'Home', 'Peaceful moment', 'Enough'],
    'Lonely': ['Isolation', 'Distance', 'Missing someone', 'Social exclusion', 'Being alone', 'Lack of connection', 'Quiet evening', 'Empty space', 'Silence', 'Separation'],
    'Grateful': ['Kindness', 'Support', 'Opportunity', 'Health', 'Family', 'Gift', 'Help received', 'Beautiful moment', 'Abundance', 'Realization'],
    'Stressed': ['Workload', 'Time pressure', 'Multiple tasks', 'Responsibility', 'Financial pressure', 'Health issue', 'Relationship tension', 'Deadline', 'Overcommitment', 'Pressure'],
    'Hopeful': ['Possibility', 'New beginning', 'Recovery', 'Opportunity', 'Growth', 'Change ahead', 'Potential', 'Dreams', 'Progress', 'Tomorrow']
};

const getIntensityLabel = (value: number) => {
    if (value <= 3) return 'Low';
    if (value <= 7) return 'Medium';
    return 'High';
};

  const getIntensityColor = (value: number, mood: string | null) => {
    // For negative emotions: low intensity (green) to high intensity (red)
    const negativeEmotions = ['Sad', 'Angry', 'Anxious', 'Frustrated', 'Lonely', 'Stressed'];
    // For positive emotions: low intensity (red) to high intensity (green)
    const positiveEmotions = ['Happy', 'Excited', 'Calm', 'Content', 'Grateful', 'Hopeful'];
    
    if (!mood) {
      // Default behavior when no mood is selected
      if (value <= 3) return '#4CAF50';
      if (value <= 7) return '#FF9800';
      return '#F44336';
    }
    
    if (negativeEmotions.includes(mood)) {
      // For negative emotions: lower intensity is better (green), higher is worse (red)
      if (value <= 3) return '#4CAF50'; // Low intensity = good (green)
      if (value <= 7) return '#FF9800'; // Medium intensity = caution (orange)
      return '#F44336'; // High intensity = concerning (red)
    } else if (positiveEmotions.includes(mood)) {
      // For positive emotions: higher intensity is better (green), lower is less good (red)
      if (value <= 3) return '#F44336'; // Low intensity = less positive (red)
      if (value <= 7) return '#FF9800'; // Medium intensity = moderate (orange)
      return '#4CAF50'; // High intensity = very positive (green)
    }
    
    // Fallback to default
    if (value <= 3) return '#4CAF50';
    if (value <= 7) return '#FF9800';
    return '#F44336';
};

type Props = {
  theme: Theme;
  setHideExtra: (v: boolean) => void;
  setActiveTab: (tab: string) => void;
  backPage: string;
};

const MoodCheckin = ({ theme, setHideExtra, setActiveTab, backPage }: Props) => {
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [selectedReason, setSelectedReason] = useState('');
  const [intensity, setIntensity] = useState(5);
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showCircleTeaser, setShowCircleTeaser] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);

    if (!selectedMood) {
      return;
    }

    const { value: access_token } = await Preferences.get({ key: 'access_token' });

    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/mood/`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${access_token}`
      },
      body: JSON.stringify({
        mood: selectedMood,
        reason: selectedReason,
        intensity,
        description,
      })
    });

    console.log(await response.json())
    setDescription("");
    setSelectedMood(null);
    setSelectedReason('');
    setShowCircleTeaser(false);
    setIsSaving(false);
    setIntensity(5);
  };

  useEffect(() => {
    setHideExtra(true)

    // Reveal Soul Circle teaser when a mood is selected
    if (selectedMood) {
      setShowCircleTeaser(true);
    }

    return () => setHideExtra(false);
    // Runs once, on mount. `setHideExtra` is a setter owned by the
    // parent and stable in practice; listing it would re-run this
    // effect on every parent render, which is not what it is for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMood]);

  return (
    <div
      className="main-content text-sm"
      style={{
        fontFamily: "'Merriweather', Tahoma, Geneva, Verdana, sans-serif",
        background: theme.background,
        color: theme.text,
        minHeight: "100vh",
      }}
    >
      <div className="header p-4 flex items-center !justify-between">
        <h3 className="text-left text-lg font-medium">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </h3>
        <X onClick={() => setActiveTab(backPage)} size={30} className="opacity-50 w-6 h-6 cursor-pointer" />
      </div>

      <style>
        {`
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
          }
        `}
      </style>

      <div className="p-3 pb-0 text-left space-y-5" style={{ maxWidth: "800px", margin: "0 auto" }}>

        {/* Greeting */}
        <div className="text-center space-y-2">
          <h3 className="text-xl" style={{ color: theme.accent }}>
            👋 Welcome back, Alex
          </h3>
          <p className="text-xs" style={{ color: theme.secondary }}>
            🔥 Keep your streak alive — a quick check-in counts!
          </p>
        </div>

        {/* Soul Circle teaser (gated by mood) */}
        <div
          className="text-left mt-6 p-4 space-y-2 rounded-xl"
          style={{
            background: theme.secondary + 20,
            pointerEvents: showCircleTeaser ? "auto" : "none",
            opacity: showCircleTeaser ? 1 : 0.6,
          }}
        >
          <p className="font-bold text-md" style={{ color: theme.text }}>
            {showCircleTeaser ? "Join today’s Soul Circle" : "Log your mood to unlock Soul Circles"}
          </p>
          <p className="text-sm" style={{ color: theme.secondary }}>
            {showCircleTeaser
              ? `Others feeling “${selectedMood}” are chatting for the next 2 hours.`
              : "Match with 5–10 people who feel like you do today."}
          </p>
          <button
            onClick={() => setActiveTab(showCircleTeaser ? "SoulCircles" : "Dashboard")}
            className="border-0 !rounded-4xl font-normal cursor-pointer min-w-[100px]"
            style={{
              background: `linear-gradient(45deg, ${theme.secondary}, ${theme.accent})`,
              color: theme.background,
            }}
          >
            {showCircleTeaser ? "Join" : "Learn more"}
          </button>
        </div>

        {/* Mood first */}
        <div className="p-4 rounded-xl space-y-8" style={{backgroundColor: theme.surface, border: `1px solid ${theme.border}`}}>
            <div className="space-y-3">
                <h3 className="text-md" style={{ color: theme.text }}>
                    How are you feeling right now?
                </h3>
                <div className="flex gap-2 flex-wrap">
                    {moods.map((m) => {
                    const active = selectedMood === m.label;
                    return (
                        <button
                        key={m.label}
                        onClick={() => setSelectedMood(m.label)}
                        className="flex items-center justify-center gap-2 min-w-[110px] cursor-pointer px-3 py-1 !rounded-4xl"
                        style={{
                            border: `1px solid ${active ? m.color : theme.border}`,
                            transition: "all .2s ease",
                            color: theme.text,
                            backgroundColor: active ? m.color : theme.secondary + "22"
                        }}
                        >
                        <span className="!text-md">{m.emoji}</span>
                        <span className="!text-xs">{m.label}</span>
                        </button>
                    );
                    })}
                </div>
            </div>

            {/* Reason Selection */}
            {selectedMood && (
            <div className="rounded-xl space-y-3">
                <p className="font-xs mt-3">What's the reason for feeling {selectedMood.toLowerCase()}?</p>
                <div className="flex flex-wrap gap-2">
                    {moodReasons[selectedMood]?.map((reason) => (
                        <button
                        key={reason}
                        onClick={() => setSelectedReason(reason)}
                        className="px-2 py-1 !rounded-4xl cursor-pointer !text-xs"
                        style={{
                            backgroundColor: selectedReason === reason ? theme.secondary : theme.secondary + "22",
                            border: `1px solid ${selectedReason === reason ? theme.secondary : theme.border}`,
                            transition: 'all 0.3s ease',
                            color: selectedReason === reason ? 'white' : theme.text,
                        }}
                        >
                        {reason}
                        </button>
                    ))}
                </div>
            </div>
            )}

            {/* Intensity Slider */}
            <div className="space-y-2">
                <div className="flex justify-between items-center">
                    <p className="font-xs">Intensity Level?</p>
                    <div className="flex items-center gap-2">
                        <span className="text-lg font-bold" style={{
                            color: getIntensityColor(intensity, selectedMood)
                        }}>
                            {intensity}
                        </span>
                        <span className="rounded-xl px-3 py-1 text-xs" style={{
                            backgroundColor: getIntensityColor(intensity, selectedMood),
                            color: 'white',
                            fontWeight: '600'
                        }}>
                            {getIntensityLabel(intensity)}
                        </span>
                    </div>
                </div>

                <div style={{ position: 'relative' }}>
                    <input
                        type="range"
                        min="1"
                        max="10"
                        value={intensity}
                        onChange={(e) => setIntensity(parseInt(e.target.value))}
                        className="!border-none !outline-none !ring-none !rounded-full h-[8px] w-full cursor-pointer"
                        style={{
                            background: `linear-gradient(to right, #4CAF50 0%, #4CAF50 30%, #FF9800 30%, #FF9800 70%, #F44336 70%, #F44336 100%)`,
                        }}
                    />
                    <div className="flex justify-between text-xs opacity-70" style={{
                        color: theme.text,
                    }}>
                        <span>1 - Low</span>
                        <span>5 - Medium</span>
                        <span>10 - High</span>
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <p className="font-xs mt-3">Add a quick note? (optional)</p>
                <textarea
                    className="w-full rounded-lg outline-none ring-none p-3 text-md"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="A quick note about your mood..."
                    style={{
                    background: theme.surface,
                    border: `1px solid ${theme.border}`,
                    color: theme.text,
                    resize: "vertical",
                    }}
                />
            </div>

            <button
              onClick={handleSave}
              disabled={isSaving}
              className="text-sm w-full font-normal !rounded-4xl border-none outline-none px-4 py-3 cursor-pointer min-w-[100px]"
              style={{
                background: `linear-gradient(45deg, ${theme.accent}, ${theme.secondary})`,
                color: theme.background,
                opacity: isSaving ? 0.7 : 1,
              }}
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
        </div>

        {/* Summary */}
        {selectedMood && (
          <div className="p-4 mb-2 rounded-xl space-y-1 text-xs" style={{
            background: theme.secondary + 20,
            border: `1px solid ${theme.border}`,
            lineHeight: '1.6',
            color: theme.secondary
          }}>
            <p className="text-sm" style={{
              marginBottom: '10px',
              color: theme.text,
            }}>
              Mood check-in
            </p>
            <p>{moods.find(m => m.label === selectedMood)?.emoji} {selectedMood}</p>
            <p>{intensity}/10 ({getIntensityLabel(intensity)})</p>
            {selectedReason && <p>{selectedReason}</p>}
            {description && <p>{description}</p>}
          </div>
        )}
      </div>
    </div>
  );
};

export default MoodCheckin;
