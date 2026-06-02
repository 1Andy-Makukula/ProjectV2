import { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Home } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

export function FloatingHomeButton() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<any>(null);

  // Unconditional Safety: execute role checks as boolean flag constants at the top
  const isMerchantRole = profile?.role === 'merchant';
  const isAdminRole = profile?.role === 'admin';
  const isMerchantPath = location.pathname.startsWith('/merchant');
  const isAdminPath = location.pathname.startsWith('/admin');
  const isLandingPage = location.pathname === '/';

  const shouldHideButton = isMerchantRole || isAdminRole || isMerchantPath || isAdminPath || isLandingPage;

  // STEP 2: The Activity/Fade Logic
  useEffect(() => {
    // If we should hide the button, do not bind any listeners or run fade logic
    if (shouldHideButton) {
      return;
    }

    const handleActivity = () => {
      // Clear any existing debounce timer
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Mark as visible immediately upon user activity
      setIsVisible(true);

      // Set debounce timer to hide the button after 2000ms of inactivity
      timeoutRef.current = setTimeout(() => {
        setIsVisible(false);
      }, 2000);
    };

    // Attach global user interaction listeners to track activity
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('scroll', handleActivity);
    window.addEventListener('touchstart', handleActivity);
    window.addEventListener('keydown', handleActivity);

    // Trigger initial visibility state when page mounts or updates
    handleActivity();

    // Clean up event listeners and timeouts to prevent memory leaks
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('scroll', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('keydown', handleActivity);
    };
  }, [shouldHideButton]);

  // STEP 1: Routing Guard & Role Verification Blocker
  if (shouldHideButton) {
    return null;
  }

  // STEP 3: Render button with Tailwind styling aligned to glassmorphism
  return (
    <button
      onClick={() => navigate('/')}
      className={`fixed bottom-6 right-6 z-50 rounded-full p-4 shadow-lg transition-all duration-700 ease-in-out cursor-pointer ${
        isVisible
          ? 'bg-gradient-to-br from-orange-500/60 to-red-600/60 backdrop-blur-md opacity-100 scale-100 pointer-events-auto border border-white/20 text-white active:scale-95'
          : 'opacity-0 scale-95 pointer-events-none'
      }`}
      aria-label="Navigate to home page"
    >
      <Home className="w-6 h-6" />
    </button>
  );
}

