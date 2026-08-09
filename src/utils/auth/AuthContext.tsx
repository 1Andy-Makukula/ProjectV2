import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../../lib/supabaseClient';
import type { User, Session } from '@supabase/supabase-js';

interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
}

type UserRole = 'sender' | 'merchant' | 'admin';

const USER_ROLES: readonly UserRole[] = ['sender', 'merchant', 'admin'];

/**
 * Narrow a role from the database into the union the app routes on.
 *
 * The column is constrained -- users_role_check restricts it to exactly these
 * three -- but the generated types say `string`, because the type generator
 * does not translate CHECK constraints into unions. So the narrowing is sound;
 * it just cannot be proven to TypeScript.
 *
 * Validated rather than cast. If the constraint is ever widened and this is not
 * updated, a blind cast would let an unknown role flow into route gating and be
 * treated as whichever branch happened to match last. Falling back to the least
 * privileged role fails safe, and says so.
 */
function toUserRole(role: string, userId: string): UserRole {
  if ((USER_ROLES as readonly string[]).includes(role)) {
    return role as UserRole;
  }
  console.error(
    `[AuthContext] User ${userId} has an unrecognised role '${role}'. ` +
      `Treating them as 'sender'. This means users_role_check was widened ` +
      `without updating UserRole.`,
  );
  return 'sender';
}

/** Row shape from `users`, narrowed to what the app actually consumes. */
function toProfile(row: {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
}): UserProfile {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: toUserRole(row.role, row.id),
  };
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  session: Session | null;
  loading: boolean;
  /** True when the profile row could not be fetched (e.g. RLS denial). */
  profileError: boolean;
  signUp: (email: string, password: string, name: string, phone: string, location?: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: any }>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<{ error: any }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId: string) => {
    setProfileError(false);
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        // If row missing (PGRST116), self-heal by creating default profile & wallet
        if (error.code === 'PGRST116') {
          const { data: authUserData } = await supabase.auth.getUser();
          const authUser = authUserData?.user;
          if (authUser) {
            const fallbackName = authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'User';
            const fallbackPhone = authUser.user_metadata?.phone || null;

            const { data: createdProfile, error: createError } = await supabase
              .from('users')
              .upsert(
                {
                  id: userId,
                  name: fallbackName,
                  email: authUser.email || '',
                  phone: fallbackPhone,
                  role: 'sender',
                },
                { onConflict: 'id' }
              )
              .select()
              .single();

            if (!createError && createdProfile) {
              await supabase.from('kithly_wallets').upsert(
                { user_id: userId, balance: 0, currency: 'ZMW' },
                { onConflict: 'user_id' }
              );
              setProfile(toProfile(createdProfile));
              return;
            }
          }
        }
        throw error;
      }
      setProfile(toProfile(data));
    } catch (error) {
      console.error('Error fetching profile (possible RLS denial):', error);
      setProfileError(true);
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (email: string, password: string, name: string, phone: string, location?: string) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
            phone,
            location,
          },
        },
      });

      if (error) return { error };

      if (data.user) {
        await supabase
          .from('users')
          .upsert({
            id: data.user.id,
            name,
            email,
            phone,
          }, { onConflict: 'id' });
      }

      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    localStorage.clear();
    sessionStorage.clear();
    navigate('/login', { replace: true });
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    return { error };
  };

  const updateProfile = async (updates: Partial<UserProfile>) => {
    if (!user) return { error: new Error('Not authenticated') };

    const promises = [];

    if (updates.email || updates.name || updates.phone) {
      promises.push(
        supabase.auth.updateUser({
          email: updates.email,
          data: {
            name: updates.name ?? profile?.name,
            phone: updates.phone ?? profile?.phone,
          },
        })
      );
    }

    promises.push(
      supabase
        .from('users')
        .update(updates)
        .eq('id', user.id)
    );

    try {
      const results = await Promise.all(promises);
      const errors = results.map(r => (r as any).error).filter(Boolean);

      if (errors.length > 0) {
        return { error: errors[0] };
      }

      setProfile((prev: UserProfile | null) => (prev ? { ...prev, ...updates } : null));
      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        session,
        loading,
        profileError,
        signUp,
        signIn,
        signOut,
        resetPassword,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
