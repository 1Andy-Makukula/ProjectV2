import { Navigate } from 'react-router';
import { useAuth } from '../utils/auth/AuthContext';
import { ReactNode } from 'react';

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: Array<'sender' | 'merchant' | 'admin'>;
  requireAuth?: boolean;
}

export function ProtectedRoute({
  children,
  allowedRoles,
  requireAuth = true
}: ProtectedRouteProps) {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (requireAuth && !user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    // Redirect based on user role
    if (profile.role === 'admin') return <Navigate to="/admin" replace />;
    if (profile.role === 'merchant') return <Navigate to="/merchant" replace />;
    return <Navigate to="/home" replace />;
  }

  return <>{children}</>;
}
