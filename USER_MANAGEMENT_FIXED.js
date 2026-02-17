// ========================================================================
// USER MANAGEMENT SYSTEM - FIXED & PRODUCTION-READY
// Supabase Real-Time Integration
// ========================================================================

// ========================================================================
// STATE MANAGEMENT
// ========================================================================
let userData = [];
let dataFramework = [];
let groups = [];
let currentCaseUserId = null;
let registrationSettings = null;

// Real-time subscription channels
const subscriptionChannels = {
  fields: null,
  users: null,
  groups: null,
  settings: null
};

// Default data (used only if Supabase is unavailable)
const defaultFramework = [
  { id: crypto.randomUUID(), name: 'Full Name', type: 'text', required: 'yes', order: 1, created_at: new Date().toISOString() },
  { id: crypto.randomUUID(), name: 'Registration Number', type: 'text', required: 'yes', order: 2, created_at: new Date().toISOString() },
  { id: crypto.randomUUID(), name: 'Phone Number', type: 'phone', required: 'yes', order: 3, created_at: new Date().toISOString() }
];

// ========================================================================
// SUPABASE INITIALIZATION & CLIENT CHECK
// ========================================================================

// Check if Supabase is available
function isSupabaseReady() {
  if (typeof supabaseClient === 'undefined' || !supabaseClient) {
    console.warn('⚠️ Supabase client not available. Using localStorage fallback.');
    return false;
  }
  return true;
}

// ========================================================================
// DATA TRANSFORMATION LAYER
// ========================================================================

// Transform Supabase user to frontend format
function transformSupabaseUser(dbUser) {
  return {
    id: dbUser.id,
    name: dbUser.name,
    regNo: dbUser.registration_number,
    phone: dbUser.phone,
    email: dbUser.email,
    group: dbUser.group_id ? `Group ${dbUser.group_id}` : '',
    groupId: dbUser.group_id,
    status: dbUser.status || 'active',
    caseInfo: dbUser.case_info || '',
    created_at: dbUser.created_at,
    updated_at: dbUser.updated_at
  };
}

// Transform frontend user to Supabase format
function transformUserForSupabase(user) {
  return {
    id: user.id || crypto.randomUUID(),
    name: user.name,
    registration_number: user.regNo,
    phone: user.phone,
    email: user.email,
    group_id: user.groupId || null,
    status: user.status || 'active',
    case_info: user.caseInfo || ''
  };
}

// Transform Supabase group to frontend format
function transformSupabaseGroup(dbGroup) {
  return {
    id: dbGroup.id,
    name: dbGroup.name,
    size: dbGroup.size,
    members: dbGroup.members || [],
    leader: dbGroup.leader_id,
    flagged: dbGroup.flagged || false,
    created_at: dbGroup.created_at
  };
}

// Transform frontend group to Supabase format
function transformGroupForSupabase(group) {
  return {
    id: group.id || crypto.randomUUID(),
    name: group.name,
    size: group.size,
    leader_id: group.leader || null,
    flagged: group.flagged || false
  };
}

// ========================================================================
// REAL-TIME SUBSCRIPTIONS
// ========================================================================

/**
 * Subscribe to registration field changes in real-time
 */
function subscribeToRegistrationFields() {
  if (!isSupabaseReady()) return null;
  
  console.log('📡 Subscribing to registration field changes...');
  
  // Unsubscribe from old channel if exists
  if (subscriptionChannels.fields) {
    supabaseClient.removeChannel(subscriptionChannels.fields);
  }
  
  const channel = supabaseClient
    .channel('registration_fields_changes')
    .on('postgres_changes', 
      { event: '*', schema: 'public', table: 'registration_fields' },
      (payload) => {
        console.log('🔄 Registration fields changed:', payload);
        
        if (payload.eventType === 'INSERT') {
          dataFramework.push(payload.new);
        } else if (payload.eventType === 'UPDATE') {
          const idx = dataFramework.findIndex(f => f.id === payload.new.id);
          if (idx !== -1) dataFramework[idx] = payload.new;
        } else if (payload.eventType === 'DELETE') {
          dataFramework = dataFramework.filter(f => f.id !== payload.old.id);
        }
        
        saveDataFramework();
        renderDataFramework();
        generateRegistrationFormPreview();
      }
    )
    .subscribe((status) => {
      console.log(`📡 Registration fields subscription: ${status}`);
    });
  
  subscriptionChannels.fields = channel;
  return channel;
}

