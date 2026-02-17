// ========================================================================
// USER MANAGEMENT SYSTEM INTEGRATION - Frontend Supabase Integration
// ========================================================================
// This file integrates the Supabase backend with the frontend UI
// Handles real-time sync, data transforms, and localStorage fallback

// Global state for user management
let registrationFields = [];
let users = [];
let userGroups = [];
let registrationSettings = null;
let isSupabaseReady = false;

// ========================================================================
// DATA TRANSFORMATION HELPERS
// ========================================================================

// Transform Supabase user to frontend format (snake_case → camelCase)
function transformSupabaseUser(user) {
  return {
    id: user.id,
    name: user.full_name,
    registration_number: user.registration_number,
    registrationNumber: user.registration_number,
    phone: user.phone_number,
    email: user.email,
    group_id: user.group_id,
    groupId: user.group_id,
    status: user.status,
    case_info: user.dynamic_fields,
    caseInfo: user.dynamic_fields,
    created_at: user.created_at,
    createdAt: user.created_at,
    updated_at: user.updated_at,
    updatedAt: user.updated_at
  };
}

// Transform frontend user to Supabase format (camelCase → snake_case)
function transformUserForSupabase(user) {
  return {
    full_name: user.name,
    registration_number: user.registrationNumber || user.registration_number,
    phone_number: user.phone,
    email: user.email,
    group_id: user.groupId || user.group_id,
    status: user.status || 'active',
    dynamic_fields: user.caseInfo || user.case_info
  };
}

// Transform Supabase group to frontend format
function transformSupabaseGroup(group) {
  return {
    id: group.id,
    name: group.name,
    size: group.size,
    leader_id: group.leader_id,
    leaderId: group.leader_id,
    flagged: group.flagged,
    created_at: group.created_at,
    createdAt: group.created_at,
    updated_at: group.updated_at,
    updatedAt: group.updated_at
  };
}

// Transform frontend group to Supabase format
function transformGroupForSupabase(group) {
  return {
    name: group.name,
    size: group.size || 10,
    leader_id: group.leaderId || group.leader_id,
    flagged: group.flagged || false
  };
}

// ========================================================================
// SUPABASE REAL-TIME SUBSCRIPTIONS
// ========================================================================

// Subscribe to registration fields changes
function subscribeToRegistrationFields() {
  if (!supabaseClient) return null;
  
  const channel = supabaseClient
    .channel('public:registration_fields')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'registration_fields' },
      (payload) => {
        console.log('📝 Registration fields updated:', payload);
        fetchRegistrationFields();
      }
    )
    .subscribe((status) => {
      console.log(`Registration fields subscription ${status === 'SUBSCRIBED' ? '✅' : '❌'}`);
    });
  
  return channel;
}

// Subscribe to users changes
function subscribeToUsers() {
  if (!supabaseClient) return null;
  
  const channel = supabaseClient
    .channel('public:users')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'users' },
      (payload) => {
        console.log('👥 Users updated:', payload);
        fetchUsers();
        renderUserList();
      }
    )
    .subscribe((status) => {
      console.log(`Users subscription ${status === 'SUBSCRIBED' ? '✅' : '❌'}`);
    });
  
  return channel;
}

// Subscribe to groups changes
function subscribeToGroups() {
  if (!supabaseClient) return null;
  
  const channel = supabaseClient
    .channel('public:user_groups')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_groups' },
      (payload) => {
        console.log('👫 Groups updated:', payload);
        fetchGroups();
        renderGroupList();
      }
    )
    .subscribe((status) => {
      console.log(`Groups subscription ${status === 'SUBSCRIBED' ? '✅' : '❌'}`);
    });
  
  return channel;
}

// Subscribe to registration settings changes
function subscribeToRegistrationSettings() {
  if (!supabaseClient) return null;
  
  const channel = supabaseClient
    .channel('public:registration_settings')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'registration_settings' },
      (payload) => {
        console.log('⚙️ Registration settings updated:', payload);
        fetchRegistrationSettings();
        updateRegistrationSwitch();
      }
    )
    .subscribe((status) => {
      console.log(`Registration settings subscription ${status === 'SUBSCRIBED' ? '✅' : '❌'}`);
    });
  
  return channel;
}

// ========================================================================
// FETCH DATA FROM SUPABASE
// ========================================================================

// Fetch registration fields from Supabase
async function fetchRegistrationFields() {
  if (!supabaseClient) {
    loadRegistrationFieldsFromStorage();
    return;
  }
  
  try {
    const { data, error } = await supabaseClient
      .from('registration_fields')
      .select('*')
      .order('field_order', { ascending: true });
    
    if (error) throw error;
    
    registrationFields = data || [];
    saveRegistrationFieldsToStorage(registrationFields);
    renderDataFramework();
    
    console.log('✅ Fetched registration fields:', registrationFields);
  } catch (error) {
    console.error('❌ Error fetching registration fields:', error);
    loadRegistrationFieldsFromStorage();
  }
}

