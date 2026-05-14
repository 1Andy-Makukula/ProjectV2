import { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Eye, EyeOff, Gift } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'motion/react';

// HD lifestyle image from Unsplash — family celebrating together
const SIDE_IMAGE =
  'https://images.unsplash.com/photo-1511895426328-dc8714191011?w=1200&q=80&fit=crop';

export function SignUp() {
  const navigate = useNavigate();
  const { signUp } = useAuth();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '+260',
    password: '',
    confirmPassword: '',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!formData.name || !formData.email || !formData.phone || !formData.password) {
      const msg = 'All fields are required.';
      setErrorMsg(msg);
      toast.error(msg);
      return;
    }

    if (formData.password.length < 8) {
      const msg = 'Password must be at least 8 characters.';
      setErrorMsg(msg);
      toast.error(msg);
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      const msg = 'Passwords do not match.';
      setErrorMsg(msg);
      toast.error(msg);
      return;
    }

    if (!formData.email.includes('@')) {
      const msg = 'Please enter a valid email address.';
      setErrorMsg(msg);
      toast.error(msg);
      return;
    }

    setLoading(true);

    const { error } = await signUp(
      formData.email,
      formData.password,
      formData.name,
      formData.phone
    );

    setLoading(false);

    if (error) {
      const msg = error.message || 'Failed to create account. Please try again.';
      setErrorMsg(msg);
      toast.error(msg);
    } else {
      toast.success('Account created! Welcome to KithLy 🎉');
      navigate('/dashboard');
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* ── Left panel: image ── */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <img
          src={SIDE_IMAGE}
          alt="Happy family celebrating together"
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-orange-900/70 via-orange-700/50 to-transparent" />

        {/* Overlay branding */}
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
              The people you love deserve something real.
            </h2>
            <p className="text-lg text-white/80 max-w-sm">
              Join thousands of gift-senders who make moments memorable
              with local experiences and heartfelt surprises.
            </p>

            {/* Social proof */}
            <div className="flex items-center gap-4 mt-8">
              <div className="flex -space-x-2">
                {[
                  'https://i.pravatar.cc/40?img=1',
                  'https://i.pravatar.cc/40?img=5',
                  'https://i.pravatar.cc/40?img=9',
                  'https://i.pravatar.cc/40?img=12',
                ].map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt="User"
                    className="w-9 h-9 rounded-full border-2 border-white object-cover"
                  />
                ))}
              </div>
              <p className="text-sm text-white/90">
                <span className="font-bold">2,400+</span> happy senders this month
              </p>
            </div>
          </motion.div>
        </div>
      </div>

      {/* ── Right panel: form ── */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-white overflow-y-auto">
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
            <h2 className="text-3xl font-bold text-gray-900 mb-1">Create your account</h2>
            <p className="text-gray-500 mb-8 text-sm">
              Free forever. No credit card needed.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Error banner */}
              {errorMsg && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                  {errorMsg}
                </div>
              )}

              {/* Full Name */}
              <div>
                <Label htmlFor="name" className="text-sm font-medium text-gray-700">
                  Full Name
                </Label>
                <Input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="mt-1 rounded-xl h-12"
                  placeholder="John Doe"
                  required
                />
              </div>

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

              {/* Phone */}
              <div>
                <Label htmlFor="phone" className="text-sm font-medium text-gray-700">
                  Phone Number
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="mt-1 rounded-xl h-12"
                  placeholder="+260 XXX XXX XXX"
                  required
                />
              </div>

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
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="rounded-xl h-12 pr-12"
                    placeholder="At least 8 characters"
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

              {/* Confirm Password */}
              <div>
                <Label htmlFor="confirmPassword" className="text-sm font-medium text-gray-700">
                  Confirm Password
                </Label>
                <div className="relative mt-1">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={formData.confirmPassword}
                    onChange={(e) =>
                      setFormData({ ...formData, confirmPassword: e.target.value })
                    }
                    className="rounded-xl h-12 pr-12"
                    placeholder="Re-enter your password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition-colors"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="w-5 h-5" />
                    ) : (
                      <Eye className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <Button
                type="submit"
                className="w-full h-12 text-base rounded-xl bg-gradient-to-r from-primary to-primary-light hover:opacity-90 transition-all shadow-md hover:shadow-lg mt-2"
                disabled={loading}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                    </svg>
                    Creating Account…
                  </span>
                ) : (
                  'Create Account'
                )}
              </Button>

              {/* Login link */}
              <p className="text-center text-sm text-gray-500 pt-1">
                Already have an account?{' '}
                <Link
                  to="/login"
                  className="text-primary hover:text-primary/80 font-semibold transition-colors hover:underline"
                >
                  Sign in
                </Link>
              </p>
            </form>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
