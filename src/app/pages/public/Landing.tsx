import { useNavigate } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { useEffect } from 'react';
import { Gift, Send, Package } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '../../components/ui/button';

export function Landing() {
  const navigate = useNavigate();
  const { user, profile, loading } = useAuth();

  useEffect(() => {
    if (!loading && user && profile) {
      // Auto-redirect based on role
      if (profile.role === 'admin') navigate('/admin');
      else if (profile.role === 'merchant') navigate('/merchant');
      else navigate('/home');
    }
  }, [loading, user, profile, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Hero Section */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 max-w-4xl mx-auto text-center">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-5xl font-bold bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
            KithLy
          </h1>
        </motion.div>

        {/* Headline */}
        <motion.h2
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-3xl md:text-4xl font-medium text-foreground mb-4"
        >
          Send real experiences to the people you love, anywhere
        </motion.h2>

        {/* Subheadline */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-lg text-muted-foreground mb-12 max-w-2xl"
        >
          Choose a gift from local shops, send it with a personal message, and let
          your recipient collect it in person. Simple, thoughtful, and real.
        </motion.p>

        {/* Feature Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 w-full max-w-3xl"
        >
          <div className="flex flex-col items-center p-6 bg-accent rounded-2xl">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Gift className="w-7 h-7 text-primary" />
            </div>
            <h3 className="font-medium text-lg mb-2">Buy</h3>
            <p className="text-sm text-muted-foreground">
              Choose a gift from curated local shops
            </p>
          </div>

          <div className="flex flex-col items-center p-6 bg-accent rounded-2xl">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Send className="w-7 h-7 text-primary" />
            </div>
            <h3 className="font-medium text-lg mb-2">Send</h3>
            <p className="text-sm text-muted-foreground">
              Share it via WhatsApp with a personal message
            </p>
          </div>

          <div className="flex flex-col items-center p-6 bg-accent rounded-2xl">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Package className="w-7 h-7 text-primary" />
            </div>
            <h3 className="font-medium text-lg mb-2">Receive</h3>
            <p className="text-sm text-muted-foreground">
              They collect it in person with a QR code
            </p>
          </div>
        </motion.div>

        {/* CTA Buttons */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="flex flex-col sm:flex-row gap-4"
        >
          <Button
            onClick={() => navigate('/signup')}
            className="px-8 py-6 text-lg rounded-full bg-gradient-to-r from-primary to-primary-light hover:shadow-lg"
          >
            Get Started
          </Button>

          <Button
            onClick={() => navigate('/login')}
            variant="outline"
            className="px-8 py-6 text-lg rounded-full"
          >
            Already have an account?
          </Button>
        </motion.div>
      </div>

      {/* Footer */}
      <div className="py-6 text-center text-sm text-muted-foreground border-t">
        <p>KithLy © 2026 - Send experiences, not just gifts</p>
      </div>
    </div>
  );
}
