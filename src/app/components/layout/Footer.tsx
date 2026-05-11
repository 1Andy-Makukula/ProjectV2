// KithLy Footer - Professional Sticky Global Footer

import { useNavigate } from 'react-router';
import { Gift, Facebook, Twitter, Instagram, Mail, Phone, MessageCircle } from 'lucide-react';

export function Footer() {
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-gray-50 border-t border-border mt-auto">
      <div className="container mx-auto px-4 md:px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center">
                <Gift className="w-5 h-5 text-white" strokeWidth={1.5} />
              </div>
              <span className="text-xl font-light">KithLy</span>
            </div>
            <p className="text-sm font-light text-muted-foreground">
              Zambia's trusted gift marketplace. Buy now, gift later.
            </p>
            <div className="flex gap-3">
              <a href="https://facebook.com" target="_blank" rel="noopener noreferrer" className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                <Facebook className="w-4 h-4" strokeWidth={1.5} />
              </a>
              <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                <Instagram className="w-4 h-4" strokeWidth={1.5} />
              </a>
              <a href="https://wa.me/260977000000" target="_blank" rel="noopener noreferrer" className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                <MessageCircle className="w-4 h-4" strokeWidth={1.5} />
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-medium mb-4">Marketplace</h3>
            <ul className="space-y-2 text-sm font-light text-muted-foreground">
              <li><button onClick={() => navigate('/shops')} className="hover:text-[#F97316] transition-colors">Browse Shops</button></li>
              <li><button onClick={() => navigate('/')} className="hover:text-[#F97316] transition-colors">Popular Gifts</button></li>
              <li><button onClick={() => navigate('/about')} className="hover:text-[#F97316] transition-colors">About Us</button></li>
              <li><button onClick={() => navigate('/support')} className="hover:text-[#F97316] transition-colors">Help & Support</button></li>
            </ul>
          </div>

          {/* Legal & Policies */}
          <div>
            <h3 className="font-medium mb-4">Legal</h3>
            <ul className="space-y-2 text-sm font-light text-muted-foreground">
              <li><button onClick={() => navigate('/terms')} className="hover:text-[#F97316] transition-colors">Terms of Service</button></li>
              <li><button onClick={() => navigate('/privacy')} className="hover:text-[#F97316] transition-colors">Privacy Policy</button></li>
              <li><button onClick={() => navigate('/merchant-agreement')} className="hover:text-[#F97316] transition-colors">Merchant Agreement</button></li>
              <li><button onClick={() => navigate('/support')} className="hover:text-[#F97316] transition-colors">Refunds & Disputes</button></li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="font-medium mb-4">Contact</h3>
            <ul className="space-y-3 text-sm font-light text-muted-foreground">
              <li className="flex items-center gap-2">
                <Phone className="w-4 h-4" strokeWidth={1.5} />
                <span>+260 977 000 000</span>
              </li>
              <li className="flex items-center gap-2">
                <Mail className="w-4 h-4" strokeWidth={1.5} />
                <span>support@kithly.zm</span>
              </li>
            </ul>
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs font-light text-muted-foreground">
                Licensed by Zambia Revenue Authority
              </p>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-12 pt-8 border-t border-border flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm font-light text-muted-foreground">
            © {currentYear} KithLy. All rights reserved.
          </p>
          <div className="flex gap-6 text-xs font-light text-muted-foreground">
            <span>Made with care in Zambia</span>
            <span>•</span>
            <span>Airtel Money & MTN Mobile Money accepted</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
