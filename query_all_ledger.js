import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://<YOUR_PROJECT_ID>.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '<YOUR_SUPABASE_SERVICE_ROLE_KEY>';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  try {
    const userId = 'd82595d9-ddad-4919-b9f1-7384bb3a2ddd'; // Ndabane Makukula

    // 1. Fetch wallet
    const { data: wallet } = await supabase
      .from('kithly_wallets')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!wallet) {
      console.log('No wallet found');
      return;
    }

    // 2. Fetch all ledger entries
    const { data: ledger, error: ledgerErr } = await supabase
      .from('wallet_ledger')
      .select('*')
      .eq('wallet_id', wallet.id)
      .order('created_at', { ascending: false });

    if (ledgerErr) throw ledgerErr;

    const expiryRefunds = ledger.filter(e => e.description.startsWith('REFUND_EXPIRY:'));
    const nonExpiryEntries = ledger.filter(e => !e.description.startsWith('REFUND_EXPIRY:'));

    console.log(`Total ledger entries: ${ledger.length}`);
    console.log(`Expiry refund entries: ${expiryRefunds.length}`);
    console.log(`Other entries: ${nonExpiryEntries.length}`);

    console.log('\n--- Non-Expiry Ledger Entries ---');
    console.log(nonExpiryEntries);

  } catch (err) {
    console.error(err);
  }
}

run();
