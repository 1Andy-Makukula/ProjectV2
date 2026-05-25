import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../../lib/supabaseClient';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { toast } from 'sonner';
import { Store, MapPin, ArrowRight, ShieldAlert } from 'lucide-react';
import { motion } from 'motion/react';

// ---------------------------------------------------------------------------
// MerchantOnboarding
// Allows an authenticated "sender" to register their physical shop and
// upgrade their account role to "merchant" in a single form submission.
//
// Uses `register_merchant_shop` RPC — atomic role + shop + merchant_shops on the server.
// ---------------------------------------------------------------------------

export function MerchantOnboarding() {
  const navigate = useNavigate();

  // Form fields
  const [businessName, setBusinessName] = useState('');
  const [location, setLocation] = useState('');

  // UI state
  const [loading, setLoading] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [userId, setUserId] = useState<string | null>(null);

  // ── Guard: ensure user is authenticated before rendering the form ──────────
  useEffect(() => {
    const checkSession = async () => {
      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user) {
        // Not logged in — redirect to login with a hint
        toast.error('You must be signed in to register a shop.');
        navigate('/login');
        return;
      }

      setUserId(data.user.id);
      setAuthChecking(false);
    };

    checkSession();
  }, [navigate]);

  // ── Form submission: three-step Supabase transaction ──────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    // Client-side validation
    if (!businessName.trim()) {
      setErrorMsg('Business name is required.');
      return;
    }
    if (!location.trim()) {
      setErrorMsg('Location is required.');
      return;
    }
    if (!userId) {
      setErrorMsg('Session expired. Please sign in again.');
      navigate('/login');
      return;
    }

    setLoading(true);

    try {
      const { data: result, error: rpcError } = await supabase.rpc('register_merchant_shop', {
        p_shop_name: businessName.trim(),
        p_location: location.trim(),
      });

      if (rpcError) throw rpcError;
      if (!result?.success) {
        throw new Error('Shop registration failed.');
      }

      toast.success('Your shop has been submitted for review. You are now a merchant.');
      navigate('/merchant');
    } catch (err: any) {
      const message = err.message || 'Something went wrong. Please try again.';
      setErrorMsg(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  // ── Auth check loading state ───────────────────────────────────────────────
  if (authChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-orange-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50 flex flex-col">
      {/* Page header */}
      <div className="bg-gradient-to-r from-primary to-primary-light text-white">
        <div className="container mx-auto px-6 py-8 max-w-2xl">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="flex items-center gap-3 mb-2">
              <Store className="w-7 h-7 opacity-90" />
              <h1 className="text-3xl font-light tracking-tight">Become a Merchant</h1>
            </div>
            <p className="text-white/80 font-light text-sm ml-10">
              Register your physical shop and start receiving gift orders from KithLy customers.
            </p>
          </motion.div>
        </div>
      </div>

      {/* Form area */}
      <div className="flex-1 container mx-auto px-6 py-10 max-w-2xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1 }}
        >
          {/* Info notice */}
          <div className="flex items-start gap-3 bg-orange-50 border border-orange-200 rounded-xl px-5 py-4 mb-8">
            <ShieldAlert className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <p className="text-sm text-orange-800 leading-relaxed">
              Your shop will be submitted for admin review before it goes live. You will be
              able to manage your inventory and fulfil orders from your merchant dashboard
              once approved.
            </p>
          </div>

          {/* Card form */}
          <Card className="shadow-sm border border-gray-100">
            <CardHeader className="pb-2">
              <CardTitle className="text-xl font-medium text-gray-900">
                Shop Details
              </CardTitle>
              <CardDescription className="font-light">
                These details will be displayed to customers browsing KithLy.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6 pt-2">

                {/* Error banner */}
                {errorMsg && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                    {errorMsg}
                  </div>
                )}

                {/* Business Name */}
                <div className="space-y-2">
                  <Label htmlFor="businessName" className="text-sm font-medium text-gray-700">
                    Business Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="businessName"
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="e.g., Mama Chibwe Crafts"
                    className="h-11 rounded-lg"
                    disabled={loading}
                    required
                  />
                  <p className="text-xs text-gray-400 font-light">
                    Use your official trading name as it should appear to customers.
                  </p>
                </div>

                {/* Location */}
                <div className="space-y-2">
                  <Label htmlFor="location" className="text-sm font-medium text-gray-700">
                    Location <span className="text-red-500">*</span>
                  </Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    <Input
                      id="location"
                      type="text"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="e.g., Lusaka, Ndola, Kitwe"
                      className="h-11 rounded-lg pl-9"
                      disabled={loading}
                      required
                    />
                  </div>
                  <p className="text-xs text-gray-400 font-light">
                    Enter the city or area where your shop is physically located.
                  </p>
                </div>

                {/* Submit */}
                <div className="pt-2">
                  <Button
                    id="submit-merchant-onboarding"
                    type="submit"
                    disabled={loading}
                    className="w-full h-12 text-base rounded-xl bg-gradient-to-r from-primary to-primary-light hover:opacity-90 transition-opacity shadow-md group"
                  >
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <svg
                          className="animate-spin w-4 h-4"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <circle
                            className="opacity-25"
                            cx="12" cy="12" r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"
                          />
                        </svg>
                        Registering Shop...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        Register My Shop
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </span>
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Back link */}
          <p className="text-center text-sm text-gray-400 mt-6">
            Changed your mind?{' '}
            <button
              type="button"
              onClick={() => navigate('/home')}
              className="text-primary hover:underline font-medium transition-colors"
            >
              Return to Home
            </button>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
