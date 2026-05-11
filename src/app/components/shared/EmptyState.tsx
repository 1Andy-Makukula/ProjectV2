// Empty State Component

import { LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-16 px-4"
    >
      <div className="w-20 h-20 mb-6 rounded-2xl bg-gray-100 flex items-center justify-center">
        <Icon className="w-10 h-10 text-muted-foreground" strokeWidth={1.5} />
      </div>
      <h3 className="text-xl font-light text-black mb-2">{title}</h3>
      <p className="text-sm font-light text-muted-foreground text-center max-w-sm mb-6">
        {description}
      </p>
      {action && (
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={action.onClick}
          className="px-6 py-3 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-full font-light shadow-lg"
        >
          {action.label}
        </motion.button>
      )}
    </motion.div>
  );
}
