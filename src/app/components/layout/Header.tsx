// KithLy Header - Global Navigation

import { ShoppingCart, User, Menu, Gift } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../../hooks/useAuth';
import { useCart } from '../../hooks/useCart';
import { Badge } from '../ui/badge';
import { SearchBar } from '../shared/SearchBar';

interface HeaderProps {
  onMenuClick?: () => void;
  onCartClick?: () => void;
  onProfileClick?: () => void;
  onLogoClick?: () => void;
}

export function Header({
  onMenuClick,
  onCartClick,
  onProfileClick,
  onLogoClick,
}: HeaderProps) {
  const { isAuthenticated, user } = useAuth();
  const { getTotalItems } = useCart();
  const cartItemCount = getTotalItems();

  return (
    <header className="sticky top-0 z-50 w-full bg-white/95 backdrop-blur-sm border-b border-border">
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Left: Menu + Logo */}
          <div className="flex items-center gap-4">
            <button
              onClick={onMenuClick}
              className="md:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Menu"
            >
              <Menu className="w-5 h-5" strokeWidth={1.5} />
            </button>

            <button
              onClick={onLogoClick}
              className="flex items-center gap-2 group"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center">
                <Gift className="w-5 h-5 text-white" strokeWidth={1.5} />
              </div>
              <span className="text-xl font-light tracking-tight text-black group-hover:bg-gradient-to-r group-hover:from-[#F97316] group-hover:to-[#FB923C] group-hover:bg-clip-text group-hover:text-transparent transition-all">
                KithLy
              </span>
            </button>
          </div>

          {/* Center: Search (Desktop) */}
          <div className="hidden md:flex flex-1 max-w-md mx-8">
            <SearchBar />
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            {/* Cart */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onCartClick}
              className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Shopping cart"
            >
              <ShoppingCart className="w-5 h-5" strokeWidth={1.5} />
              {cartItemCount > 0 && (
                <Badge className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white text-xs">
                  {cartItemCount}
                </Badge>
              )}
            </motion.button>

            {/* Profile */}
            {isAuthenticated ? (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={onProfileClick}
                className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center">
                  <span className="text-white text-sm font-light">
                    {user?.full_name?.charAt(0) || 'U'}
                  </span>
                </div>
                <span className="hidden md:inline text-sm font-light">
                  {user?.full_name?.split(' ')[0]}
                </span>
              </motion.button>
            ) : (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={onProfileClick}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-full font-light"
              >
                <User className="w-4 h-4" strokeWidth={1.5} />
                <span className="hidden md:inline">Sign In</span>
              </motion.button>
            )}
          </div>
        </div>

        {/* Mobile Search */}
        <div className="md:hidden pb-3">
          <SearchBar />
        </div>
      </div>
    </header>
  );
}
