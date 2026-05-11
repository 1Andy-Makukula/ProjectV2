// KithLy Root Layout - Main App Container

import { Outlet } from 'react-router';
import { AuthProvider } from '../../utils/auth/AuthContext';
import { Toaster } from '../components/ui/sonner';

export function Root() {
  return (
    <AuthProvider>
      <div className="flex min-h-screen flex-col bg-background">
        <Outlet />
        <Toaster position="bottom-right" />
      </div>
    </AuthProvider>
  );
}