/**
 * Subscribe to user changes in real-time
 */
function subscribeToUsers() {
  if (!isSupabaseReady()) return null;
  
  console.log('📡 Subscribing to user changes...');
  
  // Unsubscribe from old channel if exists
  if (subscriptionChannels.users) {
    supabaseClient.removeChannel(subscriptionChannels.users);
  }
  
  const channel = supabaseClient
    .channel('users_changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'users' },
      (payload) => {
        console.log('🔄 User changed:', payload);
        
        if (payload.eventType === 'INSERT') {
          const transformed = transformSupabaseUser(payload.new);
          userData.push(transformed);
        } else if (payload.eventType === 'UPDATE') {
          const idx = userData.findIndex(u => u.id === payload.new.id);
          if (idx !== -1) {
            userData[idx] = transformSupabaseUser(payload.new);
          }
        } else if (payload.eventType === 'DELETE') {
          userData = userData.filter(u => u.id !== payload.old.id);
        }
        
        saveUserData();
        populateUserTable();
      }
    )
    .subscribe((status) => {
      console.log(`📡 Users subscription: ${status}`);
    });
  
  subscriptionChannels.users = channel;
  return channel;
}

/**
 * Subscribe to group changes in real-time
 */
function subscribeToGroups() {
  if (!isSupabaseReady()) return null;
  
  console.log('📡 Subscribing to group changes...');
  
  // Unsubscribe from old channel if exists
  if (subscriptionChannels.groups) {
    supabaseClient.removeChannel(subscriptionChannels.groups);
  }
  
  const channel = supabaseClient
    .channel('user_groups_changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'user_groups' },
      (payload) => {
        console.log('🔄 Group changed:', payload);
        
        if (payload.eventType === 'INSERT') {
          const transformed = transformSupabaseGroup(payload.new);
          groups.push(transformed);
        } else if (payload.eventType === 'UPDATE') {
          const idx = groups.findIndex(g => g.id === payload.new.id);
          if (idx !== -1) {
            groups[idx] = transformSupabaseGroup(payload.new);
          }
        } else if (payload.eventType === 'DELETE') {
          groups = groups.filter(g => g.id !== payload.old.id);
        }
        
        saveGroups();
        populateGroups();
      }
    )
    .subscribe((status) => {
      console.log(`📡 Groups subscription: ${status}`);
    });
  
  subscriptionChannels.groups = channel;
  return channel;
}

/**
 * Subscribe to registration settings changes
 */
function subscribeToRegistrationSettings() {
  if (!isSupabaseReady()) return null;
  
  console.log('📡 Subscribing to registration settings changes...');
  
  // Unsubscribe from old channel if exists
  if (subscriptionChannels.settings) {
    supabaseClient.removeChannel(subscriptionChannels.settings);
  }
  
  const channel = supabaseClient
    .channel('registration_settings_changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'registration_settings' },
      (payload) => {
        console.log('🔄 Registration settings changed:', payload);
        
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          registrationSettings = payload.new;
          localStorage.setItem('ring0_registration_enabled', payload.new.enabled.toString());
          localStorage.setItem('ring0_registration_mode', payload.new.mode);
          updateRegistrationMenuButton();
        }
      }
    )
    .subscribe((status) => {
      console.log(`📡 Registration settings subscription: ${status}`);
    });
  
  subscriptionChannels.settings = channel;
  return channel;
}

// ========================================================================
// DATA FETCHING FROM SUPABASE
// ========================================================================

/**
 * Fetch all user management data from Supabase
 */
