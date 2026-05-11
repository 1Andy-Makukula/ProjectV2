// Merchant Onboarding Portal

import { useState } from 'react';
import { Store, Upload, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import { districts } from '../data/mock-data';
import { toast } from 'sonner';

export function MerchantOnboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'form' | 'documents' | 'success'>('form');

  const [shopName, setShopName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [province, setProvince] = useState('');
  const [district, setDistrict] = useState('');
  const [area, setArea] = useState('');
  const [phone, setPhone] = useState('');
  const [tpin, setTpin] = useState('');

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    setStep('documents');
  };

  const handleSubmitDocuments = () => {
    setStep('success');
    toast.success('Application submitted for review!');
  };

  const categories = ['Food & Beverages', 'Electronics', 'Fashion & Clothing', 'Health & Beauty', 'Home & Garden', 'Sports & Recreation', 'Other'];
  const provinces = [...new Set(districts.map(d => d.province))];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 md:px-6 py-8 max-w-3xl">
        <AnimatePresence mode="wait">
          {step === 'form' && (
            <motion.div
              key="form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="text-center mb-8">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center">
                  <Store className="w-8 h-8 text-white" strokeWidth={1.5} />
                </div>
                <h1 className="text-3xl font-light text-black mb-2">Become a Merchant</h1>
                <p className="text-sm font-light text-muted-foreground">Join Zambia's trusted marketplace</p>
              </div>

              <div className="bg-white rounded-[1.5rem] p-8 border border-border">
                <form onSubmit={handleSubmitForm} className="space-y-6">
                  <div>
                    <label className="text-sm font-light text-muted-foreground mb-2 block">Shop Name *</label>
                    <input
                      type="text"
                      value={shopName}
                      onChange={(e) => setShopName(e.target.value)}
                      placeholder="e.g. Garden City Supermarket"
                      className="w-full px-4 py-3 border border-border rounded-full font-light focus:outline-none focus:border-[#F97316]"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-sm font-light text-muted-foreground mb-2 block">Business Description *</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Brief description of your business..."
                      rows={3}
                      className="w-full px-4 py-3 border border-border rounded-2xl font-light focus:outline-none focus:border-[#F97316] resize-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-sm font-light text-muted-foreground mb-2 block">Main Category *</label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full px-4 py-3 border border-border rounded-full font-light focus:outline-none focus:border-[#F97316]"
                      required
                    >
                      <option value="">Select category</option>
                      {categories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-sm font-light text-muted-foreground mb-2 block">Province *</label>
                      <select
                        value={province}
                        onChange={(e) => setProvince(e.target.value)}
                        className="w-full px-4 py-3 border border-border rounded-full font-light focus:outline-none focus:border-[#F97316]"
                        required
                      >
                        <option value="">Select</option>
                        {provinces.map(prov => (
                          <option key={prov} value={prov}>{prov}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-sm font-light text-muted-foreground mb-2 block">District *</label>
                      <select
                        value={district}
                        onChange={(e) => setDistrict(e.target.value)}
                        className="w-full px-4 py-3 border border-border rounded-full font-light focus:outline-none focus:border-[#F97316]"
                        required
                      >
                        <option value="">Select</option>
                        {districts.filter(d => d.province === province).map(dist => (
                          <option key={dist.id} value={dist.id}>{dist.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-sm font-light text-muted-foreground mb-2 block">Area *</label>
                      <input
                        type="text"
                        value={area}
                        onChange={(e) => setArea(e.target.value)}
                        placeholder="e.g. Cairo Road"
                        className="w-full px-4 py-3 border border-border rounded-full font-light focus:outline-none focus:border-[#F97316]"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-light text-muted-foreground mb-2 block">Contact Phone *</label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+260 977 123 456"
                        className="w-full px-4 py-3 border border-border rounded-full font-light focus:outline-none focus:border-[#F97316]"
                        required
                      />
                    </div>

                    <div>
                      <label className="text-sm font-light text-muted-foreground mb-2 block">TPIN *</label>
                      <input
                        type="text"
                        value={tpin}
                        onChange={(e) => setTpin(e.target.value)}
                        placeholder="1234567890"
                        className="w-full px-4 py-3 border border-border rounded-full font-light focus:outline-none focus:border-[#F97316]"
                        required
                      />
                    </div>
                  </div>

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    className="w-full py-4 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-full font-light shadow-lg"
                  >
                    Continue to Documents
                  </motion.button>
                </form>
              </div>
            </motion.div>
          )}

          {step === 'documents' && (
            <motion.div
              key="documents"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="text-center mb-8">
                <h1 className="text-3xl font-light text-black mb-2">Upload Documents</h1>
                <p className="text-sm font-light text-muted-foreground">Verify your business</p>
              </div>

              <div className="bg-white rounded-[1.5rem] p-8 border border-border space-y-6">
                <div className="p-8 border-2 border-dashed border-border rounded-2xl text-center hover:border-[#F97316] transition-colors cursor-pointer">
                  <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" strokeWidth={1.5} />
                  <p className="font-light text-black mb-1">TPIN Certificate</p>
                  <p className="text-xs font-light text-muted-foreground">PDF or image (max 5MB)</p>
                  <input type="file" className="hidden" accept=".pdf,.jpg,.png" />
                </div>

                <div className="p-8 border-2 border-dashed border-border rounded-2xl text-center hover:border-[#F97316] transition-colors cursor-pointer">
                  <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" strokeWidth={1.5} />
                  <p className="font-light text-black mb-1">National ID (Owner)</p>
                  <p className="text-xs font-light text-muted-foreground">PDF or image (max 5MB)</p>
                  <input type="file" className="hidden" accept=".pdf,.jpg,.png" />
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setStep('form')}
                    className="flex-1 py-4 border-2 border-border rounded-full font-light hover:bg-gray-50 transition-colors"
                  >
                    Back
                  </button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSubmitDocuments}
                    className="flex-1 py-4 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-full font-light shadow-lg"
                  >
                    Submit Application
                  </motion.button>
                </div>
              </div>
            </motion.div>
          )}

          {step === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <div className="text-center">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: 'spring' }}
                  className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center"
                >
                  <CheckCircle className="w-10 h-10 text-white" strokeWidth={2} />
                </motion.div>
                <h1 className="text-3xl font-light text-black mb-4">Application Submitted!</h1>
                <p className="text-sm font-light text-muted-foreground mb-8 max-w-md mx-auto">
                  We'll review your application within 2-3 business days and send a confirmation to your phone.
                </p>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => navigate('/')}
                  className="px-8 py-4 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-full font-light shadow-lg"
                >
                  Return Home
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
