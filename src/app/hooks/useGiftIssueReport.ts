import { useCallback, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

/**
 * Lets the gift RECIPIENT report a problem at the counter.
 *
 * The recipient has no account — that is deliberate, and it is why this exists.
 * Until now the only route for "the shop says this code is already used" was to
 * telephone the sender abroad and have them open a dispute about something they
 * did not witness. The claim code is the credential; `report_gift_issue` is
 * granted to `anon` for exactly this reason.
 *
 * Reporting has no financial effect. It records the complaint and notifies the
 * buyer; an admin decides what happens next through the existing refund paths.
 */

export const GIFT_ISSUE_TYPES = [
  { value: 'code_rejected', label: 'The shop says this code is already used' },
  { value: 'items_missing', label: 'Some items were missing' },
  { value: 'wrong_items', label: 'I was given the wrong items' },
  { value: 'shop_refused', label: 'The shop refused to serve me' },
  { value: 'shop_closed', label: "The shop is closed or I can't find it" },
  { value: 'other', label: 'Something else' },
] as const;

export type GiftIssueType = (typeof GIFT_ISSUE_TYPES)[number]['value'];

interface ReportArgs {
  claimCode: string;
  issueType: GiftIssueType;
  description?: string;
  contactPhone?: string;
}

interface ReportResult {
  success: boolean;
  report_id?: string;
  message?: string;
}

export function useGiftIssueReport() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const submitReport = useCallback(async (args: ReportArgs): Promise<boolean> => {
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('report_gift_issue', {
        p_claim_code: args.claimCode,
        p_issue_type: args.issueType,
        p_description: args.description?.trim() || null,
        p_contact_phone: args.contactPhone?.trim() || null,
      });

      if (rpcError) throw rpcError;

      const result = data as ReportResult | null;
      if (!result?.success) {
        throw new Error(result?.message ?? 'We could not record that. Please try again.');
      }

      setSubmitted(true);
      return true;
    } catch (err: unknown) {
      // The RPC raises readable, recipient-facing messages ("We could not find
      // a gift with that code"), so the Postgres message is worth showing here
      // rather than replacing with something generic.
      const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setError(message);
      return false;
    } finally {
      setSubmitting(false);
    }
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setSubmitted(false);
  }, []);

  return { submitReport, submitting, error, submitted, reset };
}
