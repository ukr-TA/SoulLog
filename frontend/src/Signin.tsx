import { useState } from 'react';
import SoulLog from './assets/SoulLog.svg';
import { buildTheme } from './theme';
import { signIn } from './auth';

interface LoginPageProps {
  setCurrentPage: (page: string) => void;
  darkMode: boolean;
}

const LoginPage = ({setCurrentPage, darkMode}: LoginPageProps) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  // Guards against a double click signing in twice, and gives the button
  // something to say while it waits.
  const [submitting, setSubmitting] = useState(false);

  // The palette this screen used to define inline was a copy of the
  // shared one; it now comes from theme.ts so there is one of it.
  const theme = buildTheme(darkMode);

  const handleSubmit = async () => {
    if (submitting) return;
    setError('');

    if (!username || !password) {
      setError('Please fill in all fields');
      return;
    }

    setSubmitting(true);
    const problem = await signIn(username, password);
    setSubmitting(false);
    if (problem) {
      setError(problem);
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
      {/* Login Card */}
      <div
        // Enter anywhere in the form signs in. The fields aren't in a
        // <form>, so the browser didn't do this on its own.
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }} 
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
                margin: '14px auto',
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
            Welcome Back
          </h2>
          
          <p 
            style={{
              color: theme.text,
              opacity: 0.7,
              margin: 0
            }}
          >
            Continue your journey of self-discovery
          </p>
        </div>

        {/* Login Form */}
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
              transition: 'transform 0.2s',
              marginBottom: '1rem'
            }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.transform = 'scale(1.02)'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.transform = 'scale(1)'; }}
          >
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>

          {/* Forgot Password Link */}
          <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
            <button 
              style={{
                background: 'none',
                border: 'none',
                color: theme.secondary,
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: '0.9rem'
              }}
              onClick={() => setCurrentPage('forgot-password')}
            >
              Forgot password?
            </button>
          </div>
        </div>

        {/* Signup Link */}
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: theme.text, opacity: 0.7, margin: 0 }}>
            Don't have an account?{' '}
            <button 
              onClick={() => setCurrentPage('signup')}
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
              Sign up
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;