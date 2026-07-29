import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../../lib/supabaseClient';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { toast } from 'sonner';
import { Store, MapPin, ArrowRight, ShieldAlert, Check, Package, ConciergeBell } from 'lucide-react';
import { motion } from 'motion/react';

// What the shop intends to sell. This decides which item types the merchant is
// offered when they start building a catalogue.
const OFFERING_CHOICES = [
  {
    value: 'products' as const,
    label: 'Products',
    description: 'Physical goods collected from your shop.',
    icon: Package,
  },
  {
    value: 'services' as const,
    label: 'Services',
    description: 'Work you carry out for the recipient.',
    icon: ConciergeBell,
  },
  {
    value: 'both' as const,
    label: 'Both',
    description: 'You sell goods and provide services.',
    icon: Store,
  },
];

type Offering = (typeof OFFERING_CHOICES)[number]['value'];

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
  const [physicalAddress, setPhysicalAddress] = useState('');
  const [offering, setOffering] = useState<Offering>('products');

  // Storage files / paths
  const [nrcPath, setNrcPath] = useState('');
  const [pacraPath, setPacraPath] = useState('');
  const [uploadingNrc, setUploadingNrc] = useState(false);
  const [uploadingPacra, setUploadingPacra] = useState(false);

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

  // ── Document Uploader Helper ──────────────────────────────────────────────
  const handleFileUpload = async (file: File, docType: 'nrc' | 'pacra') => {
    if (!userId) return;
    const setUploading = docType === 'nrc' ? setUploadingNrc : setUploadingPacra;
    const setPath = docType === 'nrc' ? setNrcPath : setPacraPath;

    setUploading(true);
    setErrorMsg('');
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${docType}-${Date.now()}.${fileExt}`;
      const filePath = `${userId}/${fileName}`;

      const { data, error } = await supabase.storage
        .from('merchant-documents')
        .upload(filePath, file, {
          upsert: true
        });

      if (error) throw error;
      setPath(data.path);
      toast.success(`${docType.toUpperCase()} document uploaded successfully.`);
    } catch (err: any) {
      console.error(err);
      toast.error(`Failed to upload ${docType.toUpperCase()}: ${err.message}`);
      setErrorMsg(`Failed to upload ${docType.toUpperCase()}: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

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
      setErrorMsg('Location/City is required.');
      return;
    }
    if (!physicalAddress.trim()) {
      setErrorMsg('Physical address is required.');
      return;
    }
    if (!nrcPath) {
      setErrorMsg('NRC document upload is required.');
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
        p_physical_address: physicalAddress.trim(),
        p_nrc_url: nrcPath,
        p_pacra_url: pacraPath || null,
        p_offers_products: offering === 'products' || offering === 'both',
        p_offers_services: offering === 'services' || offering === 'both',
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
    <div className="min-h-screen bg-[#FAFAFA] flex flex-col">
      {/* Page header */}
      <div className="kl-gradient-brand text-white shadow-sm">
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
          <div className="flex items-start gap-3 bg-orange-50 border border-orange-200/80 rounded-2xl px-5 py-4 mb-8">
            <ShieldAlert className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <p className="text-sm text-orange-850 leading-relaxed">
              Your shop will be submitted for admin review before it goes live. You will be
              able to manage your inventory and fulfil orders from your merchant dashboard
              once approved.
            </p>
          </div>

          {/* Card form */}
          <Card className="border border-slate-200/60 bg-white/70 backdrop-blur-md shadow-sm rounded-3xl overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-xl font-medium text-slate-900 tracking-tight">
                Shop Details
              </CardTitle>
              <CardDescription className="text-slate-500 font-light">
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
                  <Label htmlFor="businessName" className="text-sm font-medium text-slate-700">
                    Business Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="businessName"
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="e.g., Mama Chibwe Crafts"
                    className="h-11 rounded-xl border-slate-200 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all duration-200"
                    disabled={loading}
                    required
                  />
                  <p className="text-xs text-slate-400 font-light">
                    Use your official trading name as it should appear to customers.
                  </p>
                </div>

                {/* Location */}
                <div className="space-y-2">
                  <Label htmlFor="location" className="text-sm font-medium text-slate-700">
                    Location/City <span className="text-red-500">*</span>
                  </Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <Input
                      id="location"
                      type="text"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="e.g., Lusaka, Ndola, Kitwe"
                      className="h-11 rounded-xl pl-9 border-slate-200 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all duration-200"
                      disabled={loading}
                      required
                    />
                  </div>
                  <p className="text-xs text-slate-400 font-light">
                    Enter the city or area where your shop is physically located.
                  </p>
                </div>

                {/* What the shop offers */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-slate-700">
                    What do you offer? <span className="text-red-500">*</span>
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {OFFERING_CHOICES.map((choice) => {
                      const Icon = choice.icon;
                      const selected = offering === choice.value;
                      return (
                        <button
                          key={choice.value}
                          type="button"
                          aria-pressed={selected}
                          disabled={loading}
                          onClick={() => setOffering(choice.value)}
                          className={`flex flex-col items-start gap-1.5 rounded-xl border p-4 text-left
                                      transition-all duration-200 active:scale-[0.99]
                                      disabled:opacity-50 disabled:cursor-not-allowed
                                      ${selected
                                        ? 'border-primary bg-orange-50 shadow-sm'
                                        : 'border-slate-200 hover:border-slate-300'}`}
                        >
                          <Icon
                            className={`w-4 h-4 ${selected ? 'text-primary' : 'text-slate-400'}`}
                            strokeWidth={1.75}
                          />
                          <span className="text-sm font-medium text-slate-900">{choice.label}</span>
                          <span className="text-xs font-light leading-snug text-slate-500">
                            {choice.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-slate-400 font-light">
                    This decides what you can list. You can change it later from your shop settings.
                  </p>
                </div>

                {/* Physical Address */}
                <div className="space-y-2">
                  <Label htmlFor="physicalAddress" className="text-sm font-medium text-slate-700">
                    Physical Address <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="physicalAddress"
                    type="text"
                    value={physicalAddress}
                    onChange={(e) => setPhysicalAddress(e.target.value)}
                    placeholder="e.g., Plot 1234, Great East Road"
                    className="h-11 rounded-xl border-slate-200 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all duration-200"
                    disabled={loading}
                    required
                  />
                  <p className="text-xs text-slate-400 font-light">
                    Enter the detailed physical address of your shop.
                  </p>
                </div>

                {/* NRC File Upload */}
                <div className="space-y-2">
                  <Label htmlFor="nrcFile" className="text-sm font-medium text-slate-700">
                    National Registration Card (NRC) <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="nrcFile"
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file, 'nrc');
                    }}
                    className="h-11 rounded-xl border-slate-200 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all duration-200 file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-orange-50 file:text-primary hover:file:bg-orange-100"
                    disabled={loading || uploadingNrc}
                    required
                  />
                  {uploadingNrc && <p className="text-xs text-primary animate-pulse">Uploading NRC document...</p>}
                  {nrcPath && (
                    <p className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
                      <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} />
                      NRC uploaded: {nrcPath.split('/').pop()}
                    </p>
                  )}
                  <p className="text-xs text-slate-400 font-light">
                    Upload a scan or clear photo of your NRC (PDF or Image).
                  </p>
                </div>

                {/* PACRA File Upload */}
                <div className="space-y-2">
                  <Label htmlFor="pacraFile" className="text-sm font-medium text-slate-700">
                    PACRA Certificate (Optional)
                  </Label>
                  <Input
                    id="pacraFile"
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file, 'pacra');
                    }}
                    className="h-11 rounded-xl border-slate-200 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all duration-200 file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-orange-50 file:text-primary hover:file:bg-orange-100"
                    disabled={loading || uploadingPacra}
                  />
                  {uploadingPacra && <p className="text-xs text-primary animate-pulse">Uploading PACRA document...</p>}
                  {pacraPath && (
                    <p className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
                      <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} />
                      PACRA uploaded: {pacraPath.split('/').pop()}
                    </p>
                  )}
                  <p className="text-xs text-slate-400 font-light">
                    Upload your PACRA business registration certificate (PDF or Image).
                  </p>
                </div>

                {/* Submit */}
                <div className="pt-2">
                  <Button
                    id="submit-merchant-onboarding"
                    type="submit"
                    disabled={loading || uploadingNrc || uploadingPacra || !nrcPath || !businessName.trim() || !location.trim() || !physicalAddress.trim()}
                    className="w-full h-12 text-base rounded-xl kl-gradient-brand hover:opacity-90 active:scale-[0.98] transition-all duration-200 shadow-sm group disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
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
          <p className="text-center text-sm text-slate-400 mt-6">
            Changed your mind?{' '}
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
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