// Fetch users from Supabase
async function fetchUsers() {
  if (!supabaseClient) {
    loadUsersFromStorage();
    return;
  }
  
  try {
    const { data, error } = await supabaseClient
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    users = (data || []).map(transformSupabaseUser);
    saveUsersToStorage(users);
    
    console.log('✅ Fetched users:', users);
  } catch (error) {
    console.error('❌ Error fetching users:', error);
    loadUsersFromStorage();
  }
}

// Fetch groups from Supabase
async function fetchGroups() {
  if (!supabaseClient) {
    loadGroupsFromStorage();
    return;
  }
  
  try {
    const { data, error } = await supabaseClient
      .from('user_groups')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    userGroups = (data || []).map(transformSupabaseGroup);
    saveGroupsToStorage(userGroups);
    
    console.log('✅ Fetched groups:', userGroups);
  } catch (error) {
    console.error('❌ Error fetching groups:', error);
    loadGroupsFromStorage();
  }
}

// Fetch registration settings from Supabase
async function fetchRegistrationSettings() {
  if (!supabaseClient) {
    loadRegistrationSettingsFromStorage();
    return;
  }
  
  try {
    const { data, error } = await supabaseClient
      .from('registration_settings')
      .select('*')
      .limit(1)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
    
    registrationSettings = data || {
      enabled: true,
      mode: 'default',
      registration_link: ''
    };
    
    saveRegistrationSettingsToStorage(registrationSettings);
    
    console.log('✅ Fetched registration settings:', registrationSettings);
  } catch (error) {
    console.error('❌ Error fetching registration settings:', error);
    loadRegistrationSettingsFromStorage();
  }
}

// ========================================================================
// SAVE/UPDATE DATA TO SUPABASE
// ========================================================================

// Save or update a registration field
async function saveFieldToSupabase(field) {
  if (!supabaseClient) {
    console.warn('⚠️ Supabase not available, saving to localStorage only');
    return false;
  }
  
  try {
    const { data, error } = await supabaseClient
      .from('registration_fields')
      .upsert([{
        id: field.id || undefined,
        field_name: field.name,
        field_type: field.type,
        is_required: field.required === 'yes' || field.required === true,
        field_order: field.order || field.field_order || 1,
        options: field.options || null
      }])
      .select();
    
    if (error) throw error;
    
    console.log('✅ Field saved to Supabase:', data);
    return true;
  } catch (error) {
    console.error('❌ Error saving field:', error);
    return false;
  }
}

// Save or update a user
async function saveUserToSupabase(user) {
  if (!supabaseClient) {
    console.warn('⚠️ Supabase not available, saving to localStorage only');
    return false;
  }
  
  try {
    const userData = transformUserForSupabase(user);
    
    const { data, error } = await supabaseClient
      .from('users')
      .upsert([{
        id: user.id || undefined,
        ...userData
      }])
      .select();
    
    if (error) throw error;
    
    console.log('✅ User saved to Supabase:', data);
    return true;
  } catch (error) {
    console.error('❌ Error saving user:', error);
    return false;
  }
}

// Save or update a group
async function saveGroupToSupabase(group) {
  if (!supabaseClient) {
    console.warn('⚠️ Supabase not available, saving to localStorage only');
    return false;
  }
  
  try {
    const groupData = transformGroupForSupabase(group);
    
    const { data, error } = await supabaseClient
      .from('user_groups')
      .upsert([{
        id: group.id || undefined,
        ...groupData
      }])
      .select();
    
    if (error) throw error;
    
    console.log('✅ Group saved to Supabase:', data);
    return true;
  } catch (error) {
    console.error('❌ Error saving group:', error);
    return false;
  }
}

// Update registration settings
async function updateRegistrationSettingsInSupabase(settings) {
  if (!supabaseClient) {
    console.warn('⚠️ Supabase not available, saving to localStorage only');
    return false;
  }
  
  try {
    const { data, error } = await supabaseClient
      .from('registration_settings')
      .upsert([{
        id: settings.id || '00000000-0000-0000-0000-000000000001',
        enabled: settings.enabled,
        mode: settings.mode || 'default',
        registration_link: settings.registration_link || null
      }])
      .select();
    
    if (error) throw error;
    
    registrationSettings = data[0];
    saveRegistrationSettingsToStorage(registrationSettings);
    
    console.log('✅ Settings updated in Supabase:', data);
    return true;
  } catch (error) {
    console.error('❌ Error updating settings:', error);
    return false;
  }
}

// ========================================================================
// LOCALSTORAGE FALLBACK
// ========================================================================

