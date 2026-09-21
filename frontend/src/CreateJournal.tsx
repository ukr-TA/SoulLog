import { ArrowLeft } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import type { ChangeEvent, KeyboardEvent, MouseEvent } from 'react';
import { AiOutlineAudio } from "react-icons/ai";
import { TbPhotoSquareRounded } from "react-icons/tb";
import { HiOutlineSave } from "react-icons/hi";
import { MdPreview } from "react-icons/md";
import { GrClearOption } from "react-icons/gr";
import { Preferences } from '@capacitor/preferences';
import { ApiError, upload } from './api';
import type { JournalEntry } from './types';
import type { Theme } from './theme';

/** One writing prompt — the built-in list and the user's own share this shape. */
type Prompt = {
  text: string;
  emoji: string;
  category: string;
};

type Props = {
  theme: Theme;
  isMobile: boolean;
  setHideExtra: (hide: boolean) => void;
  setActiveTab: (tab: string) => void;
};

const CreateJournal = ({ theme, isMobile, setHideExtra, setActiveTab }: Props) => {
  const [journalEntry, setJournalEntry] = useState('');
  const [journalTitle, setJournalTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showTitleEdit, setShowTitleEdit] = useState(false);
  const [customPrompts, setCustomPrompts] = useState<Prompt[]>([]);
  const [newCustomPrompt, setNewCustomPrompt] = useState('');
  const [showCustomPromptInput, setShowCustomPromptInput] = useState(false);
  const [addedPrompts, setAddedPrompts] = useState<Prompt[]>([]);
  const [showPrompts, setShowPrompts] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const prompts: Prompt[] = [
    { text: "What made you smile today?", emoji: "😊", category: "positive" },
    { text: "How are you feeling right now, and why?", emoji: "🤔", category: "reflection" },
    { text: "What's one thing you're grateful for today?", emoji: "🙏", category: "gratitude" },
    { text: "Describe a moment that stood out to you today.", emoji: "✨", category: "memory" },
    { text: "What challenged you today, and how did you handle it?", emoji: "💪", category: "growth" },
    { text: "What's something you're proud of accomplishing recently?", emoji: "🎯", category: "achievement" },
    { text: "Who made a positive impact on your day and how?", emoji: "👥", category: "relationships" },
    { text: "What small victory did you have today?", emoji: "🏆", category: "celebration" },
    { text: "What made you laugh or feel joy today?", emoji: "😄", category: "happiness" },
    { text: "What are you looking forward to this week?", emoji: "🚀", category: "future" },
    { text: "What's weighing on your mind right now?", emoji: "🤯", category: "concern" },
    { text: "What disappointment are you processing today?", emoji: "😔", category: "processing" },
    { text: "What mistake did you make and what did you learn?", emoji: "🎓", category: "learning" },
    { text: "What fear or worry is bothering you lately?", emoji: "😰", category: "anxiety" },
    { text: "How did you take care of yourself today?", emoji: "🌱", category: "selfcare" }
  ];

  // Auto-generate title from content
  useEffect(() => {
    if (!journalTitle && journalEntry.length > 20) {
      const firstLine = journalEntry.split('\n')[0].replace(/📝.*?\n\n/g, '').trim();
      if (firstLine && firstLine.length > 5) {
        const words = firstLine.split(' ').slice(0, 6);
        setJournalTitle(words.join(' ') + (firstLine.split(' ').length > 6 ? '...' : ''));
      }
    }
  }, [journalEntry, journalTitle]);

  // Update time every second for live effect
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setHideExtra(true);
    return () => setHideExtra(false);
  })

  // Count words and characters
  useEffect(() => {
    const words = journalEntry.trim().split(/\s+/).filter(word => word.length > 0);
    setWordCount(words.length);
    setCharCount(journalEntry.length);
  }, [journalEntry]);

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { 
      weekday: isMobile ? 'short' : 'short', 
      month: 'short', 
      day: 'numeric',
      year: isMobile ? '2-digit' : 'numeric'
    });
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const addPromptToEntry = (prompt: Prompt) => {
    const promptText = `\n\n${prompt.emoji} ${prompt.text}\n\n`;
    const newContent = journalEntry + promptText;
    setJournalEntry(newContent);
    setAddedPrompts([...addedPrompts, prompt]);
    
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newContent.length, newContent.length);
      }
    }, 100);
  };

  const addCustomPrompt = () => {
    if (newCustomPrompt.trim() && !customPrompts.some((p) => p.text === newCustomPrompt.trim())) {
      const customPrompt: Prompt = {
        text: newCustomPrompt.trim(),
        emoji: "💭",
        category: "custom"
      };
      setCustomPrompts([...customPrompts, customPrompt]);
      setNewCustomPrompt('');
      setShowCustomPromptInput(false);
    }
  };

  const removeCustomPrompt = (promptToRemove: Prompt) => {
    setCustomPrompts(customPrompts.filter((p) => p.text !== promptToRemove.text));
  };

  const handleCustomPromptKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      addCustomPrompt();
    } else if (e.key === 'Escape') {
      setNewCustomPrompt('');
      setShowCustomPromptInput(false);
    }
  };

  const clearEntry = () => {
    setJournalEntry('');
    setAddedPrompts([]);
    setJournalTitle('');
  };

  /**
   * Voice notes and photo attachments.
   *
   * Both toolbar buttons were dead: they called `alert()` saying the
   * feature was "on the roadmap". The backend had a JournalMedia model
   * that nothing could create a row in.
   *
   * Recording uses MediaRecorder, which every current browser and the
   * Capacitor WebView support. Attachments are held locally until the
   * entry is saved, because an attachment needs an entry to belong to —
   * uploading first would leave orphaned files whenever someone changed
   * their mind and closed the page.
   */
  const [attachments, setAttachments] = useState<
    { file: File; kind: 'image' | 'audio'; previewUrl: string; durationSeconds: number }[]
  >([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  // The handle type differs between the DOM and Node typings of
  // setInterval, so it is taken from the function rather than assumed.
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setSaveError("This browser can't record audio.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `voice-note-${Date.now()}.webm`, { type: 'audio/webm' });
        setAttachments((current) => [
          ...current,
          {
            file,
            kind: 'audio',
            previewUrl: URL.createObjectURL(blob),
            durationSeconds: recordingSeconds,
          },
        ]);
        // Release the microphone. Leaving the track open keeps the
        // browser's recording indicator on, which is alarming and rude.
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(
        () => setRecordingSeconds((seconds) => seconds + 1),
        1000,
      );
      setSaveError('');
    } catch {
      setSaveError('Microphone access was declined.');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
  };

  useEffect(() => () => {
    // Don't leave a recording running if the screen is closed mid-take.
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    mediaRecorderRef.current?.stop();
  }, []);

  const handlePhotoSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setSaveError('Please choose an image.');
      return;
    }
    setAttachments((current) => [
      ...current,
      { file, kind: 'image', previewUrl: URL.createObjectURL(file), durationSeconds: 0 },
    ]);
    setSaveError('');
  };

  const removeAttachment = (index: number) =>
    setAttachments((current) => {
      URL.revokeObjectURL(current[index].previewUrl);
      return current.filter((_, position) => position !== index);
    });

  const saveEntry = async () => {
    if (isRecording) stopRecording();

    // An entry may be a photo or a voice note with no words — that's the
    // whole point of those two buttons.
    if (!journalEntry.trim() && attachments.length === 0) {
      setSaveError('Write something, or add a photo or voice note.');
      return;
    }

    setIsSaving(true);
    setSaveError('');

    const { value: access_token } = await Preferences.get({ key: 'access_token' });

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/journal/`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${access_token}`
        },
        body: JSON.stringify({
          title: journalTitle || `Journal Entry - ${formatDate(currentTime)}`,
          content: journalEntry,
          entry_type: attachments.some((item) => item.kind === 'audio')
            ? 'voice'
            : attachments.some((item) => item.kind === 'image')
              ? 'photo'
              : 'text',
          // prompt_used is a single text field on the backend; addedPrompts
          // can hold several prompts the user pulled in, so we join them
          // rather than dropping all but the first.
          prompt_used: addedPrompts.map((p) => p.text).join(' | '),
        })
      });

      if (response.status === 401) {
        await Preferences.remove({ key: 'access_token' });
        window.location.reload();
        return;
      }

      if (!response.ok) {
        setSaveError('Something went wrong while saving your journal. Please try again.');
        return;
      }

      // Attachments upload after the entry exists, so nothing is stored
      // that isn't attached to something.
      const created = (await response.json()) as JournalEntry;
      for (const attachment of attachments) {
        const form = new FormData();
        form.append('file', attachment.file);
        if (attachment.durationSeconds) {
          form.append('duration_seconds', String(attachment.durationSeconds));
        }
        try {
          await upload(`/journal/${created.id}/media/`, form);
        } catch (uploadError) {
          setSaveError(
            uploadError instanceof ApiError
              ? `Your entry saved, but an attachment didn't: ${uploadError.message}`
              : "Your entry saved, but an attachment didn't upload.",
          );
          setIsSaving(false);
          return;
        }
      }

      attachments.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setAttachments([]);
      clearEntry();
      setActiveTab('Journal');
    } catch (err) {
      setSaveError('Could not reach the server. Check your connection and try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const groupedPrompts = prompts.reduce<Record<string, Prompt[]>>((acc, prompt) => {
    const category = prompt.category;
    if (!acc[category]) acc[category] = [];
    acc[category].push(prompt);
    return acc;
  }, {});

  return (
    <div className='min-h-[100vh] flex flex-col relative' style={{
      background: theme.background,
      color: theme.text,
      fontFamily: '"Merriweather", -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
    }}>
      
      {/* Sticky Header */}
      <div className='sticky top-0 z-100' style={{
        backgroundColor: theme.surface,
        borderBottom: `1px solid ${theme.border}`,
        backdropFilter: 'blur(10px)',
        boxShadow: `0 1px 3px ${theme.shadow}`
      }}>
        <div className='py-2 px-4 flex items-center flex-1 gap-2 justify-between'>
          {/* Title Section */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: isMobile ? '8px' : '12px',
            flex: 1,
            minWidth: 0
          }}>
            <ArrowLeft className='h-5 w-5 opacity-80' onClick={() => setActiveTab("Journal")} />
            {showTitleEdit ? (
              <input
                type="text"
                value={journalTitle}
                onChange={(e) => setJournalTitle(e.target.value)}
                onBlur={() => setShowTitleEdit(false)}
                onKeyPress={(e) => e.key === 'Enter' && setShowTitleEdit(false)}
                placeholder="Enter journal title..."
                className='text-md !rounded-2xl !outline-none flex-1 max-w-[600px]'
                style={{
                  background: 'transparent',
                  border: `1px solid ${theme.border}`,
                  padding: isMobile ? '4px 10px' : '6px 12px',
                  color: theme.text,
                  minWidth: isMobile ? '120px' : '200px',
                }}
                autoFocus
              />
            ) : (
              <h3
                className='!text-md cursor-pointer m-0 flex-1 text-left overflow-hidden'
                onClick={() => setShowTitleEdit(true)}
                style={{
                  color: theme.text,
                  padding: isMobile ? '4px 10px' : '6px 12px',
                  transition: 'all 0.2s ease',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
                onMouseOver={(e: MouseEvent<HTMLHeadingElement>) => {
                  // e.target, not currentTarget: preserves the original
                  // behaviour of styling whatever element was hovered.
                  if (e.target instanceof HTMLElement) e.target.style.backgroundColor = theme.surfaceElevated;
                }}
                onMouseOut={(e: MouseEvent<HTMLHeadingElement>) => {
                  if (e.target instanceof HTMLElement) e.target.style.backgroundColor = 'transparent';
                }}
              >
                {journalTitle || <span className='opacity-50'>Untitled</span>}
              </h3>
            )}
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: '12px', flexShrink: 0 }}>
            <button
              className='!rounded-2xl !text-sm cursor-pointer'
              onClick={() => setShowPrompts(!showPrompts)}
              style={{
                backgroundColor: showPrompts ? theme.accent : 'transparent',
                border: `1px solid ${showPrompts ? theme.accent : theme.border}`,
                padding: isMobile ? '6px 8px' : '8px 12px',
                color: showPrompts ? theme.text : theme.textSecondary,
                transition: 'all 0.2s ease'
              }}
            >
              {isMobile ? '✨' : '✨ Prompts'}
            </button>

            <button
              className='!rounded-2xl !text-sm cursor-pointer flex gap-2 items-center'
              onClick={() => setShowPreview(!showPreview)}
              style={{
                backgroundColor: showPreview ? theme.secondary : 'transparent',
                border: `1px solid ${showPreview ? theme.secondary : theme.border}`,
                padding: isMobile ? '6px 8px' : '8px 12px',
                color: showPreview ? 'white' : theme.textSecondary,
                transition: 'all 0.2s ease'
              }}
            >
              <MdPreview size={18} />
              {isMobile ? '' : 'Preview'}
            </button>
          </div>
        </div>
      </div>

      {/* Prompts Panel - Mobile: Full screen overlay, Desktop: Floating panel */}
      {showPrompts && (
        <div style={{
          position: 'absolute',
          top: isMobile ? 0 : '0px',
          left: isMobile ? 0 : '10px',
          width: isMobile ? '100vw' : 'calc(100% - 20px)',
          height: isMobile ? '60dvh' : 'auto',
          maxHeight: isMobile ? '100vh' : 'calc(100vh - 300px)',
          backgroundColor: theme.surface,
          borderRadius: isMobile ? 0 : '16px',
          boxShadow: isMobile ? 'none' : `0 10px 40px ${theme.shadow}`,
          border: isMobile ? 'none' : `1px solid ${theme.border}`,
          zIndex: 9999,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div className='space-y-1' style={{
            padding: isMobile ? '16px 20px' : '20px 24px 16px 24px',
            borderBottom: `1px solid ${theme.border}`,
            background: `linear-gradient(135deg, ${theme.accent}10 0%, ${theme.secondary}10 100%)`,
            flexShrink: 0
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <button
                onClick={() => setShowCustomPromptInput(!showCustomPromptInput)}
                style={{
                  backgroundColor: showCustomPromptInput ? theme.secondary : theme.surfaceElevated,
                  border: 'none',
                  borderRadius: '6px',
                  padding: isMobile ? '8px 12px' : '6px 10px',
                  cursor: 'pointer',
                  color: showCustomPromptInput ? 'white' : theme.textSecondary,
                  fontSize: isMobile ? '12px' : '11px',
                  fontWeight: '500',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}
              >
                Add Custom
              </button>
              <button
                onClick={() => setShowPrompts(false)}
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: theme.textSecondary,
                  fontSize: isMobile ? '24px' : '20px',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '4px',
                  lineHeight: 1
                }}
              >
                ×
              </button>
            </div>
            
            <div style={{
              display: 'flex',
              gap: '8px'
            }}>
              {addedPrompts.length > 0 && (
                <div style={{
                  backgroundColor: theme.accent + '20',
                  borderRadius: '6px',
                  padding: isMobile ? '8px 12px' : '6px 10px',
                  fontSize: isMobile ? '12px' : '11px',
                  fontWeight: '500',
                  color: theme.accent,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  {addedPrompts.length} Used
                </div>
              )}
            </div>

            {/* Custom Prompt Input */}
            {showCustomPromptInput && (
              <div style={{
                marginTop: '12px',
                display: 'flex',
                gap: '8px'
              }}>
                <input
                  type="text"
                  value={newCustomPrompt}
                  onChange={(e) => setNewCustomPrompt(e.target.value)}
                  onKeyPress={handleCustomPromptKeyPress}
                  placeholder="Add your prompt..."
                  style={{
                    flex: 1,
                    padding: isMobile ? '10px 12px' : '8px 10px',
                    borderRadius: '6px',
                    border: `1px solid ${theme.border}`,
                    backgroundColor: theme.surfaceElevated,
                    color: theme.text,
                    fontSize: isMobile ? '14px' : '12px',
                    outline: 'none',
                    fontFamily: 'inherit'
                  }}
                />
                <button
                  onClick={addCustomPrompt}
                  disabled={!newCustomPrompt.trim()}
                  style={{
                    padding: isMobile ? '10px 16px' : '8px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: newCustomPrompt.trim() ? theme.accent : theme.border,
                    color: newCustomPrompt.trim() ? theme.text : theme.textTertiary,
                    fontSize: isMobile ? '12px' : '11px',
                    fontWeight: '600',
                    cursor: newCustomPrompt.trim() ? 'pointer' : 'not-allowed',
                    textTransform: 'uppercase'
                  }}
                >
                  Add
                </button>
              </div>
            )}
          </div>

          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: isMobile ? '20px 20px' : '16px 24px'
          }}>
            <style>
              {`
                .prompt-scroll::-webkit-scrollbar { width: 3px; }
                .prompt-scroll::-webkit-scrollbar-track { background: transparent; }
                .prompt-scroll::-webkit-scrollbar-thumb { 
                  background: ${theme.textTertiary}; 
                  border-radius: 3px; 
                }
                .prompt-scroll::-webkit-scrollbar-thumb:hover { 
                  background: ${theme.textSecondary}; 
                }
              `}
            </style>
            
            <div className="prompt-scroll" style={{
              display: 'flex',
              flexDirection: 'column',
              gap: isMobile ? '16px' : '12px'
            }}>
              {Object.entries(groupedPrompts).map(([category, categoryPrompts]) => (
                <div key={category}>
                  <div style={{
                    fontSize: isMobile ? '11px' : '10px',
                    fontWeight: '600',
                    color: theme.textTertiary,
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    marginBottom: isMobile ? '10px' : '8px',
                    paddingLeft: '4px'
                  }}>
                    {category}
                  </div>
                  
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: isMobile ? '6px' : '4px'
                  }}>
                    {categoryPrompts.map((prompt, index) => {
                      const isUsed = addedPrompts.some((p) => p.text === prompt.text);
                      return (
                        <button
                          key={index}
                          onClick={() => !isUsed && addPromptToEntry(prompt)}
                          disabled={isUsed}
                          style={{
                            backgroundColor: isUsed ? theme.surfaceElevated : 'transparent',
                            border: 'none',
                            borderRadius: '8px',
                            padding: isMobile ? '12px 14px' : '10px 12px',
                            cursor: isUsed ? 'default' : 'pointer',
                            color: isUsed ? theme.textTertiary : theme.text,
                            fontSize: isMobile ? '14px' : '12px',
                            fontWeight: '400',
                            transition: 'all 0.2s ease',
                            textAlign: 'left',
                            lineHeight: '1.4',
                            opacity: isUsed ? 0.5 : 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: isMobile ? '10px' : '8px'
                          }}
                          onMouseOver={(e: MouseEvent<HTMLButtonElement>) => {
                            if (!isUsed && e.target instanceof HTMLElement) {
                              e.target.style.backgroundColor = theme.surfaceElevated;
                            }
                          }}
                          onMouseOut={(e: MouseEvent<HTMLButtonElement>) => {
                            if (!isUsed && e.target instanceof HTMLElement) {
                              e.target.style.backgroundColor = 'transparent';
                            }
                          }}
                        >
                          <span style={{ fontSize: isMobile ? '16px' : '14px', flexShrink: 0 }}>
                            {isUsed ? '✓' : prompt.emoji}
                          </span>
                          <span style={{ flex: 1 }}>
                            {prompt.text}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Custom Prompts */}
              {customPrompts.length > 0 && (
                <div>
                  <div style={{
                    fontSize: isMobile ? '11px' : '10px',
                    fontWeight: '600',
                    color: theme.textTertiary,
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    marginBottom: isMobile ? '10px' : '8px',
                    paddingLeft: '4px'
                  }}>
                    Custom
                  </div>
                  
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: isMobile ? '6px' : '4px'
                  }}>
                    {customPrompts.map((prompt, index) => {
                      const isUsed = addedPrompts.some((p) => p.text === prompt.text);
                      return (
                        <div key={index} style={{ position: 'relative' }}>
                          <button
                            onClick={() => !isUsed && addPromptToEntry(prompt)}
                            disabled={isUsed}
                            style={{
                              backgroundColor: isUsed ? theme.surfaceElevated : 'transparent',
                              border: 'none',
                              borderRadius: '8px',
                              padding: isMobile ? '12px 50px 12px 14px' : '10px 40px 10px 12px',
                              cursor: isUsed ? 'default' : 'pointer',
                              color: isUsed ? theme.textTertiary : theme.text,
                              fontSize: isMobile ? '14px' : '12px',
                              fontWeight: '400',
                              transition: 'all 0.2s ease',
                              textAlign: 'left',
                              lineHeight: '1.4',
                              opacity: isUsed ? 0.5 : 1,
                              display: 'flex',
                              alignItems: 'center',
                              gap: isMobile ? '10px' : '8px',
                              width: '100%',
                              fontStyle: 'italic'
                            }}
                          >
                            <span style={{ fontSize: isMobile ? '16px' : '14px', flexShrink: 0 }}>
                              {isUsed ? '✓' : prompt.emoji}
                            </span>
                            <span style={{ flex: 1 }}>
                              {prompt.text}
                            </span>
                          </button>
                          
                          <button
                            onClick={() => removeCustomPrompt(prompt)}
                            style={{
                              position: 'absolute',
                              right: isMobile ? '12px' : '8px',
                              top: '50%',
                              transform: 'translateY(-50%)',
                              backgroundColor: 'transparent',
                              border: 'none',
                              color: theme.textTertiary,
                              fontSize: isMobile ? '16px' : '14px',
                              cursor: 'pointer',
                              padding: '4px',
                              borderRadius: '4px'
                            }}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Scrollable Middle Section */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: isMobile ? '16px 16px 120px 16px' : '32px 24px 120px 24px'
      }}>
        <div style={{
          maxWidth: isMobile ? '100%' : '800px',
          margin: '0 auto'
        }}>
          {showPreview ? (
            <div style={{
              backgroundColor: theme.surface,
              borderRadius: isMobile ? '8px' : '12px',
              padding: isMobile ? '20px' : '32px',
              border: `1px solid ${theme.border}`,
              lineHeight: '1.7',
              fontSize: isMobile ? '15px' : '16px',
              whiteSpace: 'pre-wrap'
            }}>
              {journalEntry || (
                <div style={{ 
                  color: theme.textTertiary,
                  fontStyle: 'italic',
                  textAlign: 'center',
                  padding: isMobile ? '30px 0' : '40px 0'
                }}>
                  Nothing to preview yet. Start writing to see your content here.
                </div>
              )}
            </div>
          ) : (
            <div style={{
              backgroundColor: theme.surface,
              borderRadius: isMobile ? '8px' : '12px',
              border: `1px solid ${isFocused ? theme.accent : theme.border}`,
              transition: 'border-color 0.2s ease',
              overflow: 'hidden',
            }}>
              <textarea
                ref={textareaRef}
                value={journalEntry}
                onChange={(e) => setJournalEntry(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder="Start writing your thoughts here, or tap 'Prompts' to add guided questions to your entry..."
                style={{
                  width: '100%',
                  minHeight: isMobile ? '400px' : '500px',
                  backgroundColor: 'transparent',
                  border: 'none',
                  outline: 'none',
                  resize: 'none',
                  fontSize: isMobile ? '16px' : '16px',
                  lineHeight: '1.7',
                  color: theme.text,
                  fontFamily: 'inherit',
                  padding: isMobile ? '20px' : '32px'
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* What's attached, with a way to take it back off again. */}
      {attachments.length > 0 && (
        <div style={{
          padding: '10px 16px',
          display: 'flex',
          gap: '10px',
          flexWrap: 'wrap',
          borderTop: `1px solid ${theme.border}`,
          backgroundColor: theme.surface,
        }}>
          {attachments.map((attachment, index) => (
            <div
              key={index}
              style={{
                position: 'relative',
                borderRadius: '10px',
                border: `1px solid ${theme.border}`,
                padding: attachment.kind === 'image' ? 0 : '8px 12px',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {attachment.kind === 'image' ? (
                <img
                  src={attachment.previewUrl}
                  alt="Attached"
                  style={{ width: '84px', height: '84px', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <audio controls src={attachment.previewUrl} style={{ height: '32px' }} />
              )}
              <button
                onClick={() => removeAttachment(index)}
                title="Remove"
                style={{
                  position: attachment.kind === 'image' ? 'absolute' : 'static',
                  top: '4px',
                  right: '4px',
                  background: `${theme.background}cc`,
                  color: theme.text,
                  border: 'none',
                  borderRadius: '999px',
                  width: '22px',
                  height: '22px',
                  cursor: 'pointer',
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Sticky Footer */}
      <div style={{
        position: 'sticky',
        bottom: 0,
        zIndex: 100,
        backgroundColor: theme.surface,
        borderTop: `1px solid ${theme.border}`,
        backdropFilter: 'blur(10px)',
        boxShadow: `0 -1px 3px ${theme.shadow}`
      }}>
        <div style={{
          padding: '14px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: isMobile ? 'wrap' : 'nowrap',
          gap: isMobile ? '8px' : '16px'
        }}>
          {/* Left Section - Stats */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: isMobile ? '12px' : '16px',
            flexWrap: 'wrap'
          }}>
            {
              !isMobile && <>
                {/* Time */}
                <p className='text-sm' style={{
                  color: theme.text,
                  fontVariantNumeric: 'tabular-nums'
                }}>
                  {formatTime(currentTime)}
                </p>
                <p className='text-sm' style={{
                  color: theme.textSecondary
                }}>
                  {charCount} Chars
                </p>
              </>
            }

            <p className='text-sm' style={{
              color: theme.textSecondary
            }}>
              {wordCount} Words
            </p>
          </div>

          {/* Right Section - Actions */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: isMobile ? '8px' : '12px',
            flexWrap: isMobile ? 'wrap' : 'nowrap'
          }}>
            <button
              onClick={() => (isRecording ? stopRecording() : startRecording())}
              className='!text-sm flex items-center gap-2 cursor-pointer justify-center !rounded-2xl md:min-w-[100px]'
              style={{
                border: `1px solid ${theme.border}`,
                padding: isMobile ? '6px 8px' : '8px 12px',
                color: theme.textSecondary,
                fontSize: isMobile ? '10px' : '12px',
              }}
            >
              <AiOutlineAudio size={18} style={isRecording ? { color: '#ef4444' } : undefined} />
              {!isMobile && (
                <span>
                  {isRecording
                    ? `Stop ${Math.floor(recordingSeconds / 60)}:${String(recordingSeconds % 60).padStart(2, '0')}`
                    : 'Voice'}
                </span>
              )}
            </button>

            <button
              onClick={() => photoInputRef.current?.click()}
              className='!text-sm flex items-center gap-2 cursor-pointer justify-center !rounded-2xl md:min-w-[100px]'
              style={{
                border: `1px solid ${theme.border}`,
                padding: isMobile ? '6px 8px' : '8px 12px',
                color: theme.textSecondary,
                fontSize: isMobile ? '10px' : '12px',
              }}
            >
              <TbPhotoSquareRounded size={18} />
              {!isMobile && <span>Photo</span>}
            </button>
            <input
              type="file"
              ref={photoInputRef}
              accept="image/*"
              onChange={handlePhotoSelected}
              style={{ display: 'none' }}
            />

            {journalEntry.trim() && (
              <button
                onClick={clearEntry}
                className='!text-sm flex items-center justify-center gap-2 cursor-pointer !rounded-2xl md:min-w-[100px]'
                style={{
                  border: `1px solid ${theme.border}`,
                  borderRadius: isMobile ? '6px' : '8px',
                  padding: isMobile ? '6px 8px' : '8px 12px',
                  color: theme.textSecondary,
                  fontSize: isMobile ? '10px' : '12px',
                }}
                onMouseOver={(e: MouseEvent<HTMLButtonElement>) => {
                  if (!(e.target instanceof HTMLElement)) return;
                  e.target.style.backgroundColor = theme.surfaceElevated;
                  e.target.style.borderColor = theme.error;
                  e.target.style.color = theme.error;
                }}
                onMouseOut={(e: MouseEvent<HTMLButtonElement>) => {
                  if (!(e.target instanceof HTMLElement)) return;
                  e.target.style.backgroundColor = 'transparent';
                  e.target.style.borderColor = theme.border;
                  e.target.style.color = theme.textSecondary;
                }}
              >
                <GrClearOption size={18} />
                {!isMobile && <span>Clear</span>}
              </button>
            )}

            <button
              onClick={saveEntry}
              disabled={!journalEntry.trim() || isSaving}
              className='!text-sm flex !border-none items-center justify-center gap-2 cursor-pointer !rounded-2xl md:min-w-[100px]'
              style={{
                backgroundColor: journalEntry.trim() ? theme.accent : theme.border,
                color: journalEntry.trim() ? theme.text : theme.textTertiary,
                borderRadius: isMobile ? '6px' : '8px',
                padding: isMobile ? '8px 12px' : '10px 20px',
                cursor: journalEntry.trim() && !isSaving ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s ease',
                boxShadow: journalEntry.trim() ? `0 2px 8px ${theme.accent}30` : 'none',
                opacity: isSaving ? 0.7 : 1
              }}
            >
              <HiOutlineSave size={18} />
              <span>{isSaving ? 'Saving...' : 'Save'}</span>
            </button>
          </div>
        </div>
        {saveError && (
          <div style={{
            padding: isMobile ? '8px 16px' : '8px 24px',
            color: theme.error,
            fontSize: '0.85rem',
            textAlign: 'center'
          }}>
            {saveError}
          </div>
        )}
      </div>
    </div>
  );
};

export default CreateJournal;