import React, { useState } from 'react';
import SoulLog from './assets/SoulLog.svg';
import { buildTheme } from './theme';
import { NETWORK_ERROR, firstFieldError, signIn } from './auth';

interface SignupPageProps {
  setCurrentPage: (page: string) => void;
  darkMode: boolean;
}

const SignupPage = ({setCurrentPage, darkMode}: SignupPageProps) => {
  const [fullname, setfullname] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('');
  const [phonenumber, setPhonenumber] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // The palette this screen used to define inline was a copy of the
  // shared one; it now comes from theme.ts so there is one of it.
  const theme = buildTheme(darkMode);

  // Called from the button and from Enter in any field.
  const handleSubmit = async (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    if (submitting) return;
    setError('');

    if (!username || !password || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setSubmitting(true);
    let response: Response;
    try {
      response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullname,
          username,
          password,
          email,
          // Optional. This field was on the form from the start and used
          // to be dropped before the request was sent.
          phone_number: phonenumber.trim(),
        }),
      });
    } catch {
      setSubmitting(false);
      setError(NETWORK_ERROR);
      return;
    }

    if (!response.ok) {
      // The server says exactly what's wrong — a taken username, a weak
      // password — and this used to replace it with "Failed to create
      // account" in a browser alert.
      const body = await response.json().catch(() => null);
      setSubmitting(false);
      setError(firstFieldError(body) || "Couldn't create your account. Please check the details and try again.");
      return;
    }

    // Straight in, with the account just created: no alert, and no
    // second trip through the sign-in screen with the same details.
    const problem = await signIn(username, password);
    setSubmitting(false);
    if (problem) {
      setCurrentPage('login');
      return;
    }
    setCurrentPage('dashboard');
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
      {/* Signup Card */}
      <div
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(e); }} 
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
           <img src={SoulLog} style={{
                width: '90px',
                height: '90px',
                position: 'relative',
                margin: '14px auto'
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
            Begin Your Journey
          </h2>
          
          <p 
            style={{
              color: theme.text,
              opacity: 0.7,
              margin: 0
            }}
          >
            Create your space for reflection
          </p>
        </div>

        {/* Signup Form */}
        <div style={{ marginBottom: '2rem', textAlign: 'left' }}>
          
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
              Fullname
            </label>
            <input
              type="text"
              value={fullname}
              onChange={(e) => setfullname(e.target.value)}
              placeholder="Enter your fullname"
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
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
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
              Phone number
            </label>
            <input
              type="text"
              value={phonenumber}
              onChange={(e) => setPhonenumber(e.target.value)}
              placeholder="Enter your phonenumber"
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

          {/* Password Field */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label 
              style={{
                display: 'block',
                color: theme.text,
                fontWeight: '500',
                marginBottom: '0.5rem'
              }}
            >
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
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

          {/* Confirm Password Field */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label 
              style={{
                display: 'block',
                color: theme.text,
                fontWeight: '500',
                marginBottom: '0.5rem'
              }}
            >
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
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

          {/* Error Message */}
          {error && (
            <div 
              style={{
                color: '#EF4444',
                fontSize: '0.9rem',
                textAlign: 'center',
                marginBottom: '1rem'
              }}
            >
              {error}
            </div>
          )}

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              width: '100%',
              background: theme.accent,
              color: theme.background,
              border: 'none',
              padding: '1rem',
              borderRadius: '3rem',
              fontSize: '1.1rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'transform 0.2s'
            }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.transform = 'scale(1.02)'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.transform = 'scale(1)'; }}
          >
            {submitting ? 'Creating your account…' : 'Create Account'}
          </button>
        </div>

        {/* Login Link */}
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: theme.text, opacity: 0.7, margin: 0 }}>
            Already have an account?{' '}
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
              Sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default SignupPage;