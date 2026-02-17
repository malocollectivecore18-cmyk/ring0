// supabase-sync.js
// Load this script as a module AFTER your main UI script so window functions exist.
// Example include (put after your main scripts):
// <script type="module" src="/supabase-sync.js"></script>

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// === Supabase project config (from user) ===
const SUPABASE_URL = 'https://ybnvozrsmtjkxoyoyihi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlibnZvenJzbXRqa3hveW95aWhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxNTQ5ODAsImV4cCI6MjA4MzczMDk4MH0.ErY9Hhzua5lRUC-M_Zi5zm1XtIU0LzGA5Xa1Com8jC4';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 10 } }
});

// Local storage keys used by your app
const LS_KEYS = {
  users: 'ring0_user_data',
  groups: 'ring0_user_groups',
  framework: 'ring0_form_framework',
  settings: 'ring0_registration_settings'
};

// Convenience: safe console/log wrapper
function log(...args) { console.log('[supabase-sync]', ...args); }

// --- Initialization ---
async function initSupabaseSync() {
  log('Initializing Supabase sync...');
  // Load initial remote data and merge with local
  await loadAndMergeAll();
  // Wrap existing save functions so they also sync to Supabase
  wrapSaveFunctions();
  // Start realtime subscriptions
  startRealtimeSubscriptions();
  log('Supabase sync ready');
}

// Load data from Supabase and merge with local state (local takes precedence when present)
async function loadAndMergeAll() {
  try {
    await Promise.all([loadUsersFromSupabase(), loadGroupsFromSupabase(), loadFrameworkFromSupabase(), loadSettingsFromSupabase()]);
    // Trigger UI refresh if functions exist
    if (typeof populateUserTable === 'function') populateUserTable();
    if (typeof populateGroups === 'function') populateGroups();
  } catch (err) {
    console.error('Error loading initial data from Supabase', err.message || err);
  }
}

// --- Users ---
async function loadUsersFromSupabase() {
  try {
    const { data, error } = await supabase.from('users').select('*');
    if (error) throw error;
    if (!data) return;

    // If local exists, merge (local precedence)
    const localRaw = localStorage.getItem(LS_KEYS.users);
    let local = localRaw ? JSON.parse(localRaw) : [];

    const merged = mergeRemoteWithLocal(data, local, 'id');
    userData = merged; // assumes global variable
    localStorage.setItem(LS_KEYS.users, JSON.stringify(merged));

    log('Users loaded & merged:', merged.length);
  } catch (err) {
    console.error('loadUsersFromSupabase error', err instanceof Error ? err.message : err);
  }
}

async function upsertUserToSupabase(user) {
  try {
    // Ensure id exists for upsert
    if (!user.id) user.id = Date.now();
    const { error } = await supabase.from('users').upsert(user, { onConflict: 'id' });
    if (error) throw error;
    log('User upserted', user.id);
  } catch (err) {
    console.error('upsertUserToSupabase error', err.message || err);
  }
}

async function deleteUserFromSupabase(userId) {
  try {
    const { error } = await supabase.from('users').delete().eq('id', userId);
    if (error) throw error;
    log('User deleted remotely', userId);
  } catch (err) {
    console.error('deleteUserFromSupabase error', err.message || err);
  }
}

// --- Groups ---
async function loadGroupsFromSupabase() {
  try {
    const { data, error } = await supabase.from('groups').select('*');
    if (error) throw error;
    const localRaw = localStorage.getItem(LS_KEYS.groups);
    let local = localRaw ? JSON.parse(localRaw) : [];
    const merged = mergeRemoteWithLocal(data, local, 'id');
    groups = merged; // assumes global var
    localStorage.setItem(LS_KEYS.groups, JSON.stringify(merged));
    log('Groups loaded & merged:', merged.length);
  } catch (err) {
    console.error('loadGroupsFromSupabase error', err.message || err);
  }
}

async function upsertGroupToSupabase(group) {
  try {
    if (!group.id) group.id = Date.now();
    const { error } = await supabase.from('groups').upsert(group, { onConflict: 'id' });
    if (error) throw error;
    log('Group upserted', group.id);
  } catch (err) {
    console.error('upsertGroupToSupabase error', err.message || err);
  }
}

