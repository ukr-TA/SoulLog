import { useState } from 'react';
import SoulLog from './assets/SoulLog.svg';
import { buildTheme } from './theme';

interface ForgotPasswordPageProps {
  setCurrentPage: (page: string) => void;
  darkMode: boolean;
  /** Codes from the reset-email link, which open the second step directly. */
  resetCodes?: { uid: string; token: string } | null;
}

/**
 * The field errors DRF returns from the reset-confirm endpoint. Both
 * lists are optional — a failure may carry neither.
 */
interface ResetConfirmErrors {
  non_field_errors?: string[];
  new_password?: string[];
}

const ForgotPasswordPage = ({setCurrentPage, darkMode, resetCodes}: ForgotPasswordPageProps) => {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Real reset flow (spec §13). Step 2's uid/token fields are a dev-only
  // stand-in for "click the link in your email" — this SPA has no
  // deep-link route to receive that link yet, so the app shows the
  // fields directly. Production needs a real email link -> route that
  // pre-fills these from the URL instead of asking the user to paste
  // them in by hand. Documented, not hidden.
  const [step, setStep] = useState<'request' | 'confirm'>(resetCodes ? 'confirm' : 'request');
  const [uid, setUid] = useState(resetCodes?.uid ?? '');
  const [token, setToken] = useState(resetCodes?.token ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // The palette this screen used to define inline was a copy of the
  // shared one; it now comes from theme.ts so there is one of it.
  const theme = buildTheme(darkMode);

  const handleForgotPassword = async () => {
    setError('');

    if (!username) {
      setError('Please enter your username');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/auth/password-reset/request/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      if (response.ok) {
        // Deliberately the same message regardless of whether the
        // username exists — the backend enforces this, not just the UI.
        setSuccessMessage("If an account with that username exists, we've emailed it a reset link. Open the link — or enter the two codes from the email below.");
        setStep('confirm');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmReset = async () => {
    setError('');

    if (!uid || !token || !newPassword) {
      setError('Please fill in all fields');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/auth/password-reset/confirm/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, token, new_password: newPassword })
      });
      if (response.ok) {
        // Said on the page, then on to sign in — it used to be an alert().
        setError('');
        setSuccessMessage('Your password has been reset. Taking you to sign in…');
        window.setTimeout(() => setCurrentPage('login'), 1800);
      } else {
        const data: ResetConfirmErrors = await response.json().catch(() => ({}));
        setError(
          data.non_field_errors?.[0]
          || data.new_password?.[0]
          || 'This reset link is invalid or has expired.',
        );
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div 
      style={{ 
        minHeight: '100vh',
        background: theme.background,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      {/* Forgot Password Card */}
      <div 
        style={{
          background: theme.surface,
          borderRadius: '2rem',
          padding: '2rem',
          margin: '1rem',
          width: '100%',
          maxWidth: '400px',
          boxShadow: darkMode ? 'none' : '0 20px 40px rgba(0,0,0,0.1)'
        }}
      >
        {/* Header with Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            {/* Logo */}
            <img src={SoulLog} style={{
                width: '90px',
                height: '90px',
                position: 'relative',
            }}  />

          <h1 
            style={{
              fontSize: '2rem',
              fontWeight: 'bold',
              color: theme.text,
              margin: '0 0 0.5rem 0'
            }}
          >
            SoulLog
          </h1>
          
          <h2 
            style={{
              fontSize: '1.5rem',
              fontWeight: 'bold',
              color: theme.text,
              margin: '0 0 0.5rem 0'
            }}
          >
            Reset Password
          </h2>
          
          <p 
            style={{
              color: theme.text,
              opacity: 0.7,
              margin: 0
            }}
          >
            Enter your username to receive a password reset link
          </p>
        </div>

        {/* Forgot Password Form */}
        <div style={{ marginBottom: '2rem', textAlign: 'left' }}>
          {step === 'request' ? (
            <>
              {/* Username Field */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label
                  style={{
                    display: 'block',
                    color: theme.text,
                    fontWeight: '500',
                    marginBottom: '0.5rem'
                  }}
                >
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  style={{
                    width: '100%',
                    padding: '1rem',
                    borderRadius: '1rem',
                    border: `2px solid ${theme.border}`,
                    background: theme.background,
                    color: theme.text,
                    fontSize: '1rem',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {error && (
                <div style={{ color: '#EF4444', fontSize: '0.9rem', textAlign: 'center', marginBottom: '1rem' }}>
                  {error}
                </div>
              )}

              <button
                onClick={handleForgotPassword}
                disabled={isSubmitting}
                style={{
                  width: '100%',
                  background: theme.accent,
                  color: theme.background,
                  border: 'none',
                  padding: '1rem',
                  borderRadius: '3rem',
                  fontSize: '1.1rem',
                  fontWeight: 'bold',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  transition: 'transform 0.2s',
                  marginBottom: '1rem',
                  opacity: isSubmitting ? 0.7 : 1
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.02)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
              >
                {isSubmitting ? 'Sending...' : 'Send Reset Link'}
              </button>
            </>
          ) : (
            <>
              {successMessage && (
                <div style={{ color: theme.secondary, fontSize: '0.9rem', textAlign: 'center', marginBottom: '1.5rem' }}>
                  {successMessage}
                </div>
              )}

              {[
                { label: 'Reset uid', value: uid, setter: setUid, placeholder: 'From the console email' },
                { label: 'Reset token', value: token, setter: setToken, placeholder: 'From the console email' },
              ].map((field) => (
                <div key={field.label} style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', color: theme.text, fontWeight: '500', marginBottom: '0.5rem' }}>
                    {field.label}
                  </label>
                  <input
                    type="text"
                    value={field.value}
                    onChange={(e) => field.setter(e.target.value)}
                    placeholder={field.placeholder}
                    style={{
                      width: '100%',
                      padding: '1rem',
                      borderRadius: '1rem',
                      border: `2px solid ${theme.border}`,
                      background: theme.background,
                      color: theme.text,
                      fontSize: '1rem',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              ))}

              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', color: theme.text, fontWeight: '500', marginBottom: '0.5rem' }}>
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter a new password"
                  style={{
                    width: '100%',
                    padding: '1rem',
                    borderRadius: '1rem',
                    border: `2px solid ${theme.border}`,
                    background: theme.background,
                    color: theme.text,
                    fontSize: '1rem',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', color: theme.text, fontWeight: '500', marginBottom: '0.5rem' }}>
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="Confirm your new password"
                  style={{
                    width: '100%',
                    padding: '1rem',
                    borderRadius: '1rem',
                    border: `2px solid ${theme.border}`,
                    background: theme.background,
                    color: theme.text,
                    fontSize: '1rem',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {error && (
                <div style={{ color: '#EF4444', fontSize: '0.9rem', textAlign: 'center', marginBottom: '1rem' }}>
                  {error}
                </div>
              )}

              <button
                onClick={handleConfirmReset}
                disabled={isSubmitting}
                style={{
                  width: '100%',
                  background: theme.accent,
                  color: theme.background,
                  border: 'none',
                  padding: '1rem',
                  borderRadius: '3rem',
                  fontSize: '1.1rem',
                  fontWeight: 'bold',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  transition: 'transform 0.2s',
                  marginBottom: '1rem',
                  opacity: isSubmitting ? 0.7 : 1
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.02)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
              >
                {isSubmitting ? 'Resetting...' : 'Reset Password'}
              </button>
            </>
          )}
        </div>

        {/* Back to Login */}
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: theme.text, opacity: 0.7, margin: 0 }}>
            Remember your password?{' '}
            <br />
            <button 
              onClick={() => setCurrentPage('login')}
              style={{
                background: 'none',
                border: 'none',
                color: theme.secondary,
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: '500'
              }}
            >
              Back to Sign In
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;