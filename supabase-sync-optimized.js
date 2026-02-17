// supabase-sync-optimized.js
// High-performance syncing for user management system
// Implements debouncing, batching, optimistic updates, and parallel operations

(function() {
  const log = (...args) => console.log('[sync-optimized]', ...args);

  // ========================================================================
  // DELETED USERS TRACKER - Global blacklist to prevent deleted users from reappearing
  // ========================================================================
  window.deletedUsersTracker = {
    deleted: new Set(),
    
    // Load from localStorage on init
    load() {
      const stored = localStorage.getItem('ring0_deleted_users') || '[]';
      try {
        const arr = JSON.parse(stored);
        this.deleted = new Set(arr);
        console.log('🗑️ [DELETED TRACKER] Loaded', this.deleted.size, 'deleted user IDs from cache');
      } catch (e) {
        console.error('⚠️ Failed to load deleted users from cache:', e);
        this.deleted = new Set();
      }
    },
    
    // Save to localStorage
    save() {
      const arr = Array.from(this.deleted);
      localStorage.setItem('ring0_deleted_users', JSON.stringify(arr));
      console.log('💾 [DELETED TRACKER] Saved', this.deleted.size, 'deleted user IDs to cache');
    },
    
    // Add a deleted user ID
    markDeleted(userId) {
      const numericId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
      this.deleted.add(numericId);
      this.save();
      console.log('🚫 [DELETED TRACKER] Marked user', numericId, 'as deleted. Total deleted:', this.deleted.size);
    },
    
    // Check if user is deleted
    isDeleted(userId) {
      const numericId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
      return this.deleted.has(numericId);
    },
    
    // Clear a user from deleted list (after Supabase confirms)
    clearDeleted(userId) {
      const numericId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
      if (this.deleted.has(numericId)) {
        this.deleted.delete(numericId);
        this.save();
        console.log('✅ [DELETED TRACKER] Cleared user', numericId, 'from deleted list. Total deleted:', this.deleted.size);
      }
    },
    
    // Filter an array to exclude deleted users
    filterOutDeleted(userArray) {
      if (!Array.isArray(userArray)) return userArray;
      const before = userArray.length;
      const filtered = userArray.filter(u => !this.isDeleted(u.id || u));
      if (filtered.length !== before) {
        console.log('🧹 [DELETED TRACKER] Filtered out', before - filtered.length, 'deleted users');
      }
      return filtered;
    },
    
    // Remove deleted IDs from an array of IDs
    filterOutDeletedIds(idArray) {
      if (!Array.isArray(idArray)) return idArray;
      return idArray.filter(id => !this.isDeleted(id));
    }
  };
  
  // Initialize tracker on load
  window.deletedUsersTracker.load();

  // Sync queue for batching operations
  const syncQueue = {
    users: new Map(),
    groups: new Map(),
    timer: null,
    batchInterval: 500, // ms - wait before sending batch
    maxBatchSize: 50,

    add(type, id, data) {
      console.log(`📝 [QUEUE] Adding ${type}:`, id, 'Data:', data);
      if (!this[type]) this[type] = new Map();
      this[type].set(id, data);
      console.log(`📝 [QUEUE] ${type} queue size now:`, this[type].size);
      this.scheduleBatch();
    },

    scheduleBatch() {
      if (this.timer) return; // Already scheduled
      console.log('⏱️ [QUEUE] Batch scheduled in', this.batchInterval, 'ms');
      this.timer = setTimeout(() => this.flush(), this.batchInterval);
    },

    async flush() {
      console.log('🚀 [QUEUE] FLUSH START - Users:', this.users.size, 'Groups:', this.groups.size);
      this.timer = null;
      let users = Array.from(this.users.values());
      console.log('🚀 [QUEUE] Users to process:', users.length, 'Details:', users.map(u => ({ id: u.id, name: u.name })));
      
      // Filter out any user objects missing an id to avoid DB constraint errors
      const invalidUsers = users.filter(u => u.id == null || Number.isNaN(u.id));
      if (invalidUsers.length > 0) {
        console.warn('⚠️ [QUEUE] Skipping', invalidUsers.length, 'user(s) without valid id in batch sync');
        invalidUsers.forEach((u, idx) => console.warn(`  [${idx + 1}] id=${u.id}, name=${u.name}, type=${typeof u.id}`));
      }
      users = users.filter(u => u.id != null && !Number.isNaN(u.id));
      console.log('🚀 [QUEUE] Valid users after filter:', users.length);
      
      const groups = Array.from(this.groups.values());
      console.log('🚀 [QUEUE] Groups to sync:', groups.length, 'Details:', groups.map(g => ({ id: g.id, name: g.name })));

      this.users.clear();
      this.groups.clear();

      if (users.length > 0) {
        try {
          console.log('🚀 [QUEUE] Upserting', users.length, 'users to Supabase...');
          await window.supabaseClient
            .from('users')
            .upsert(users, { onConflict: 'id' });
          log(`✅ Synced ${users.length} users in batch`);
        } catch (error) {
          console.error('❌ Batch user sync failed:', error);
        }
      }

      if (groups.length > 0) {
        try {
          console.log('🚀 [QUEUE] Upserting', groups.length, 'groups to Supabase...');
          await window.supabaseClient
            .from('user_groups')
            .upsert(groups, { onConflict: 'id' });
          log(`✅ Synced ${groups.length} groups in batch`);
        } catch (error) {
          console.error('❌ Batch group sync failed:', error);
        }
      }
      console.log('✅ [QUEUE] FLUSH COMPLETE');
    }
  };

  // Debounce wrapper for rapid operations
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Optimized delete - immediate UI removal, background sync with detailed logging
  window.deleteUserOptimized = async function(userId) {
    try {
      // Convert to number for consistency with BIGINT ID in Supabase
      const numericId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
      
      console.log('🗑️ [DELETE START] Deleting user ID:', numericId, '(type:', typeof numericId + ')');

      // CRITICAL: Mark user as deleted in global tracker (prevents from ever reappearing)
      window.deletedUsersTracker.markDeleted(numericId);
      console.log('✅ [DELETED TRACKER] User marked as permanently deleted');

      // Remove immediately from UI (optimistic update)
      if (window.userData) {
        const index = window.userData.findIndex(u => u.id == numericId);
        if (index > -1) {
          console.log('✅ Removed from userData array at index:', index);
          window.userData.splice(index, 1);
        }
      }

      // CRITICAL: Remove deleted user from all groups' member arrays immediately
      if (window.groups && Array.isArray(window.groups)) {
        let removedFromCount = 0;
        window.groups.forEach(group => {
          if (group.members && Array.isArray(group.members)) {
            const memberIndex = group.members.indexOf(numericId);
            if (memberIndex > -1) {
              group.members.splice(memberIndex, 1);
              removedFromCount++;
              console.log(`✅ Removed user ${numericId} from group "${group.name}"`);
            }
          }
        });
        if (removedFromCount > 0) {
          console.log(`✅ Removed deleted user from ${removedFromCount} group(s)`);
        }
      }

      // Remove row from table
      const row = document.querySelector(`[data-user-id="${numericId}"]`);
      if (row) {
        console.log('✅ Found row in table, removing...');
        row.style.opacity = '0.5';
        row.style.transition = 'opacity 0.2s';
        setTimeout(() => row.remove(), 200);
      } else {
        console.warn('⚠️ Row not found in table with data-user-id="' + numericId + '"');
      }

      // Save locally - save both users and groups
      if (typeof window.saveUserData === 'function') {
        window.saveUserData();
        console.log('✅ Saved users to localStorage');
      }
      if (typeof window.saveGroups === 'function') {
        window.saveGroups();
        console.log('✅ Saved groups to localStorage');
      }

      // Refresh groups display immediately so member lists are up-to-date
      if (typeof window.populateGroups === 'function') {
        window.populateGroups();
        console.log('✅ Groups display refreshed');
      }

      // Sync to Supabase in background with proper error handling
      if (!window.supabaseClient) {
        console.error('❌ Supabase client not available! Waiting for initialization...');
        // Wait for client to be available
        let attempts = 0;
        while (!window.supabaseClient && attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 500));
          attempts++;
        }
        if (!window.supabaseClient) {
          alert('❌ ERROR: Supabase client failed to initialize!');
          return;
        }
        console.log('✅ Supabase client available after waiting');
      }
      
      console.log('🔄 [SUPABASE DELETE] Sending delete request for ID:', numericId);
      
      const { data, error } = await window.supabaseClient
        .from('users')
        .delete()
        .eq('id', numericId);
      
      if (error) {
        console.error('❌ [SUPABASE ERROR] Deletion failed:', error);
        console.error('   Error Code:', error.code);
        console.error('   Error Message:', error.message);
        console.error('   Error Details:', error.details);
        console.error('   Error Hint:', error.hint);
        
        // Show alert to user
        alert('❌ DELETE FAILED! Check console for details.\n\nError: ' + error.message);
      } else {
        console.log('✅ [SUPABASE SUCCESS] User deleted from Supabase');
        console.log('   ID:', numericId);
        console.log('   Data:', data);
        log('✅ User deleted from Supabase (id: ' + numericId + ')');
        
        // Show success notification
        if (typeof window.showTemporaryMessage === 'function') {
          window.showTemporaryMessage('✅ User successfully deleted from Supabase!', 'success');
        }
      }
    } catch (error) {
      console.error('❌ [ERROR] Exception in optimized delete:', error);
      console.error('   Stack:', error.stack);
      alert('❌ ERROR: ' + error.message);
    }
  };

  // Optimized group member addition - fetch fresh Supabase data first
  window.addMemberOptimized = async function(groupId) {
    try {
      console.log('👥 [ADD MEMBER START] Fetching fresh data from Supabase...');
      
      // Fetch real data from Supabase to avoid deleted users showing up
      const groups = Array.isArray(window.groups) ? window.groups : [];
      if (!window.supabaseClient) {
        console.warn('⚠️ Supabase client not available, using cached data');
      } else {
        try {
          // Get fresh user list from Supabase
          const { data: freshUsers, error: usersError } = await window.supabaseClient
            .from('users')
            .select('id, full_name, registration_number, phone_number, email, status, group_id');

          if (!usersError && freshUsers) {
            console.log('✅ Fetched ' + freshUsers.length + ' fresh users from Supabase');

            // CRITICAL: Filter out deleted users using the deleted tracker
            const nonDeletedUsers = freshUsers.filter(u => !window.deletedUsersTracker.isDeleted(u.id));
            console.log('🧹 [DELETED TRACKER] Filtered out ' + (freshUsers.length - nonDeletedUsers.length) + ' deleted users');

            // Transform Supabase data to match frontend format and normalize IDs to Numbers
            window.userData = nonDeletedUsers.map(u => ({
              id: u.id != null ? (typeof u.id === 'string' ? parseInt(u.id, 10) : u.id) : null,
              name: u.full_name,
              regNo: u.registration_number,
              phone: u.phone_number,
              email: u.email,
              status: u.status,
              groupId: u.group_id || null,
              group: (groups.find(g => g.id === u.group_id) || {}).name || null
            }));

            // Save to localStorage
            if (typeof window.saveUserData === 'function') {
              window.saveUserData();
            }
          } else if (usersError) {
            console.error('⚠️ Failed to fetch fresh users:', usersError);
          }
        } catch (fetchError) {
          console.error('⚠️ Error fetching fresh data:', fetchError);
        }
      }
      
      // Now find unassigned users from the fresh data (deleted users already filtered out above)
      const userDataArr = Array.isArray(window.userData) ? window.userData : [];
      const groupArr = Array.isArray(window.groups) ? window.groups : [];

      const unassignedUsers = userDataArr.filter(user => {
        // Extra safety: also check deleted tracker here
        if (window.deletedUsersTracker.isDeleted(user.id)) {
          console.log('🚫 [DELETED TRACKER] Skipping deleted user:', user.name);
          return false;
        }
        const inAnyGroup = groupArr.some(g => g.members && g.members.includes(user.id));
        return !inAnyGroup;
      });

      if (unassignedUsers.length === 0) {
        console.warn('⚠️ No unassigned users available');
        if (typeof window.showTemporaryMessage === 'function') {
          window.showTemporaryMessage('No unassigned users available', 'warning');
        }
        return;
      }

      console.log('✅ Found ' + unassignedUsers.length + ' unassigned users');
      console.log('🔍 Looking for group ID:', groupId, 'in', groupArr.length, 'groups');
      console.log('📋 Available group IDs:', groupArr.map(g => ({ name: g.name, id: g.id })));

      const group = groupArr.find(g => g.id === groupId);
      if (!group) {
        console.error('❌ Group not found:', groupId);
        console.error('   Available groups:', groupArr.map(g => ({ name: g.name, id: g.id, idType: typeof g.id })));
        return;
      }

      // Pick first unassigned user that has a valid id
      const userToAdd = unassignedUsers.find(u => u.id != null);
      if (!userToAdd) {
        console.error('❌ No unassigned user with valid id available to add');
        return;
      }
      console.log('👤 Adding user:', userToAdd.name, 'to group:', group.name);

      // Optimistic update
      if (!Array.isArray(group.members)) group.members = [];
      const memberId = typeof userToAdd.id === 'string' ? parseInt(userToAdd.id, 10) : userToAdd.id;
      if (memberId == null || Number.isNaN(memberId)) {
        console.error('❌ Invalid member id for user:', userToAdd);
        return;
      }
      group.members.push(memberId);
      userToAdd.group = group.name;

      // Update UI immediately
      if (typeof window.populateGroups === 'function') window.populateGroups();
      if (typeof window.populateUserTable === 'function') window.populateUserTable();

      // Save locally
      if (typeof window.saveGroups === 'function') window.saveGroups();
      if (typeof window.saveUserData === 'function') window.saveUserData();

      console.log('✅ [ADD MEMBER SUCCESS] ' + userToAdd.name + ' added to ' + group.name);
      if (typeof window.showTemporaryMessage === 'function') {
        window.showTemporaryMessage('✅ ' + userToAdd.name + ' added to ' + group.name, 'success');
      }

      // Batch sync to Supabase
      // Ensure members array contains only non-deleted numeric IDs
      const cleanedMembers = window.deletedUsersTracker.filterOutDeletedIds(group.members.map(m => (typeof m === 'string' ? parseInt(m, 10) : m)));
      syncQueue.add('groups', groupId, {
        id: group.id,
        name: group.name,
        size: group.size,
        members: cleanedMembers
      });

      // Queue user upsert only if id is valid
      syncQueue.add('users', memberId, {
        id: memberId,
        full_name: userToAdd.name,
        registration_number: userToAdd.regNo,
        phone_number: userToAdd.phone,
        email: userToAdd.email,
        group_id: group.id,
        status: userToAdd.status
      });
    } catch (error) {
      console.error('❌ Error in optimized add member:', error);
      alert('❌ ERROR: ' + error.message);
    }
  };

  // Optimized user save - batched with debouncing
  const debouncedSaveUser = debounce(async (user) => {
    console.log('💾 [SAVE USER] Processing user:', user.name, 'ID:', user.id, 'Type:', typeof user.id);
    if (!window.supabaseClient || !user) {
      console.warn('⚠️ [SAVE USER] No client or user object');
      return;
    }

    const uid = user.id != null ? (typeof user.id === 'string' ? parseInt(user.id, 10) : user.id) : null;
    console.log('💾 [SAVE USER] Numeric ID:', uid, 'Valid:', uid != null && !Number.isNaN(uid));
    if (uid == null || Number.isNaN(uid)) {
      console.warn('⚠️ [SAVE USER] SKIPPING - missing or invalid id for user:', user.name, 'id was:', user.id);
      return;
    }

    const userData = {
      id: uid,
      full_name: user.name || '',
      registration_number: user.regNo || '',
      phone_number: user.phone || '',
      email: user.email || '',
      status: user.status || 'active',
      group_id: user.groupId || null
    };

    console.log('💾 [SAVE USER] Queuing user:', userData);
    syncQueue.add('users', uid, userData);
    log(`Queued user ${user.name} (id:${uid}) for batch sync`);
  }, 300);

  window.saveUserOptimized = function(user) {
    debouncedSaveUser(user);
  };

  // Parallel operation executor for independent operations
  window.syncMultipleOptimized = async function(operations) {
    try {
      const promises = operations.map(op => {
        if (op.type === 'delete') {
          return window.supabaseClient
            .from('users')
            .delete()
            .eq('id', op.id);
        } else if (op.type === 'upsert') {
          return window.supabaseClient
            .from('users')
            .upsert([op.data], { onConflict: 'id' });
        }
      });

      const results = await Promise.all(promises);
      log(`✅ Executed ${results.length} operations in parallel`);
      return results;
    } catch (error) {
      console.error('❌ Parallel sync failed:', error);
    }
  };

  // Expose sync helpers
  window.supabaseSyncOptimized = {
    deleteUser: window.deleteUserOptimized,
    addMember: window.addMemberOptimized,
    saveUser: window.saveUserOptimized,
    syncMultiple: window.syncMultipleOptimized,
    flushQueue: () => syncQueue.flush()
  };

  log('Optimized sync module loaded');
})();
