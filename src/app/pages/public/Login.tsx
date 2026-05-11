import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

export function Login() {
  const navigate = useNavigate();
  const { signIn, resetPassword, profile, user, loading: authLoading } = useAuth();

  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  useEffect(() => {
    if (authLoading || !user || !profile) {
      return;
    }

    if (profile.role === 'admin') navigate('/admin');
    else if (profile.role === 'merchant') navigate('/merchant');
    else navigate('/home');
  }, [authLoading, navigate, profile, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.email || !formData.password) {
      toast.error('Please enter your email and password');
      return;
    }

    setLoading(true);

    const { error } = await signIn(formData.email, formData.password);

    setLoading(false);

    if (error) {
      toast.error(error.message || 'Failed to log in');
    } else {
      toast.success('Logged in successfully!');
    }
  };

  const handleForgotPassword = async () => {
    if (!formData.email) {
      toast.error('Please enter your email address');
      return;
    }

    const { error } = await resetPassword(formData.email);

    if (error) {
      toast.error(error.message || 'Failed to send reset email');
    } else {
      toast.success('Password reset email sent! Check your inbox.');
      setShowForgotPassword(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-gray-50">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent mb-2">
            KithLy
          </h1>
          <p className="text-muted-foreground">
            {showForgotPassword ? 'Reset your password' : 'Welcome back'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white p-8 rounded-2xl shadow-sm space-y-5">
          {/* Email */}
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="mt-1"
              placeholder="you@example.com"
              required
            />
          </div>

          {!showForgotPassword && (
            <>
              {/* Password */}
              <div>
                <Label htmlFor="password">Password</Label>
                <div className="relative mt-1">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) =>
                      setFormData({ ...formData, password: e.target.value })
                    }
                    placeholder="Enter your password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="w-5 h-5" />
                    ) : (
                      <Eye className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Forgot Password Link */}
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => setShowForgotPassword(true)}
                  className="text-sm text-primary hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            </>
          )}

          {/* Submit Button */}
          {showForgotPassword ? (
            <div className="space-y-3">
              <Button
                type="button"
                onClick={handleForgotPassword}
                className="w-full py-6 text-base rounded-full bg-gradient-to-r from-primary to-primary-light"
              >
                Send Reset Email
              </Button>
              <Button
                type="button"
                onClick={() => setShowForgotPassword(false)}
                variant="outline"
                className="w-full py-6 text-base rounded-full"
              >
                Back to Login
              </Button>
            </div>
          ) : (
            <Button
              type="submit"
              className="w-full py-6 text-base rounded-full bg-gradient-to-r from-primary to-primary-light"
              disabled={loading}
            >
              {loading ? 'Logging in...' : 'Login'}
            </Button>
          )}

          {/* Sign Up Link */}
          {!showForgotPassword && (
            <p className="text-center text-sm text-muted-foreground">
              Don't have an account?{' '}
              <Link to="/signup" className="text-primary hover:underline font-medium">
                Sign up
              </Link>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
