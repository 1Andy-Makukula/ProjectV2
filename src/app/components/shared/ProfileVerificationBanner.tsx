// KithLy Profile Verification Banner - "Restricted Mode" State

import { AlertCircle, Shield } from 'lucide-react';
import { motion } from 'motion/react';
import { Alert, AlertDescription } from '../ui/alert';
import { useAuth } from '../../hooks/useAuth';

interface ProfileVerificationBannerProps {
  onComplete?: () => void;
}

export function ProfileVerificationBanner({ onComplete }: ProfileVerificationBannerProps) {
  const { profile, checkProfileComplete } = useAuth();
  
  if (!profile || checkProfileComplete()) {
    return null;
  }

  const missingFields = [];
  if (!profile.nrc_number) missingFields.push('NRC');
  if (!profile.momo_number) missingFields.push('Mobile Money');
  if (!profile.district_id) missingFields.push('District');

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="sticky top-16 z-40"
    >
      <Alert className="rounded-none border-x-0 border-t-0 border-b-2 border-[#F97316] bg-orange-50">
        <div className="container mx-auto px-4 md:px-6">
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center">
                <Shield className="w-5 h-5 text-white" strokeWidth={1.5} />
              </div>
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-[#F97316] flex-shrink-0 mt-0.5" strokeWidth={1.5} />
                <AlertDescription className="font-light text-sm">
                  <span className="font-medium text-black">Restricted Mode Active.</span>
                  {' '}Complete your profile to unlock gifting. Missing: {missingFields.join(', ')}.
                </AlertDescription>
              </div>
            </div>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onComplete}
              className="flex-shrink-0 px-4 py-2 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-full font-light text-sm shadow-md"
            >
              Complete Profile
            </motion.button>
          </div>
        </div>
      </Alert>
    </motion.div>
  );
}
