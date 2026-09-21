import { useEffect, useState } from 'react';
import SoulLog from './assets/SoulLog.svg';
import SignupPage from './Signup';
import LoginPage from './Signin';
import ForgotPasswordPage from './ForgotPassword';
import Dashboard from './Dashboard';
import { Preferences } from '@capacitor/preferences';
import { buildTheme, type Theme } from './theme';
import { loadTheme, saveTheme } from './session';

// logOut, saveTheme and loadTheme live in session.ts: a file that
// exports both a component and plain functions defeats React Fast
// Refresh, which then reloads the whole page on every edit.

const SoulLogSpinner = ({ theme }: { theme: Theme }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
    <div
      style={{
        width: '70px',
        height: '70px',
        border: '5px solid rgba(207, 174, 97, 0.3)',
        borderTop: '5px solid #CFAE61',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
        marginBottom: '1rem',
      }}
    />
    <div style={{ 
      color: theme.text, 
      fontFamily: 'Merriweather',
      fontSize: '1rem',
      opacity: 0.8 
    }}>
      Preparing your journey...
    </div>
    <style>
      {`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}
    </style>
  </div>
);

const SoulLogApp = () => {
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [isLoading, setLoading] = useState<boolean>(true);
  const [currentPage, setCurrentPage] = useState('');
  const [isMobile, setIsMobile] = useState(false);

  // The palette lives in theme.ts now.
  //
  // This used to be a six-key object built here and passed down to every
  // screen. Screens read more than six keys off it — `cardBg`,
  // `gradient`, `mutedText` and others — and each of those came back
  // `undefined`, so the style was silently dropped: a card meant to sit
  // on its own surface sat on nothing. `theme` was typed `any`, which is
  // exactly why nobody found out.
  const theme = buildTheme(darkMode);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const t = await loadTheme();
      if (mounted) setDarkMode(t === 'dark');

      const { value: token } = await Preferences.get({key: 'access_token'}) ?? '';
      setTimeout(() => {
        if (token) {
          setCurrentPage('dashboard');
        } else {
          setLoading(false);
        }
      }, 750);
    })();
    return () => { mounted = false; };
  }, []);

  // Check window size and update mobile state
  useEffect(() => {
    const checkWindowSize = () => {
      setIsMobile(window.innerWidth < 800);
    };

    checkWindowSize();
    window.addEventListener('resize', checkWindowSize);
    return () => window.removeEventListener('resize', checkWindowSize);
  }, []);

  if (currentPage === 'signup') return <SignupPage setCurrentPage={setCurrentPage} darkMode={darkMode as boolean} />
  if (currentPage === 'login') return <LoginPage setCurrentPage={setCurrentPage} darkMode={darkMode as boolean} />
  if (currentPage === 'forgot-password') return <ForgotPasswordPage setCurrentPage={setCurrentPage} darkMode={darkMode as boolean} />
  if (currentPage === 'dashboard') return <Dashboard darkMode={darkMode} setDarkMode={setDarkMode} theme={theme} isMobile={isMobile} />

  return (
    <div 
      style={{ 
        minHeight: '100vh',
        background: `linear-gradient(to bottom, ${theme.background} 0%, ${theme.secondary} 100%)`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: theme.text,
        position: 'relative'
      }}
    >
      {/* Theme Toggle */}
      <button
        onClick={async () => {
          saveTheme(!darkMode ? 'dark' : 'light');
          setDarkMode(!darkMode);
        }}
        style={{
            position: 'absolute',
            top: '2rem',
            right: '2rem',
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            borderRadius: '50%',
            padding: '1rem',
            cursor: 'pointer',
            fontSize: '1.2rem',
            transition: 'all 0.3s ease',
            width: '3rem',
            height: '3rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
        }}
      >
        {darkMode ? '☀️' : '🌙'}
      </button>

      {/* Stars */}
      <div style={{ position: 'absolute', top: '20%', left: '10%', fontSize: '8px', color: 'rgba(255,255,255,0.8)' }}>✦</div>
      <div style={{ position: 'absolute', top: '30%', right: '15%', fontSize: '6px', color: 'rgba(255,255,255,0.6)' }}>✦</div>
      <div style={{ position: 'absolute', top: '60%', left: '20%', fontSize: '10px', color: 'rgba(255,255,255,0.9)' }}>✦</div>
      <div style={{ position: 'absolute', top: '80%', right: '25%', fontSize: '7px', color: 'rgba(255,255,255,0.7)' }}>✦</div>

      {/* Logo */}
        <img src={SoulLog} style={{
            width: '100px',
            height: '100px',
            position: 'relative',
            marginTop: '7rem',
        }}  />

      {/* Title */}
      <h1 
        style={{
          fontSize: '3.5rem',
          fontWeight: 'bold',
          margin: '0.8rem 0 0rem 0',
          textAlign: 'center',
          fontFamily: 'Merriweather'
        }}
      >
        SoulLog
      </h1>

      {/* Slogan */}
      <p 
        style={{
          fontSize: '1.5rem',
          fontStyle: 'italic',
          color: theme.text,
          margin: '0.5rem 0 10rem 0',
          textAlign: 'center',
          fontFamily: 'Merriweather'
        }}
      >
        Write. Reflect. Rise.
      </p>

      {
        isLoading ?
        <SoulLogSpinner theme={theme} />
        :
        // CTA Button
        <button
          style={{
            background: theme.accent,
            color: theme.background,
            border: 'none',
            padding: '1rem 3rem',
            borderRadius: '50px',
            fontSize: '1.1rem',
            fontWeight: 'bold',
            cursor: 'pointer',
            marginBottom: '1.5rem',
            transition: 'transform 0.2s',
            minWidth: '200px',
            fontFamily: 'Merriweather'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
          onClick={() => setCurrentPage('login')}
        >
          Start Journaling
        </button>
      }
    </div>
  );
};

export default SoulLogApp;