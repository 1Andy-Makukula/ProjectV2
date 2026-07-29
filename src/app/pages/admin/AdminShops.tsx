import { useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { Plus, Edit, Search, MapPin, Store, FileText, Check, X, MessageSquare } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Switch } from '../../components/ui/switch';
import { PageShell, PageBody } from '../../components/layout/PageShell';
import { AdminPageHeader } from '../../components/layout/AdminPageHeader';
import { useAdminShops } from '../../hooks/useAdminShops';
import { supabase } from '../../../lib/supabaseClient';
import { toast } from 'sonner';

export function AdminShops() {
  const navigate = useNavigate();
  const { shops, loading, toggleShopActive, approveShop, rejectShop } = useAdminShops();
  const [searchQuery, setSearchQuery] = useState('');

  // Tab & Modal State
  const [activeTab, setActiveTab] = useState<'all' | 'pending'>('all');
  const [rejectionModalOpen, setRejectionModalOpen] = useState(false);
  const [selectedShopId, setSelectedShopId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const filteredShops = searchQuery
    ? shops.filter(shop =>
        shop.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        shop.location?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : shops;

  const pendingShops = filteredShops.filter(shop => shop.verification_status === 'pending');
  const nonPendingShops = filteredShops.filter(shop => shop.verification_status !== 'pending');

  /** Opens a KithLy thread with the shop. Messages appear as from the platform. */
  const handleMessageShop = async (shopId: string, shopName: string) => {
    try {
      const { data, error } = await supabase.rpc('admin_start_conversation', {
        p_buyer_id: null,
        p_shop_id: shopId,
        p_subject: shopName,
      });
      if (error) throw error;
      navigate(`/admin/messages?c=${data}`);
    } catch (err: any) {
      toast.error(err.message ?? 'Could not open a conversation');
    }
  };

  const handleViewDocument = async (docPath: string | null | undefined) => {
    if (!docPath) {
      toast.error('No document was uploaded for this shop.');
      return;
    }
    try {
      const { data, error } = await supabase.storage
        .from('merchant-documents')
        .createSignedUrl(docPath, 60);

      if (error) throw error;
      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank');
      } else {
        throw new Error('Failed to generate signed URL.');
      }
    } catch (err: any) {
      console.error(err);
      toast.error(`Error opening document: ${err.message || err}`);
    }
  };

  return (
    <PageShell>
      <AdminPageHeader
        title="Manage Shops"
        subtitle="View and manage all storefronts"
        onBack={() => navigate('/admin')}
        actions={
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-white/60" />
              <Input
                placeholder="Search shops…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 w-full sm:w-48 bg-white/10 border-white/20 text-white placeholder:text-white/50 focus-visible:ring-white/30"
              />
            </div>
            <Button
              onClick={() => navigate('/admin/shops/new')}
              className="bg-white text-primary hover:bg-white/90 h-8 w-full sm:w-auto"
            >
              <Plus className="size-3.5" />
              Add Shop
            </Button>
          </div>
        }
      />
      <PageBody>
        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 mb-6">
          <button
            onClick={() => setActiveTab('all')}
            className={`py-2.5 px-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'all'
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            All Shops ({nonPendingShops.length})
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`py-2.5 px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'pending'
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            Pending Verifications
            {pendingShops.length > 0 && (
              <span className="bg-primary text-white text-xs px-2 py-0.5 rounded-full font-bold">
                {pendingShops.length}
              </span>
            )}
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-sm text-muted-foreground">Loading shops…</div>
        ) : activeTab === 'all' ? (
          nonPendingShops.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <p className="text-sm text-muted-foreground mb-4">
                  {searchQuery ? 'No shops match your search' : 'No shops yet'}
                </p>
                {!searchQuery && (
                  <Button onClick={() => navigate('/admin/shops/new')}>
                    <Plus className="size-3.5" />
                    Add Your First Shop
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {nonPendingShops.map((shop) => (
                <ShopCard
                  key={shop.id}
                  shop={shop}
                  onEdit={() => navigate(`/admin/shops/${shop.id}/edit`)}
                  onToggleActive={() => toggleShopActive(shop.id, shop.is_active)}
                  onClick={() => navigate(`/admin/shops/${shop.id}/items`)}
                />
              ))}
            </div>
          )
        ) : (
          /* Pending Verifications Tab */
          pendingShops.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <p className="text-sm text-muted-foreground mb-1">No pending shop verifications</p>
                <p className="text-xs text-slate-400 font-light">All submitted merchant applications have been processed.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {pendingShops.map((shop) => (
                <Card key={shop.id} className="overflow-hidden border border-slate-200 shadow-sm rounded-2xl bg-white p-5 flex flex-col justify-between space-y-4">
                  <div className="space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold text-base text-slate-900 leading-tight">{shop.name}</h3>
                        <p className="text-[10px] text-slate-400 mt-1">
                          {shop.created_at
                            ? `Submitted on ${new Date(shop.created_at).toLocaleDateString()}`
                            : 'Submission date unavailable'}
                        </p>
                      </div>
                      <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 text-[10px] py-0 px-2">Pending Review</Badge>
                    </div>

                    {/* Owner Information */}
                    <div className="bg-slate-50 rounded-xl p-3 space-y-1 text-xs text-slate-600">
                      <p className="font-semibold text-slate-800 text-xs mb-1">Owner Details</p>
                      <p><span className="text-slate-400 font-normal">Name:</span> <span className="font-medium text-slate-700">{shop.owner?.name || 'N/A'}</span></p>
                      <p><span className="text-slate-400 font-normal">Email:</span> <span className="font-medium text-slate-700">{shop.owner?.email || 'N/A'}</span></p>
                      <p><span className="text-slate-400 font-normal">Phone:</span> <span className="font-medium text-slate-700">{shop.owner?.phone || 'N/A'}</span></p>
                    </div>

                    {/* Location & Address */}
                    <div className="space-y-1 text-xs text-slate-600">
                      <p className="flex items-center gap-1"><MapPin className="size-3 text-slate-400 shrink-0" /> <strong>Location:</strong> {shop.location}</p>
                      {shop.physical_address && (
                        <p className="pl-4"><strong>Address:</strong> {shop.physical_address}</p>
                      )}
                    </div>

                    {/* Documents */}
                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewDocument(shop.nrc_url)}
                        className="flex-1 text-[11px] py-1 h-7.5 border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-1.5"
                      >
                        <FileText className="size-3" />
                        View NRC
                      </Button>
                      {shop.pacra_url ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewDocument(shop.pacra_url)}
                          className="flex-1 text-[11px] py-1 h-7.5 border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-1.5"
                        >
                          <FileText className="size-3" />
                          View PACRA
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled
                          className="flex-1 text-[11px] py-1 h-7.5 border-slate-100 text-slate-300 bg-slate-50 cursor-not-allowed"
                        >
                          No PACRA
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Reach the applicant before deciding */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleMessageShop(shop.id, shop.name)}
                    className="w-full text-[11px] py-1 h-7.5 border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-1.5"
                  >
                    <MessageSquare className="size-3" />
                    Message this shop
                  </Button>

                  {/* Approve/Reject Actions */}
                  <div className="flex gap-2 pt-3 border-t border-slate-100">
                    <Button
                      onClick={() => {
                        setSelectedShopId(shop.id);
                        setRejectionReason('');
                        setRejectionModalOpen(true);
                      }}
                      variant="destructive"
                      size="sm"
                      className="flex-1 h-8.5 rounded-xl font-semibold text-[11px] bg-red-55 text-red-650 hover:bg-red-100 hover:text-red-750 border-none shadow-none flex items-center justify-center gap-1"
                    >
                      <X className="size-3" />
                      Reject KYC
                    </Button>
                    <Button
                      onClick={() => approveShop(shop.id)}
                      size="sm"
                      className="flex-1 h-8.5 rounded-xl font-semibold text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white border-none flex items-center justify-center gap-1"
                    >
                      <Check className="size-3" />
                      Approve & Live
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )
        )}
      </PageBody>

      {/* Rejection Modal */}
      {rejectionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl border border-slate-200/50"
          >
            <h3 className="text-base font-semibold text-slate-900 mb-1">Reject KYC Verification</h3>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              Please enter the reason for rejecting this shop's KYC. This feedback will be saved to the database and shown to the merchant.
            </p>
            <textarea
              className="w-full h-28 border border-slate-200 rounded-2xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 transition-all resize-none"
              placeholder="e.g., NRC image is blurry or expired. Please upload a clear photo."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />
            <div className="flex justify-end gap-2 mt-5">
              <Button
                variant="outline"
                onClick={() => {
                  setRejectionModalOpen(false);
                  setSelectedShopId(null);
                }}
                className="rounded-xl px-4 py-2 text-xs font-semibold h-9"
              >
                Cancel
              </Button>
              <Button
                disabled={!rejectionReason.trim()}
                onClick={async () => {
                  if (selectedShopId && rejectionReason.trim()) {
                    await rejectShop(selectedShopId, rejectionReason.trim());
                    setRejectionModalOpen(false);
                    setSelectedShopId(null);
                  }
                }}
                className="bg-red-650 hover:bg-red-700 text-white rounded-xl px-4 py-2 text-xs font-semibold h-9 disabled:opacity-50 disabled:cursor-not-allowed border-none"
              >
                Confirm Rejection
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </PageShell>
  );
}

// Shop Card Component
function ShopCard({ shop, onEdit, onToggleActive, onClick }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18 }}
    >
      <Card className="overflow-hidden cursor-pointer">
        <div onClick={onClick}>
          {/* Image */}
          <div className="aspect-video bg-gradient-to-br from-primary-tint to-primary-tint-mid relative overflow-hidden">
            {shop.cover_image_url || shop.image_url ? (
              <img
                src={shop.cover_image_url || shop.image_url}
                alt={shop.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-3xl font-light text-primary/40">{shop.name.charAt(0)}</span>
              </div>
            )}
          </div>

          {/* Content */}
          <CardContent className="pt-3">
            <div className="flex items-start justify-between mb-1.5">
              <h3 className="font-medium text-sm tracking-tight">{shop.name}</h3>
              <Badge variant={shop.is_active ? 'tint' : 'secondary'}>
                {shop.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </div>

            {shop.location && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                <MapPin className="size-3" />
                <span>{shop.location}</span>
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              {shop.item_count || 0} active {shop.item_count === 1 ? 'item' : 'items'}
            </div>
          </CardContent>
        </div>

        {/* Actions */}
        <div className="px-4 pb-4 pt-3 flex items-center justify-between border-t border-border">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="text-primary hover:bg-primary-tint h-7 px-2"
            >
              <Edit className="size-3.5 mr-1" />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                window.open(`/shop/${shop.id}`, '_blank');
              }}
              className="text-slate-600 hover:bg-slate-100 h-7 px-2"
            >
              <Store className="size-3.5 mr-1" />
              Public View
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[0.6875rem] text-muted-foreground">
              {shop.is_active ? 'Active' : 'Inactive'}
            </span>
            <Switch
              checked={shop.is_active}
              onCheckedChange={() => { onToggleActive(); }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      </Card>
    </motion.div>
  );
}


