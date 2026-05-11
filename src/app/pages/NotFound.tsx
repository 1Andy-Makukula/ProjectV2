// KithLy 404 Page

import { useNavigate } from 'react-router';
import { MapPin } from 'lucide-react';
import { motion } from 'motion/react';

export function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
      >
        <MapPin className="w-20 h-20 mx-auto mb-6 text-muted-foreground" strokeWidth={1.5} />
        
        <h1 className="text-6xl font-light bg-gradient-to-r from-[#F97316] to-[#FB923C] bg-clip-text text-transparent mb-4">
          404
        </h1>
        
        <h2 className="text-2xl font-light text-black mb-2">
          Page Not Found
        </h2>
        
        <p className="text-sm font-light text-muted-foreground mb-8 max-w-md">
          The page you're looking for doesn't exist or has been moved.
        </p>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => navigate('/')}
          className="px-8 py-3 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-full font-light shadow-lg hover:shadow-xl transition-all"
        >
          Back to Home
        </motion.button>
      </motion.div>
    </div>
  );
}
