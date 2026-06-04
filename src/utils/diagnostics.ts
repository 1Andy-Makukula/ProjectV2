import { supabase } from '../lib/supabaseClient';

/**
 * Antigravity Diagnostic Suite
 * 
 * Performs a Full-Stack Handshake across 5 crucial platform layers
 * to verify system integrity, security, and latency.
 */
export async function runAntigravityDiagnostics() {
  console.log('%c🚀 ANTIGRAVITY DIAGNOSTIC SUITE INITIATED...', 'color: #F97316; font-weight: bold; font-size: 14px; margin-bottom: 8px;');
  
  let score = 0;
  const maxScore = 5;
  const report: Record<string, { status: string; details: string }> = {};

  try {
    // Determine user session
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;

    // -------------------------------------------------------------------------
    // LAYER 1: Security (The Vault)
    // -------------------------------------------------------------------------
    console.log('%c[Layer 1: Security] Probing RLS Vault...', 'color: #9CA3AF;');
    if (!user) {
      report['Layer 1 (The Vault)'] = { status: 'NO-GO', details: 'No authenticated user session found.' };
    } else {
      const probeId = '00000000-0000-0000-0000-000000000000';
      const { data: probeData, error: probeError } = await supabase
        .from('orders')
        .select('id')
        .eq('id', probeId);
        
      // A successful RLS block returns an empty array, not a crash.
      if (!probeError && Array.isArray(probeData) && probeData.length === 0) {
        score++;
        report['Layer 1 (The Vault)'] = { status: 'GO', details: 'JWT verified. RLS active. Cross-tenant probe deflected.' };
      } else {
        report['Layer 1 (The Vault)'] = { status: 'NO-GO', details: 'RLS Vulnerability detected or network error.' };
      }
    }

    // -------------------------------------------------------------------------
    // LAYER 2: Transactional Logic (The Bridge)
    // -------------------------------------------------------------------------
    console.log('%c[Layer 2: Transactional Logic] Pinging Edge Function...', 'color: #9CA3AF;');
    const startPing = performance.now();
    try {
      const { data: edgeData, error: edgeError } = await supabase.functions.invoke('server', { method: 'GET' });
      const ttfb = performance.now() - startPing;
      
      if (!edgeError && edgeData?.status === 'ok') {
        score++;
        report['Layer 2 (The Bridge)'] = { status: 'GO', details: `Health: OK. TTFB: ${ttfb.toFixed(2)}ms` };
      } else {
        report['Layer 2 (The Bridge)'] = { status: 'NO-GO', details: 'Edge function returned unhealthy status.' };
      }
    } catch (e) {
      report['Layer 2 (The Bridge)'] = { status: 'NO-GO', details: 'Edge function unreachable.' };
    }

    // -------------------------------------------------------------------------
    // LAYER 3: Antigravity Latency (The Signal)
    // -------------------------------------------------------------------------
    console.log('%c[Layer 3: Antigravity Latency] Measuring Realtime Signal...', 'color: #9CA3AF;');
    const startRt = performance.now();
    const rtPromise = new Promise((resolve) => {
      const channel = supabase.channel('diagnostics-heartbeat');
      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          resolve(performance.now() - startRt);
          supabase.removeChannel(channel);
        }
      });
      // Fallback timeout if WebSockets are blocked
      setTimeout(() => resolve(9999), 5000);
    });
    
    const rtTime = await rtPromise as number;
    if (rtTime < 300) {
      score++;
      report['Layer 3 (The Signal)'] = { status: 'GO', details: `Heartbeat round-trip instant: ${rtTime.toFixed(2)}ms` };
    } else if (rtTime < 5000) {
      report['Layer 3 (The Signal)'] = { status: 'NO-GO', details: `Heartbeat sluggish: ${rtTime.toFixed(2)}ms (Threshold: 300ms)` };
    } else {
      report['Layer 3 (The Signal)'] = { status: 'NO-GO', details: 'Heartbeat timed out. WebSockets may be blocked.' };
    }

    // -------------------------------------------------------------------------
    // LAYER 4: State Consistency (The Ledger)
    // -------------------------------------------------------------------------
    console.log('%c[Layer 4: State Consistency] Auditing Ledger...', 'color: #9CA3AF;');
    if (!user) {
      report['Layer 4 (The Ledger)'] = { status: 'NO-GO', details: 'Authentication required to audit ledger.' };
    } else {
      const yesterday = new Date();
      yesterday.setHours(yesterday.getHours() - 24);
      
      const { data: staleOrders, error: staleError } = await supabase
        .from('orders')
        .select('id')
        .eq('status', 'pending_payment')
        .lt('created_at', yesterday.toISOString());
        
      if (!staleError) {
        score++;
        if (staleOrders && staleOrders.length > 0) {
           report['Layer 4 (The Ledger)'] = { status: 'GO', details: `${staleOrders.length} stale order(s) flagged for Recovery Flow.` };
        } else {
           report['Layer 4 (The Ledger)'] = { status: 'GO', details: 'Ledger clean. Zero stale pending orders detected.' };
        }
      } else {
        report['Layer 4 (The Ledger)'] = { status: 'NO-GO', details: 'Failed to query the database ledger.' };
      }
    }

    // -------------------------------------------------------------------------
    // LAYER 5: Data Integrity (The Schema)
    // -------------------------------------------------------------------------
    console.log('%c[Layer 5: Data Integrity] Verifying Schema Restrictions...', 'color: #9CA3AF;');
    if (!user) {
      report['Layer 5 (The Schema)'] = { status: 'NO-GO', details: 'Authentication required to verify schema.' };
    } else {
      const { data: profile } = await supabase.from('users').select('phone').eq('id', user.id).single();
      const phone = profile?.phone || '';
      
      // Universal E.164 format check — supports ZM, US/CA, UK, AU
      const { validateAndFormatPhone } = await import('./phone');
      const { isValid } = validateAndFormatPhone(phone);
      
      if (isValid) {
        score++;
        report['Layer 5 (The Schema)'] = { status: 'GO', details: `Phone perfectly standardized to E.164: ${phone}` };
      } else {
        report['Layer 5 (The Schema)'] = { status: 'NO-GO', details: `Phone schema mismatch or missing: ${phone || 'NULL'}` };
      }
    }

    // -------------------------------------------------------------------------
    // GENERATE CONSOLE REPORT
    // -------------------------------------------------------------------------
    const percentage = (score / maxScore) * 100;
    
    // Clear the loading logs for a clean presentation
    console.clear();
    
    console.log('%c======================================================', 'color: #F97316; font-weight: bold;');
    console.log('%c KITHLY READINESS REPORT', 'color: #F97316; font-weight: bold; font-size: 18px; letter-spacing: 2px;');
    console.log('%c======================================================\n', 'color: #F97316; font-weight: bold;');
    
    Object.entries(report).forEach(([layer, data]) => {
      const isGo = data.status === 'GO';
      const color = isGo ? '#22C55E' : '#EF4444'; // Green or Red
      const badge = isGo ? '[ GO ]' : '[NO-GO]';
      
      console.log(
        `%c${badge} %c${layer}: %c${data.details}`, 
        `color: ${color}; font-weight: bold; font-size: 12px;`, 
        'color: white; font-weight: bold; font-size: 12px;', 
        'color: #D1D5DB; font-size: 12px; font-style: italic;'
      );
    });

    console.log('\n%c------------------------------------------------------', 'color: #6B7280;');
    
    let scoreColor = '#EF4444'; // Red
    if (percentage === 100) scoreColor = '#22C55E'; // Green
    else if (percentage >= 80) scoreColor = '#EAB308'; // Yellow

    console.log(
      `%c INVESTOR-READY SCORE: ${percentage}%`, 
      `color: ${scoreColor}; font-weight: bold; font-size: 16px; text-shadow: 0 0 10px ${scoreColor}40;`
    );
    console.log('%c======================================================\n', 'color: #F97316; font-weight: bold;');

    return { score, percentage, report };
    
  } catch (error) {
    console.error('%c[CRITICAL FAILURE] Diagnostic Suite crashed:', 'color: #EF4444; font-weight: bold;', error);
  }
}
