import { describe, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

describe('debug schema', () => {
  it('prints users table columns', async () => {
    const envFile = fs.readFileSync('.env', 'utf-8');
    const urlLine = envFile.split('\n').find(l => l.trim().startsWith('VITE_SUPABASE_URL='));
    const keyLine = envFile.split('\n').find(l => l.trim().startsWith('SUPABASE_SERVICE_ROLE_KEY='));
    
    const url = urlLine?.split('=')[1].trim().replace(/['"]/g, '');
    const serviceKey = keyLine?.split('=')[1].trim().replace(/['"]/g, '');
    
    console.log('URL:', url);
    
    const supabase = createClient(url!, serviceKey!, {
      auth: { persistSession: false }
    });
    
    // Try to query a dummy record or get column information
    const { data: usersData, error: usersError } = await supabase
      .from('users')
      .select('*')
      .limit(1);
      
    if (usersError) {
      console.error('Error fetching users:', usersError);
    } else {
      console.log('Users columns:', usersData && usersData.length > 0 ? Object.keys(usersData[0]) : 'No records to inspect columns');
    }

    // Let's run a direct query to get columns from pg_attribute if we can, using an RPC or another way?
    // Wait, we don't have a generic RPC to run raw SQL, but we can check if there are any users.
    const { data: countData, error: countError } = await supabase
      .from('users')
      .select('id')
      .limit(10);
    console.log('Users list:', countData, countError);
  });
});
