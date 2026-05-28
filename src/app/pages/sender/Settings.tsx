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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/dashboard')}
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
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
          <Card>
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
                <Label htmlFor="name">Full Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="pl-10"
                    placeholder="Your full name"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    placeholder="your.email@example.com"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="pl-10"
                    placeholder="+260 977 123 456"
                  />
                </div>
              </div>

              <Button
                onClick={handleSaveProfile}
                disabled={!hasChanges || loading}
                className="w-full bg-gradient-to-r from-primary to-primary-light"
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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="w-5 h-5" />
                Security
              </CardTitle>
              <CardDescription>
                Manage your password and account security
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
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
                className="w-full"
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
          <Card className="border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-gray-900">
                <Store className="w-5 h-5 text-primary" />
                Own a Hardware Shop?
              </CardTitle>
              <CardDescription className="text-gray-600">
                Register your physical location to start receiving KithLy Escrow
                payments directly. List your products and let customers redeem
                gifts in-store — zero delivery, zero hassle.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-3 p-4 bg-white border border-orange-100 rounded-lg mb-4">
                <AlertCircle className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <p className="text-sm text-gray-700">
                  Your shop will be reviewed by the KithLy team before going live.
                  Once approved, you can manage inventory and fulfil orders from
                  your merchant dashboard.
                </p>
              </div>
              <Link to="/become-merchant">
                <Button
                  id="register-business-btn"
                  className="w-full bg-gradient-to-r from-primary to-primary-light hover:opacity-90 transition-opacity shadow-sm"
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
          <Card className="border-red-200">
            <CardHeader>
              <CardTitle className="text-red-600">Danger Zone</CardTitle>
              <CardDescription>
                Actions that affect your account access
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={handleLogout}
                variant="destructive"
                className="w-full"
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
