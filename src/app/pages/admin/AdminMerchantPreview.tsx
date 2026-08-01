/**
 * AdminMerchantPreview
 *
 * Read-only "view as merchant" for support calls. The admin stays signed in as
 * themselves throughout — this is a scoped render of the merchant dashboard,
 * not impersonation. No session is swapped and no token is minted; every read
 * here is one the admin's own RLS grants already permit.
 */

import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { supabase } from '../../../lib/supabaseClient';
import { MerchantDashboard } from '../merchant/MerchantDashboard';

export function AdminMerchantPreview() {
  const { shopId } = useParams<{ shopId: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (!shopId) {
      navigate('/admin/shops', { replace: true });
      return;
    }

    // An admin reading a merchant's financials is exactly what the durable
    // action log exists to record. Fire-and-forget: a logging failure must
    // never block a support call.
    supabase
      .rpc('log_admin_action', {
        p_action: 'merchant.preview_viewed',
        p_target_type: 'shop',
        p_target_id: shopId,
      })
      .then(({ error }) => {
        if (error) {
          console.error('[AdminMerchantPreview] audit log failed:', error);
        }
      });
  }, [shopId, navigate]);

  if (!shopId) return null;

  return <MerchantDashboard readOnly previewShopId={shopId} />;
}

export default AdminMerchantPreview;