async function fetchUserManagementData() {
  if (!isSupabaseReady()) {
    console.log('⚠️ Using localStorage fallback...');
    loadDataFramework();
    loadUserData();
    loadGroups();
    return;
  }
  
  console.log('🔄 Fetching user management data from Supabase...');
  
  try {
    // Fetch registration fields
    const { data: fieldsData, error: fieldsError } = await supabaseClient
      .from('registration_fields')
      .select('*')
      .order('order', { ascending: true });
    
    if (fieldsError) {
      console.error('❌ Error fetching registration fields:', fieldsError);
    } else if (fieldsData && fieldsData.length > 0) {
      dataFramework = fieldsData;
      saveDataFramework();
      console.log(`✅ Loaded ${fieldsData.length} registration fields from Supabase`);
    } else {
      // Use defaults
      loadDataFramework();
    }
    
    // Fetch users
    const { data: usersData, error: usersError } = await supabaseClient
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (usersError) {
      console.error('❌ Error fetching users:', usersError);
    } else if (usersData) {
      userData = usersData.map(transformSupabaseUser);
      saveUserData();
      console.log(`✅ Loaded ${usersData.length} users from Supabase`);
    } else {
      loadUserData();
    }
    
    // Fetch groups
    const { data: groupsData, error: groupsError } = await supabaseClient
      .from('user_groups')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (groupsError) {
      console.error('❌ Error fetching groups:', groupsError);
    } else if (groupsData) {
      groups = groupsData.map(transformSupabaseGroup);
      saveGroups();
      console.log(`✅ Loaded ${groupsData.length} groups from Supabase`);
    } else {
      loadGroups();
    }
    
    // Fetch registration settings
    const { data: settingsData, error: settingsError } = await supabaseClient
      .from('registration_settings')
      .select('*')
      .single();
    
    if (settingsError && settingsError.code !== 'PGRST116') {
      console.error('❌ Error fetching registration settings:', settingsError);
    } else if (settingsData) {
      registrationSettings = settingsData;
      localStorage.setItem('ring0_registration_enabled', settingsData.enabled.toString());
      localStorage.setItem('ring0_registration_mode', settingsData.mode);
      console.log('✅ Loaded registration settings from Supabase');
    }
    
    console.log('🎉 All user management data loaded successfully!');
    
  } catch (error) {
    console.error('❌ Error in fetchUserManagementData:', error);
    // Fallback to localStorage
    loadDataFramework();
    loadUserData();
    loadGroups();
  }
}

// ========================================================================
// SAVING DATA TO SUPABASE
// ========================================================================

/**
 * Save registration field to Supabase
 */
async function saveFieldToSupabase(field) {
  if (!isSupabaseReady()) {
    console.warn('⚠️ Supabase unavailable. Field saved to localStorage only.');
    return false;
  }
  
  try {
    const { data, error } = await supabaseClient
      .from('registration_fields')
      .upsert({
        id: field.id || crypto.randomUUID(),
        name: field.name,
        type: field.type,
        required: field.required,
        order: field.order,
        options: field.options
      }, { onConflict: 'id' });
    
    if (error) {
      console.error('❌ Error saving field:', error);
      return false;
    }
    
    console.log('✅ Field saved to Supabase');
    return true;
  } catch (error) {
    console.error('❌ Error in saveFieldToSupabase:', error);
    return false;
  }
}

/**
 * Save user to Supabase
 */
async function saveUserToSupabase(user) {
  if (!isSupabaseReady()) {
    console.warn('⚠️ Supabase unavailable. User saved to localStorage only.');
    return false;
  }
  
  try {
    const supabaseUser = transformUserForSupabase(user);
    
    const { data, error } = await supabaseClient
      .from('users')
      .upsert(supabaseUser, { onConflict: 'id' });
    
    if (error) {
      console.error('❌ Error saving user:', error);
      return false;
    }
    
    console.log('✅ User saved to Supabase');
    return true;
  } catch (error) {
    console.error('❌ Error in saveUserToSupabase:', error);
    return false;
  }
}

/**
 * Save group to Supabase
 */
async function saveGroupToSupabase(group) {
  if (!isSupabaseReady()) {
    console.warn('⚠️ Supabase unavailable. Group saved to localStorage only.');
    return false;
  }
  
  try {
    const supabaseGroup = transformGroupForSupabase(group);
    
    const { data, error } = await supabaseClient
      .from('user_groups')
      .upsert(supabaseGroup, { onConflict: 'id' });
    
    if (error) {
      console.error('❌ Error saving group:', error);
      return false;
    }
    
    console.log('✅ Group saved to Supabase');
    return true;
  } catch (error) {
    console.error('❌ Error in saveGroupToSupabase:', error);
    return false;
  }
}