async function deleteGroupFromSupabase(groupId) {
  try {
    const { error } = await supabase.from('groups').delete().eq('id', groupId);
    if (error) throw error;
    log('Group deleted remotely', groupId);
  } catch (err) {
    console.error('deleteGroupFromSupabase error', err.message || err);
  }
}

// --- Framework (form generation) ---
async function loadFrameworkFromSupabase() {
  try {
    const { data, error } = await supabase.from('form_framework').select('*').order('updated_at', { ascending: false }).limit(1);
    if (error) throw error;
    if (data && data.length) {
      // keep the latest
      const remote = data[0];
      const localRaw = localStorage.getItem(LS_KEYS.framework);
      const local = localRaw ? JSON.parse(localRaw) : null;
      // if local exists prefer local, otherwise set remote
      const toUse = local || remote.payload || remote.data || remote.framework || remote;
      localStorage.setItem(LS_KEYS.framework, JSON.stringify(toUse));
      if (typeof dataFramework !== 'undefined') dataFramework = toUse;
      log('Framework loaded');
    }
  } catch (err) {
    console.error('loadFrameworkFromSupabase error', err.message || err);
  }
}

async function saveFrameworkToSupabase(frameworkObj) {
  try {
    const payload = { payload: frameworkObj, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('form_framework').insert(payload);
    if (error) throw error;
    log('Framework saved to supabase');
  } catch (err) {
    console.error('saveFrameworkToSupabase error', err.message || err);
  }
}

// --- Registration settings ---
async function loadSettingsFromSupabase() {
  try {
    const { data, error } = await supabase.from('registration_settings').select('*').order('updated_at', { ascending: false }).limit(1);
    if (error) throw error;
    if (data && data.length) {
      const remote = data[0];
      const localRaw = localStorage.getItem(LS_KEYS.settings);
      const local = localRaw ? JSON.parse(localRaw) : null;
      const toUse = local || remote.payload || remote.data || remote;
      localStorage.setItem(LS_KEYS.settings, JSON.stringify(toUse));
      if (typeof registrationSettings !== 'undefined') registrationSettings = toUse;
      log('Registration settings loaded');
    }
  } catch (err) {
    console.error('loadSettingsFromSupabase error', err.message || err);
  }
}

async function saveSettingsToSupabase(settingsObj) {
  try {
    const payload = { payload: settingsObj, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('registration_settings').insert(payload);
    if (error) throw error;
    log('Settings saved to supabase');
  } catch (err) {
    console.error('saveSettingsToSupabase error', err.message || err);
  }
}

// --- Merge helper ---
function mergeRemoteWithLocal(remoteArr = [], localArr = [], key = 'id') {
  // Turn local into map
  const localMap = new Map();
  localArr.forEach(item => { if (item && item[key] !== undefined) localMap.set(String(item[key]), item); });

  // Merge, local wins when conflict
  const merged = [];
  const seen = new Set();

  remoteArr.forEach(r => {
    const id = r && r[key] !== undefined ? String(r[key]) : null;
    if (id && localMap.has(id)) {
      merged.push(localMap.get(id));
      seen.add(id);
    } else {
      merged.push(r);
      if (id) seen.add(id);
    }
  });

  // Add any locals not in remote
  localArr.forEach(l => {
    const id = l && l[key] !== undefined ? String(l[key]) : null;
    if (!id || !seen.has(id)) merged.push(l);
  });

  return merged;
}

// --- Realtime subscriptions ---
function startRealtimeSubscriptions() {
  try {
    // subscribe to users
    supabase.channel('public:users')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, payload => handleUserRealtime(payload))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, payload => handleGroupRealtime(payload))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'form_framework' }, payload => handleFrameworkRealtime(payload))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registration_settings' }, payload => handleSettingsRealtime(payload))
      .subscribe(status => log('Realtime subscription status:', status));
  } catch (err) {
    console.error('startRealtimeSubscriptions error', err.message || err);
  }
}

