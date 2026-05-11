const { createClient } = require('@supabase/supabase-js');
const url1 = 'https://bllymuyxnbnkcutnxcek.supabase.co';
const key1 = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJsbHltdXl4bmJua2N1dG54Y2VrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0NjkzMjIsImV4cCI6MjA5NDA0NTMyMn0.TMx72yWyF5d-CSN2JuJgadhuc-SOgzcoeWAGbf_oDiw';
const url2 = 'https://ghwrvqsoelpcoqdodrzu.supabase.co';
const key2 = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdod3J2cXNvZWxwY29xZG9kcnp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NDU2MTUsImV4cCI6MjA5MjIyMTYxNX0.zSSiWCJCLinK4F8nw-SRtne0lUfQsEYxtQ4STDR6PY0';

async function test(name, url, key) {
  try {
    console.log('-----------------------------------');
    console.log(`Testing connection for: ${name}`);
    console.log(`URL: ${url}`);
    const supabase = createClient(url, key);
    
    // Test 1: Health check using auth.getSession()
    console.log(`[1/2] Checking Auth API connection...`);
    const { data: authData, error: authError } = await supabase.auth.getSession();
    
    if (authError) {
      console.log(`[!] Auth Check Failed: ${authError.message}`);
    } else {
      console.log(`[✓] Auth Check Succeeded.`);
    }

    // Test 2: Checking basic table access (assuming a 'users' or 'profiles' table might exist, though we just check if it throws a network error)
    console.log(`[2/2] Checking Database API connection...`);
    const { error: dbError } = await supabase.from('_non_existent_table_test').select('*').limit(1);
    
    // A network error would look different from a relation does not exist error
    if (dbError && dbError.message.includes('FetchError')) {
      console.log(`[!] Database Check Failed (Network Error): ${dbError.message}`);
    } else if (dbError) {
      console.log(`[✓] Database Connection Succeeded (Received expected DB error: ${dbError.message})`);
    } else {
      console.log(`[✓] Database Connection Succeeded.`);
    }
  } catch(e) {
    console.log(`[!] Unexpected Exception: ${e.message}`);
  }
}

async function run() {
  await test('Configuration 1 (from info.tsx)', url1, key1);
  await test('Configuration 2 (from .env)', url2, key2);
}

run();
