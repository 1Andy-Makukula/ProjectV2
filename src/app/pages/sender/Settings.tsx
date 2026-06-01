import { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Separator } from '../../components/ui/separator';
import { ArrowLeft, User, Mail, Phone, Lock, LogOut, Check, AlertCircle, Store, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';

export function Settings() {
  const navigate = useNavigate();
  const { profile, updateProfile, signOut, resetPassword } = useAuth();
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  // Form state
  const [name, setName] = useState(profile?.name || '');
  const [email, setEmail] = useState(profile?.email || '');
  const [phone, setPhone] = useState(profile?.phone || '');

  // Track if form has been modified
  const hasChanges =
    name !== profile?.name ||
    email !== profile?.email ||
    phone !== (profile?.phone || '');

  const handleSaveProfile = async () => {
    if (!hasChanges) return;

    setLoading(true);
    try {
      const updates: any = {};
      if (name !== profile?.name) updates.name = name;
      if (email !== profile?.email) updates.email = email;
      if (phone !== (profile?.phone || '')) updates.phone = phone;

      const { error } = await updateProfile(updates);

      if (error) throw error;

      toast.success('Profile updated successfully!');
    } catch (error: any) {
      console.error('Error updating profile:', error);
      toast.error(error.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!profile?.email) {
      toast.error('No email found');
      return;
    }

    setResetLoading(true);
    try {
      const { error } = await resetPassword(profile.email);

      if (error) throw error;

      toast.success('Password reset email sent! Check your inbox.');
    } catch (error: any) {
      console.error('Error sending reset email:', error);
      toast.error(error.message || 'Failed to send reset email');
    } finally {
      setResetLoading(false);
    }
  };

  const handleLogout = async (e: React.MouseEvent) => {
    e.preventDefault(); // 1. STOPS the annoying page refresh!
    
    try {
      // 2. Tell the data center to destroy the token
      await supabase.auth.signOut(); 
      
      // 3. Clear any leftover zombie data in the browser
      localStorage.clear(); 
      sessionStorage.clear();
      
      // 4. Safely redirect to the login page
      navigate('/login', { replace: true }); 
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* Header */}
      <div className="bg-white/50 border-b border-slate-200/60 sticky top-0 z-10 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/dashboard')}
              className="hover:bg-slate-100 active:scale-95 transition-all duration-200 rounded-lg"
            >
              <ArrowLeft className="w-5 h-5 text-slate-700" />
            </Button>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent tracking-tight">
              Settings
            </h1>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Account Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card className="border border-slate-200/60 bg-white/70 backdrop-blur-md shadow-sm rounded-3xl overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                Account Information
              </CardTitle>
              <CardDescription>
                Update your personal information
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-medium text-slate-750">Full Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="pl-10 rounded-xl border-slate-200 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all duration-200"
                    placeholder="Your full name"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium text-slate-750">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 rounded-xl border-slate-200 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all duration-200"
                    placeholder="your.email@example.com"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone" className="text-sm font-medium text-slate-750">Phone Number</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="pl-10 rounded-xl border-slate-200 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all duration-200"
                    placeholder="+260 977 123 456"
                  />
                </div>
              </div>

              <Button
                onClick={handleSaveProfile}
                disabled={!hasChanges || loading}
                className="w-full bg-gradient-to-r from-primary to-primary-light hover:opacity-90 active:scale-[0.98] transition-all duration-200 rounded-xl shadow-sm"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Save Changes
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        {/* Security Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="border border-slate-200/60 bg-white/70 backdrop-blur-md shadow-sm rounded-3xl overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-900">
                <Lock className="w-5 h-5" />
                Security
              </CardTitle>
              <CardDescription className="text-slate-500">
                Manage your password and account security
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-blue-50/50 border border-blue-100 rounded-2xl">
                <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-blue-900 font-medium">Change Password</p>
                  <p className="text-xs text-blue-700 mt-1">
                    We'll send a password reset link to your email address
                  </p>
                </div>
              </div>
              <Button
                onClick={handleResetPassword}
                disabled={resetLoading}
                variant="outline"
                className="w-full h-11 rounded-xl border-slate-200 hover:bg-slate-50 active:scale-[0.98] transition-all duration-200"
              >
                {resetLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4 mr-2" />
                    Change Password
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        {/* Account Upgrade */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card className="border border-orange-200/80 bg-gradient-to-br from-orange-50/70 to-amber-50/70 backdrop-blur-md shadow-sm rounded-3xl overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-900">
                <Store className="w-5 h-5 text-primary" />
                Own a Hardware Shop?
              </CardTitle>
              <CardDescription className="text-slate-650 font-light">
                Register your physical location to start receiving KithLy Escrow
                payments directly. List your products and let customers redeem
                gifts in-store — zero delivery, zero hassle.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-3 p-4 bg-white/80 border border-orange-100/60 rounded-2xl mb-4">
                <AlertCircle className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <p className="text-sm text-slate-700 leading-relaxed">
                  Your shop will be reviewed by the KithLy team before going live.
                  Once approved, you can manage inventory and fulfil orders from
                  your merchant dashboard.
                </p>
              </div>
              <Link to="/become-merchant">
                <Button
                  id="register-business-btn"
                  className="w-full h-12 text-base rounded-xl bg-gradient-to-r from-primary to-primary-light hover:opacity-90 active:scale-[0.98] transition-all duration-200 shadow-sm"
                >
                  <Store className="w-4 h-4 mr-2" />
                  Register Your Business
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </motion.div>

        {/* Danger Zone */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="border border-red-200/80 bg-red-50/20 backdrop-blur-md shadow-sm rounded-3xl overflow-hidden">
            <CardHeader>
              <CardTitle className="text-red-650">Danger Zone</CardTitle>
              <CardDescription className="text-slate-500 font-light">
                Actions that affect your account access
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={handleLogout}
                variant="destructive"
                className="w-full h-11 rounded-xl active:scale-[0.98] transition-all duration-200 shadow-sm"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Log Out
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        {/* App Info */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-center pt-4"
        >
          <Separator className="mb-6" />
          <div className="space-y-1">
            <p className="text-xl font-bold bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
              KithLy
            </p>
            <p className="text-xs text-muted-foreground">Version 1.0.0</p>
            <p className="text-xs text-muted-foreground">
              Made with care for meaningful gifting
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
