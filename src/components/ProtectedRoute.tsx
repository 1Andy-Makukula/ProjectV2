import { Navigate } from 'react-router';
import { useAuth } from '../utils/auth/AuthContext';
import { PageLoader } from '../app/components/shared/PageLoader';
import { ReactNode } from 'react';

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: Array<'sender' | 'merchant' | 'admin'>;
  requireAuth?: boolean;
}

export function ProtectedRoute({
  children,
  allowedRoles,
  requireAuth = true,
}: ProtectedRouteProps) {
  const { user, profile, loading, profileError } = useAuth();

  // 1. Auth context is still initialising — show spinner
  if (loading) {
    return <PageLoader />;
  }

  // 2. Not authenticated → send to login
  if (requireAuth && !user) {
    return <Navigate to="/login" replace />;
  }

  // 3. Authenticated but profile hasn't loaded yet.
  //    - If it errored (RLS denial), force re-login so the session is clean.
  //    - Otherwise hold the spinner while fetchProfile is in-flight.
  if (requireAuth && user && !profile) {
    if (profileError) {
      return <Navigate to="/login" replace />;
    }
    return <PageLoader />;
  }

  // 4. Authenticated with a profile — enforce role gate
  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    if (profile.role === 'admin') return <Navigate to="/admin" replace />;
    if (profile.role === 'merchant') return <Navigate to="/merchant" replace />;
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