/**
 * Update registration settings in Supabase
 */
async function updateRegistrationSettingsInSupabase(settings) {
  if (!isSupabaseReady()) {
    console.warn('⚠️ Supabase unavailable. Settings saved to localStorage only.');
    return false;
  }
  
  try {
    // Check if settings exist
    const { data: existing } = await supabaseClient
      .from('registration_settings')
      .select('id')
      .single();
    
    let result;
    if (existing) {
      result = await supabaseClient
        .from('registration_settings')
        .update({
          enabled: settings.enabled,
          mode: settings.mode,
          registration_link: settings.registrationLink
        })
        .eq('id', existing.id);
    } else {
      result = await supabaseClient
        .from('registration_settings')
        .insert({
          enabled: settings.enabled,
          mode: settings.mode,
          registration_link: settings.registrationLink
        });
    }
    
    if (result.error) {
      console.error('❌ Error updating settings:', result.error);
      return false;
    }
    
    console.log('✅ Registration settings updated in Supabase');
    return true;
  } catch (error) {
    console.error('❌ Error in updateRegistrationSettingsInSupabase:', error);
    return false;
  }
}

// ========================================================================
// DELETE OPERATIONS
// ========================================================================

/**
 * Delete user from Supabase
 */
async function deleteUserFromSupabase(userId) {
  if (!isSupabaseReady()) {
    console.warn('⚠️ Supabase unavailable. User deleted from localStorage only.');
    return false;
  }
  
  try {
    const { error } = await supabaseClient
      .from('users')
      .delete()
      .eq('id', userId);
    
    if (error) {
      console.error('❌ Error deleting user:', error);
      return false;
    }
    
    console.log('✅ User deleted from Supabase');
    return true;
  } catch (error) {
    console.error('❌ Error in deleteUserFromSupabase:', error);
    return false;
  }
}

/**
 * Delete group from Supabase
 */
async function deleteGroupFromSupabase(groupId) {
  if (!isSupabaseReady()) {
    console.warn('⚠️ Supabase unavailable. Group deleted from localStorage only.');
    return false;
  }
  
  try {
    const { error } = await supabaseClient
      .from('user_groups')
      .delete()
      .eq('id', groupId);
    
    if (error) {
      console.error('❌ Error deleting group:', error);
      return false;
    }
    
    console.log('✅ Group deleted from Supabase');
    return true;
  } catch (error) {
    console.error('❌ Error in deleteGroupFromSupabase:', error);
    return false;
  }
}

// ========================================================================
// LOCAL STORAGE MANAGEMENT
// ========================================================================

function loadDataFramework() {
  const saved = localStorage.getItem('ring0_data_framework');
  dataFramework = saved ? JSON.parse(saved) : [...defaultFramework];
}

function saveDataFramework() {
  localStorage.setItem('ring0_data_framework', JSON.stringify(dataFramework));
}

function loadUserData() {
  const saved = localStorage.getItem('ring0_user_data');
  userData = saved ? JSON.parse(saved) : [];
}

function saveUserData() {
  localStorage.setItem('ring0_user_data', JSON.stringify(userData));
}

function loadGroups() {
  const saved = localStorage.getItem('ring0_user_groups');
  groups = saved ? JSON.parse(saved) : [];
}

function saveGroups() {
  localStorage.setItem('ring0_user_groups', JSON.stringify(groups));
}

// ========================================================================
// INITIALIZATION
// ========================================================================

/**
 * Initialize the entire User Management System
 */
async function initUserManagementSystem() {
  console.log('🚀 Initializing User Management System...');
  
  try {
    // Fetch data from Supabase or localStorage
    await fetchUserManagementData();
    
    // Setup real-time subscriptions
    subscribeToRegistrationFields();
    subscribeToUsers();
    subscribeToGroups();
    subscribeToRegistrationSettings();
    
    // Initialize UI
    renderDataFramework();
    populateUserTable();
    populateGroups();
    generateRegistrationFormPreview();
    updateRegistrationSwitch();
    
    console.log('✅ User Management System initialized successfully!');
    
  } catch (error) {
    console.error('❌ Error initializing User Management System:', error);
  }
}

// Call this when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUserManagementSystem);
} else {
  initUserManagementSystem();
}
