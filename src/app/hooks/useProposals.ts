// Open suggestions, and answering them.
//
// Both go through `public` wrappers rather than kithly_reco directly, because
// PostgREST only exposes `public` -- see 20260914060000. Both are soft: if the
// recommender schema is gone they return nothing rather than raising, so a
// surface that shows suggestions degrades to a surface that shows none.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';

export interface ProposalItem {
  id: string;
  name: string;
  price_zmw: number;
  image_url: string | null;
  shop_id: string;
}

export interface Proposal {
  id: string;
  kind: 'bundle' | 'restock' | 'occasion' | 'complement' | string;
  surface: string;
  reason_code: string;
  reason_text: string;
  total_zmw: number | null;
  item_ids: string[];
  items: ProposalItem[];
  created_at: string;
}

export function useProposals(surface?: string) {
  const { user } = useAuth();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setProposals([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('my_proposals', {
        p_surface: surface ?? null,
      });
      if (error) throw error;
      setProposals((data as Proposal[]) ?? []);
    } catch (err) {
      // Quiet on purpose. A suggestion failing to load is not something to
      // tell somebody about -- they did not ask for one.
      console.error('[useProposals] load failed:', err);
      setProposals([]);
    } finally {
      setLoading(false);
    }
  }, [user, surface]);

  useEffect(() => {
    void load();
  }, [load]);

  const answer = useCallback(async (proposalId: string, accepted: boolean) => {
    // Removed from the list first. The answer is recorded server-side and the
    // person has already decided; leaving it on screen while a round trip
    // completes is how a dismissal gets clicked twice.
    setProposals((prev) => prev.filter((p) => p.id !== proposalId));
    try {
      const { error } = await supabase.rpc('answer_proposal', {
        p_proposal_id: proposalId,
        p_accepted: accepted,
      });
      if (error) throw error;
    } catch (err) {
      // Not restored on failure, deliberately. Re-showing something somebody
      // just declined is worse than losing one signal.
      console.error('[useProposals] answer failed:', err);
    }
  }, []);

  return { proposals, loading, answer, refresh: load };
}