function handleUserRealtime(payload) {
  try {
    log('User realtime event', payload.eventType, payload.new || payload.old);
    // For simplicity, reload users from supabase to preserve consistency
    loadUsersFromSupabase().then(() => { if (typeof populateUserTable === 'function') populateUserTable(); });
  } catch (err) { console.error(err); }
}

function handleGroupRealtime(payload) {
  try {
    log('Group realtime event', payload.eventType);
    loadGroupsFromSupabase().then(() => { if (typeof populateGroups === 'function') populateGroups(); });
  } catch (err) { console.error(err); }
}

function handleFrameworkRealtime(payload) {
  try {
    log('Framework realtime event', payload.eventType);
    loadFrameworkFromSupabase();
  } catch (err) { console.error(err); }
}

function handleSettingsRealtime(payload) {
  try {
    log('Settings realtime event', payload.eventType);
    loadSettingsFromSupabase();
  } catch (err) { console.error(err); }
}

// --- Wrappers: override existing local save functions to also sync remotely ---
function wrapSaveFunctions() {
  // Wrap saveUserData
  if (typeof window.saveUserData === 'function') {
    const origSave = window.saveUserData.bind(window);
    window.saveUserData = function(...args) {
      origSave(...args);
      try {
        // upsert all users (small sets expected); for scale change to per-item upsert
        if (Array.isArray(window.userData)) {
          window.userData.forEach(u => {
            // copy minimal fields and ensure id
            const up = JSON.parse(JSON.stringify(u || {}));
            upsertUserToSupabase(up);
          });
        }
      } catch (err) { console.error('wrapped saveUserData error', err); }
    };
    log('Wrapped saveUserData to also upsert to Supabase');
  } else {
    log('saveUserData not found to wrap');
  }

  // Wrap saveGroups
  if (typeof window.saveGroups === 'function') {
    const origSaveG = window.saveGroups.bind(window);
    window.saveGroups = function(...args) {
      origSaveG(...args);
      try {
        if (Array.isArray(window.groups)) {
          window.groups.forEach(g => {
            const gp = JSON.parse(JSON.stringify(g || {}));
            upsertGroupToSupabase(gp);
          });
        }
      } catch (err) { console.error('wrapped saveGroups error', err); }
    };
    log('Wrapped saveGroups to also upsert to Supabase');
  } else {
    log('saveGroups not found to wrap');
  }

  // Provide helpers for adding framework/settings
  window.saveFrameworkLocallyAndRemote = async function(frameworkObj) {
    localStorage.setItem(LS_KEYS.framework, JSON.stringify(frameworkObj));
    if (typeof dataFramework !== 'undefined') dataFramework = frameworkObj;
    await saveFrameworkToSupabase(frameworkObj);
    if (typeof showTemporaryMessage === 'function') showTemporaryMessage('Framework saved and synced', 'success');
  };

  window.saveRegistrationSettingsLocallyAndRemote = async function(settingsObj) {
    localStorage.setItem(LS_KEYS.settings, JSON.stringify(settingsObj));
    if (typeof registrationSettings !== 'undefined') registrationSettings = settingsObj;
    await saveSettingsToSupabase(settingsObj);
    if (typeof showTemporaryMessage === 'function') showTemporaryMessage('Settings saved and synced', 'success');
  };
}

// --- Public API for manual use ---
window.supabaseSync = {
  init: initSupabaseSync,
  upsertUser: upsertUserToSupabase,
  deleteUser: deleteUserFromSupabase,
  upsertGroup: upsertGroupToSupabase,
  deleteGroup: deleteGroupFromSupabase,
  saveFramework: saveFrameworkToSupabase,
  saveSettings: saveSettingsToSupabase
};

// Auto-init if page already loaded and global functions exist
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  // delay a bit to ensure your main script defined global functions
  setTimeout(() => { initSupabaseSync().catch(e => console.error(e)); }, 300);
} else {
  window.addEventListener('DOMContentLoaded', () => setTimeout(() => initSupabaseSync().catch(e => console.error(e)), 300));
}
