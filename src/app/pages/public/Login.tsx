import { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { supabase } from '../../../lib/supabaseClient';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Eye, EyeOff, Gift } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import { useAuth } from '../../../utils/auth/AuthContext';
import { useEffect } from 'react';

// HD lifestyle image from Unsplash (friends laughing together)
const SIDE_IMAGE =
  'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=1200&q=80&fit=crop';

export function Login() {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const { user, profile, profileError } = useAuth();

  useEffect(() => {
    if (user && profile) {
      if (profile.role === 'merchant') navigate('/merchant');
      else if (profile.role === 'admin') navigate('/admin');
      else navigate('/shops');
    }
  }, [user, profile, navigate]);

  useEffect(() => {
    if (profileError) {
      setLoading(false);
      setErrorMsg('Failed to load user profile. Please try logging in again.');
    }
  }, [profileError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!formData.email || !formData.password) {
      setErrorMsg('Please enter your email and password.');
      toast.error('Please enter your email and password.');
      return;
    }

    setLoading(true);

    // Step 1: Sign in with Supabase
    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password,
      });

    if (signInError) {
      setLoading(false);
      const msg = signInError.message || 'Failed to log in. Please try again.';
      setErrorMsg(msg);
      toast.error(msg);
      return;
    }

    // Wait for AuthContext to detect session, fetch profile, and trigger the useEffect
    toast.success('Welcome back! Redirecting…');
  };

  const handleForgotPassword = async () => {
    if (!formData.email) {
      toast.error('Please enter your email address first.');
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(formData.email);
    if (error) {
      const msg = error.message || 'Failed to send reset email.';
      setErrorMsg(msg);
      toast.error(msg);
    } else {
      toast.success('Password reset email sent! Check your inbox.');
      setShowForgotPassword(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* ── Left panel: image ── */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <img
          src={SIDE_IMAGE}
          alt="Friends laughing together"
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-orange-900/70 via-orange-700/50 to-transparent" />

        {/* Overlay text */}
        <div className="relative z-10 flex flex-col justify-end p-12 text-white">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.7 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <Gift className="w-8 h-8 text-orange-300" />
              <span className="text-3xl font-bold tracking-tight">KithLy</span>
            </div>
            <h2 className="text-4xl font-bold leading-tight mb-4">
              Send love, not just a link.
            </h2>
            <p className="text-lg text-white/80 max-w-sm">
              Real gifts from local shops, delivered with a personal touch.
              Because some moments deserve more than a text.
            </p>
          </motion.div>
        </div>
      </div>

      {/* ── Right panel: form ── */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-white">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent mb-1">
              KithLy
            </h1>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-3xl font-bold text-gray-900 mb-1">
              {showForgotPassword ? 'Reset password' : 'Welcome back'}
            </h2>
            <p className="text-gray-500 mb-8 text-sm">
              {showForgotPassword
                ? "Enter your email and we'll send a reset link."
                : 'Sign in to your KithLy account.'}
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Error banner */}
              {errorMsg && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                  {errorMsg}
                </div>
              )}

              {/* Email */}
              <div>
                <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="mt-1 rounded-xl h-12"
                  placeholder="you@example.com"
                  required
                />
              </div>

              {!showForgotPassword && (
                <>
                  {/* Password */}
                  <div>
                    <Label htmlFor="password" className="text-sm font-medium text-gray-700">
                      Password
                    </Label>
                    <div className="relative mt-1">
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        value={formData.password}
                        onChange={(e) =>
                          setFormData({ ...formData, password: e.target.value })
                        }
                        className="rounded-xl h-12 pr-12"
                        placeholder="Enter your password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>

                  {/* Forgot password */}
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => { setShowForgotPassword(true); setErrorMsg(''); }}
                      className="text-sm text-primary hover:text-primary/80 transition-colors hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                </>
              )}

              {/* Submit */}
              {showForgotPassword ? (
                <div className="space-y-3">
                  <Button
                    type="button"
                    onClick={handleForgotPassword}
                    className="w-full h-12 text-base rounded-xl bg-gradient-to-r from-primary to-primary-light hover:opacity-90 transition-all shadow-md hover:shadow-lg"
                  >
                    Send Reset Link
                  </Button>
                  <Button
                    type="button"
                    onClick={() => { setShowForgotPassword(false); setErrorMsg(''); }}
                    variant="outline"
                    className="w-full h-12 text-base rounded-xl"
                  >
                    Back to Login
                  </Button>
                </div>
              ) : (
                <Button
                  type="submit"
                  className="w-full h-12 text-base rounded-xl bg-gradient-to-r from-primary to-primary-light hover:opacity-90 transition-all shadow-md hover:shadow-lg"
                  disabled={loading}
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                      </svg>
                      Signing in…
                    </span>
                  ) : (
                    'Sign In'
                  )}
                </Button>
              )}

              {/* Sign up link */}
              {!showForgotPassword && (
                <p className="text-center text-sm text-gray-500">
                  Don&apos;t have an account?{' '}
                  <Link
                    to="/signup"
                    className="text-primary hover:text-primary/80 font-semibold transition-colors hover:underline"
                  >
                    Create one free
                  </Link>
                </p>
              )}
            </form>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