function saveRegistrationFieldsToStorage(fields) {
  // Keep existing key (for integration) and mirror to the UI's expected key
  localStorage.setItem('ring0_registration_fields', JSON.stringify(fields));

  try {
    // Convert registration fields from Supabase shape to UI dataFramework shape
    const dataFramework = (fields || []).map(f => ({
      id: f.id || null,
      name: f.field_name || f.name || '',
      type: f.field_type || 'text',
      required: f.is_required ? 'yes' : 'no',
      order: f.field_order || 1,
      options: f.options || [],
      created_at: f.created_at || null
    }));

    localStorage.setItem('ring0_data_framework', JSON.stringify(dataFramework));

    // If the main UI script exposes `dataFramework`, update it and re-render
    if (window && window.dataFramework !== undefined) {
      window.dataFramework = dataFramework;
      if (typeof window.renderDataFramework === 'function') window.renderDataFramework();
      if (typeof window.generateRegistrationFormPreview === 'function') window.generateRegistrationFormPreview();
    }
  } catch (e) {
    console.warn('Could not mirror registration fields to UI keys:', e);
  }
}

function loadRegistrationFieldsFromStorage() {
  const saved = localStorage.getItem('ring0_registration_fields');
  registrationFields = saved ? JSON.parse(saved) : [];
}

function saveUsersToStorage(users_list) {
  // Save canonical users key for integration
  localStorage.setItem('ring0_users', JSON.stringify(users_list));

  try {
    // Transform users to the UI's expected shape and mirror to ring0_user_data
    const transformed = (users_list || []).map(u => ({
      id: u.id,
      name: u.full_name || u.name || '',
      regNo: u.registration_number || u.registrationNumber || '',
      registration_number: u.registration_number || u.registrationNumber || '',
      phone: u.phone_number || u.phone || '',
      email: u.email || '',
      group: u.group_name || u.group || '',
      group_id: u.group_id || u.groupId || null,
      status: u.status || 'active',
      dynamic_fields: u.dynamic_fields || {},
      caseInfo: u.case_info || u.caseInfo || null,
      created_at: u.created_at || u.createdAt || null
    }));

    localStorage.setItem('ring0_user_data', JSON.stringify(transformed));

    if (window && window.userData !== undefined) {
      window.userData = transformed;
      if (typeof window.populateUserTable === 'function') window.populateUserTable();
    }
  } catch (e) {
    console.warn('Could not mirror users to UI keys:', e);
  }
}

function loadUsersFromStorage() {
  const saved = localStorage.getItem('ring0_users');
  users = saved ? JSON.parse(saved) : [];
}

function saveGroupsToStorage(groups) {
  localStorage.setItem('ring0_user_groups', JSON.stringify(groups));

  try {
    if (window && window.groups !== undefined) {
      window.groups = groups;
      if (typeof window.populateGroups === 'function') window.populateGroups();
    }
  } catch (e) {
    console.warn('Could not mirror groups to UI keys:', e);
  }
}

function loadGroupsFromStorage() {
  const saved = localStorage.getItem('ring0_user_groups');
  userGroups = saved ? JSON.parse(saved) : [];
}

function saveRegistrationSettingsToStorage(settings) {
  localStorage.setItem('ring0_registration_settings', JSON.stringify(settings));

  try {
    // Mirror to UI-specific keys
    if (settings && typeof settings === 'object') {
      localStorage.setItem('ring0_registration_enabled', settings.enabled === undefined ? 'true' : String(settings.enabled));
      localStorage.setItem('ring0_registration_mode', settings.mode || 'default');
      localStorage.setItem('ring0_registration_link', settings.registration_link || '');
    }

    if (window && typeof window.updateRegistrationVisibility === 'function') {
      window.updateRegistrationVisibility();
    }
  } catch (e) {
    console.warn('Could not mirror registration settings to UI keys:', e);
  }
}

function loadRegistrationSettingsFromStorage() {
  const saved = localStorage.getItem('ring0_registration_settings');
  registrationSettings = saved ? JSON.parse(saved) : {
    enabled: true,
    mode: 'default',
    registration_link: ''
  };
}

// ========================================================================
// INITIALIZATION
// ========================================================================

// Main initialization function
async function initializeUserManagementWithSupabase() {
  console.log('🚀 Initializing User Management System with Supabase...');
  
  // Check if Supabase is ready
  if (!supabaseClient) {
    console.warn('⚠️ Supabase not available, using localStorage fallback');
    loadRegistrationFieldsFromStorage();
    loadUsersFromStorage();
    loadGroupsFromStorage();
    loadRegistrationSettingsFromStorage();
    return;
  }
  
  isSupabaseReady = true;
  
  // Fetch all data in parallel
  try {
    await Promise.all([
      fetchRegistrationFields(),
      fetchUsers(),
      fetchGroups(),
      fetchRegistrationSettings()
    ]);
    
    console.log('✅ All data fetched from Supabase');
  } catch (error) {
    console.error('❌ Error fetching data:', error);
  }
  
  // Set up real-time subscriptions
  subscribeToRegistrationFields();
  subscribeToUsers();
  subscribeToGroups();
  subscribeToRegistrationSettings();
  
  console.log('✅ User Management System initialized with Supabase');
}

// Helper to check if Supabase is ready
function isSupabaseAvailable() {
  return supabaseClient && isSupabaseReady;
}
