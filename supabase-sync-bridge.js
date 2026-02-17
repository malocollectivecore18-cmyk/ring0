// supabase-sync-bridge.js
// Lightweight bridge to improve Supabase integration without modifying original files.
// Load this AFTER your existing scripts (index (Copy).html / USER_MANAGEMENT_INTEGRATION.js)

(function() {
  function log(...args) { console.log('[supabase-bridge]', ...args); }

  // Wait until DOM + scripts define expected globals
  function waitFor(conditionFn, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function check() {
        try {
          if (conditionFn()) return resolve(true);
        } catch (e) {}
        if (Date.now() - start > timeout) return reject(new Error('timeout'));
        setTimeout(check, 100);
      })();
    });
  }

  async function initBridge() {
    try {
      await waitFor(() => typeof window !== 'undefined' && (window.supabaseClient || (window.supabase && typeof window.supabase.createClient === 'function')) , 8000);
    } catch (e) {
      log('Supabase client not available yet; bridge aborted');
      return;
    }

    // Prefer existing client; fall back to other exposed clients or create only if URL present
    let client = window.supabaseClient || window.supabaseContentClient || null;
    if (!client && window.supabase && window.SUPABASE_URL && window.SUPABASE_ANON_KEY) {
      try {
        client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
      } catch (e) {
        log('Failed to create supabase client from globals:', e.message || e);
        client = null;
      }
    }
    if (!client) {
      log('No supabase client could be resolved');
      return;
    }

    window.supabaseClient = client; // ensure global
    log('Using supabaseClient', !!client);

    // Hook into existing integration fetch/save functions if present
    const fetchUsers = window.fetchUsers || window.loadUsersFromSupabase || null;
    const fetchGroups = window.fetchGroups || window.loadGroupsFromSupabase || null;
    const fetchFields = window.fetchRegistrationFields || window.loadFrameworkFromSupabase || null;
    const fetchSettings = window.fetchRegistrationSettings || window.loadSettingsFromSupabase || null;

    // Upsert helpers (use existing if available, else fallback to direct client calls)
    const saveUser = typeof window.saveUserToSupabase === 'function' ? window.saveUserToSupabase : async (u) => {
      try { await client.from('users').upsert(u); log('upserted user fallback'); return true; } catch (e){ console.error(e); return false; }
    };
    const saveGroup = typeof window.saveGroupToSupabase === 'function' ? window.saveGroupToSupabase : async (g) => {
      try { await client.from('user_groups').upsert(g); log('upserted group fallback'); return true; } catch (e){ console.error(e); return false; }
    };
    const saveField = typeof window.saveFieldToSupabase === 'function' ? window.saveFieldToSupabase : async (f) => {
      try { await client.from('registration_fields').upsert(f); log('upserted field fallback'); return true; } catch (e){ console.error(e); return false; }
    };
    const saveSettings = (typeof window.saveRegistrationSettingsToSupabase === 'function') ? window.saveRegistrationSettingsToSupabase : (typeof window.updateRegistrationSettingsInSupabase === 'function' ? window.updateRegistrationSettingsInSupabase : async (s) => {
      try { await client.from('registration_settings').upsert(s); log('upserted settings fallback'); return true; } catch (e){ console.error(e); return false; }
    });

    // Wrap local save functions so they also call Supabase-compatible upserts
    if (typeof window.saveUserData === 'function') {
      const orig = window.saveUserData.bind(window);
      window.saveUserData = function(...args) {
        orig(...args);
        try {
          const users = window.userData || [];
          // Filter: only save users with a valid id to avoid null-id DB constraint errors
          const usersWithId = users.filter(u => u && u.id != null && typeof u.id !== 'undefined');
          usersWithId.forEach(u => {
            // try to call integration-aware saver (if it expects transformed shape it's okay)
            try { saveUser(u); } catch (e) { console.warn('user upsert failed for id:', u.id, e); }
          });
          if (usersWithId.length < users.length) {
            console.warn('⚠️ Filtered out', users.length - usersWithId.length, 'user(s) without valid id in saveUserData');
          }
        } catch (e) { console.warn('wrap saveUserData error', e); }
      };
      log('Wrapped saveUserData');
    }

    if (typeof window.saveGroups === 'function') {
      const orig = window.saveGroups.bind(window);
      window.saveGroups = function(...args) {
        orig(...args);
        try {
          const groups = window.groups || [];
          groups.forEach(g => { try { saveGroup(g); } catch (e){} });
        } catch (e) {}
      };
      log('Wrapped saveGroups');
    }

    // Subscribe to realtime changes on relevant tables and call existing fetchers
    try {
      client.channel('bridge:users')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, payload => {
          log('users change', payload.eventType, 'id:', payload.new?.id || payload.old?.id);
          
          // Handle DELETE: Remove instantly from table without reload
          if (payload.eventType === 'DELETE' && payload.old?.id) {
            try {
              const deletedId = payload.old.id;
              // Remove from userData array
              if (window.userData) {
                window.userData = window.userData.filter(u => u.id != deletedId);
              }
              // Remove from table if visible
              const row = document.querySelector(`[data-user-id="${deletedId}"]`);
              if (row) {
                row.remove();
                log('Removed row for user', deletedId);
              }
              return;
            } catch (e) {
              log('Error removing deleted user:', e);
            }
          }
          
          // Handle INSERT/UPDATE: Refresh table
          if (typeof fetchUsers === 'function') fetchUsers();
          else if (typeof window.populateUserTable === 'function') window.populateUserTable();
        })
        .subscribe();

      client.channel('bridge:user_groups')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'user_groups' }, payload => {
          log('user_groups change', payload.eventType);
          if (typeof fetchGroups === 'function') fetchGroups();
          else if (typeof window.populateGroups === 'function') window.populateGroups();
        })
        .subscribe();

      client.channel('bridge:registration_fields')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'registration_fields' }, payload => {
          log('registration_fields change', payload.eventType);
          if (typeof fetchFields === 'function') fetchFields();
        })
        .subscribe();

      client.channel('bridge:registration_settings')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'registration_settings' }, payload => {
          log('registration_settings change', payload.eventType);
          if (typeof fetchSettings === 'function') fetchSettings();
        })
        .subscribe();

      log('Realtime bridge subscriptions created');
    } catch (e) {
      console.warn('Could not create realtime subscriptions', e);
    }

    // Expose small helper for manual sync actions
    window.supabaseBridge = {
      saveUser: saveUser,
      saveGroup: saveGroup,
      saveField: saveField,
      saveSettings: saveSettings,
      client: client
    };

    log('Bridge initialized');
  }

  // Start the bridge after a short delay to let other scripts run
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initBridge, 300);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(initBridge, 300));
  }
})();
