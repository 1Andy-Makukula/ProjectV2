// KithLy Root Layout - Main App Container
import { Outlet } from 'react-router';
import { AuthProvider } from '../../utils/auth/AuthContext';
import { Toaster } from '../components/ui/sonner';
import { Footer } from '../components/layout/Footer'; // 1. IMPORT THE FOOTER

export function Root() {
  return (
    <AuthProvider>
      <div className="flex min-h-screen flex-col bg-background">
        {/* The Outlet represents the main page content, which expands to fill space */}
        <div className="flex-1">
          <Outlet />
        </div>
        
        {/* 2. INJECT THE FOOTER AT THE BOTTOM */}
        <Footer />
        
        <Toaster position="bottom-right" />
      </div>
    </AuthProvider>
  );
}