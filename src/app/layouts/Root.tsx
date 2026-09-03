// KithLy Root Layout - Main App Container
import { Outlet, ScrollRestoration } from 'react-router';
import { AuthProvider } from '../../utils/auth/AuthContext';
import { Toaster } from '../components/ui/sonner';
import { Footer } from '../components/layout/Footer'; // 1. IMPORT THE FOOTER
import { FloatingCart } from '../components/shared/FloatingCart';
import { CartSlider } from '../components/shared/CartSlider';
import { FloatingHomeButton } from '../components/shared/FloatingHomeButton';
import { ScrollIndicator } from '../components/shared/ScrollIndicator';
import { useNativeShell } from '../hooks/useNativeShell';

export function Root() {
  // Splash, status bar, hardware back, deep links, resume and connectivity.
  // Every branch of it is skipped in a browser.
  useNativeShell();

  return (
    <AuthProvider>
      <div className="flex min-h-screen flex-col bg-background" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {/* The Outlet represents the main page content, which expands to fill space */}
        <div className="flex-1">
          <Outlet />
          <FloatingCart />
          <CartSlider />
          <FloatingHomeButton />
        </div>
        
        {/* 2. INJECT THE FOOTER AT THE BOTTOM */}
        <Footer />
        
        {/* Pages opened at whatever offset the last one was left at, which
            on a long storefront meant landing on the footer and scrolling up
            to find the page. This restores position on back and forward, and
            starts every new navigation at the top. */}
        <ScrollRestoration />
        <ScrollIndicator />
        <Toaster position="bottom-right" />
      </div>
    </AuthProvider>
  );
}