// KithLy Auth Hook - Session Management

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, UserProfile } from '../types';
import { mockUsers, mockProfiles } from '../data/mock-data';

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  isAuthenticated: boolean;
  
  // Actions
  login: (email: string, password: string) => Promise<boolean>;
  loginWithGoogle: () => Promise<boolean>;
  logout: () => void;
  updateProfile: (profile: Partial<UserProfile>) => void;
  checkProfileComplete: () => boolean;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      profile: null,
      isAuthenticated: false,

      login: async (email: string, password: string) => {
        // Mock login - In production, this would call the backend
        const user = mockUsers.find(u => u.email === email);
        if (user) {
          const profile = mockProfiles.find(p => p.user_id === user.id);
          set({ user, profile, isAuthenticated: true });
          return true;
        }
        return false;
      },

      loginWithGoogle: async () => {
        // Mock Google OAuth - In production, this would trigger OAuth flow
        const user = mockUsers[0];
        const profile = mockProfiles[0];
        set({ user, profile, isAuthenticated: true });
        return true;
      },

      logout: () => {
        set({ user: null, profile: null, isAuthenticated: false });
      },

      updateProfile: (updates: Partial<UserProfile>) => {
        const { profile } = get();
        if (profile) {
          const updatedProfile = { ...profile, ...updates };
          set({ profile: updatedProfile });
        }
      },

      checkProfileComplete: () => {
        const { profile } = get();
        if (!profile) return false;
        
        // Check if essential fields are filled
        return !!(
          profile.nrc_number &&
          profile.district_id &&
          profile.momo_number &&
          profile.is_verified
        );
      },
    }),
    {
      name: 'kithly-auth',
    }
  )
);
