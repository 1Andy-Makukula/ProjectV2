import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://mbjbrdhpjgfhhycijodz.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1iamJyZGhwamdmaGh5Y2lqb2R6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTM0Nzk1NSwiZXhwIjoyMDk0OTIzOTU1fQ.SjgLTTbUOFzPQuAjZNW6IQhCbzsqUMVEyKvBAFBlieM';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  try {
    const userId = 'd82595d9-ddad-4919-b9f1-7384bb3a2ddd'; // Ndabane Makukula

    // 1. Fetch transactions
    const { data: txs, error: txsErr } = await supabase
      .from('transactions')
      .select('*')
      .eq('buyer_id', userId)
      .order('created_at', { ascending: false });

    if (txsErr) throw txsErr;

    console.log('--- Transactions for Ndabane ---');
    txs.forEach(tx => {
      console.log(`TX ID: ${tx.transaction_id} | Status: ${tx.status} | Amount: ZMW ${tx.total_amount / 100} | Created: ${tx.created_at}`);
    });

    // 2. Fetch shop orders
    const { data: orders, error: ordersErr } = await supabase
      .from('shop_orders')
      .select('*, order_items(*)')
      .eq('transaction_id', txs.map(t => t.transaction_id)[0] || '00000000-0000-0000-0000-000000000000'); // Let's get details for the latest transaction if any

    console.log('\n--- Shop Orders for Latest Transaction ---');
    console.log(orders);

  } catch (err) {
    console.error('Error:', err);
  }
}

run();
