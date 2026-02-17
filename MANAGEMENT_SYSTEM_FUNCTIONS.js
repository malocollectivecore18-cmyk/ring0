// ============================================
// SUPABASE-INTEGRATED USER MANAGEMENT SYSTEM
// FOR MEMBERS SIGN UP, DATA FRAMEWORK, USER MANAGEMENT, GROUPS, & SETTINGS
// ============================================

// ========== INITIALIZE SUPABASE CLIENT ==========
let supabaseClient = null;
let supabaseUrl = 'https://xzgvbhewxzvuixcjpglp.supabase.co';
let supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6Z3ZiaGV3eHp2dWl4Y2pwZ2xwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc2MDEwMDAsImV4cCI6MjA1MzE3NzAwMH0.6P1P2N7Dkz_PU1L0A8NzK5M9W4Q3X6Y7Z8B2C5D6E9F1G2';

// Initialize Supabase
if (typeof window.supabase !== 'undefined') {
  supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
  console.log('✅ Supabase client initialized');
} else {
  console.warn('⚠️ Supabase library not loaded. Using localStorage fallback.');
}

// ========== DATA STRUCTURES ==========
let dataFramework = [];
let userData = [];
let groups = [];
let currentCaseUserId = null;
let selectedUserForMove = null;
let groupToMoveTo = null;
let groupOrderType = 'alphabetical';

// Default framework
const defaultFramework = [
  { name: 'Full Name', type: 'text', required: 'yes', order: 1 },
  { name: 'Registration Number', type: 'text', required: 'yes', order: 2 },
  { name: 'Phone Number', type: 'phone', required: 'yes', order: 3 }
];

const defaultUsers = [];
const defaultGroups = [];

// ========== OPEN USER MANAGEMENT ==========
async function openUserManagement() {
  document.getElementById('dashboardMenu').style.display = 'none';
  document.getElementById('userManagementSection').style.display = 'block';
  await initializeUserManagement();
}

// ========== INITIALIZE USER MANAGEMENT ==========
async function initializeUserManagement() {
  console.log('🚀 Initializing User Management System...');
  
  // Load from localStorage first (fast)
  loadDataFramework();
  loadUserData();
  loadGroups();
  updateRegistrationSwitch();
  
  // Update UI with cached data
  updateFrameworkPreview();
  generateRegistrationFormPreview();
  populateUserTable();
  populateGroups();
  
  // Set up event listeners
  const registrationSwitch = document.getElementById('registrationSwitch');
  if (registrationSwitch) {
    registrationSwitch.addEventListener('change', updateRegistrationVisibility);
  }
  
  const addUserForm = document.getElementById('addUserForm');
  if (addUserForm) {
    addUserForm.addEventListener('submit', handleAddUser);
  }
  
  const editUserForm = document.getElementById('editUserForm');
  if (editUserForm) {
    editUserForm.addEventListener('submit', handleEditUser);
  }
  
  // Try to sync with Supabase
  if (supabaseClient) {
    console.log('📡 Syncing with Supabase...');
    try {
      await syncAllDataFromSupabase();
      populateUserTable();
      populateGroups();
      updateFrameworkPreview();
      generateRegistrationFormPreview();
      console.log('✅ Supabase sync complete');
    } catch (error) {
      console.warn('⚠️ Supabase sync failed:', error.message);
    }
  }
  
  console.log('✅ User Management System initialized');
}

// ========== SUPABASE SYNC FUNCTIONS ==========
async function syncAllDataFromSupabase() {
  if (!supabaseClient) return;
  
  try {
    // Sync fields
    const { data: fieldsData } = await supabaseClient
      .from('registration_fields')
      .select('*')
      .order('field_order', { ascending: true });
    
    if (fieldsData && fieldsData.length > 0) {
      dataFramework = fieldsData.map(f => ({
        name: f.field_name,
        type: f.field_type,
        required: f.is_required ? 'yes' : 'no',
        order: f.field_order
      }));
      saveDataFramework();
      console.log('✅ Fields synced:', dataFramework.length);
    }
    
    // Sync users
    const { data: usersData } = await supabaseClient
      .from('users')
      .select('*');
    
    if (usersData && usersData.length > 0) {
      userData = usersData.map(u => ({
        id: u.id,
        name: u.dynamic_fields?.name || 'Unknown',
        regNo: u.registration_number,
        phone: u.dynamic_fields?.phone || '',
        email: u.dynamic_fields?.email || '',
        group: u.group_id ? (groups.find(g => g.id === u.group_id)?.name || 'Ungrouped') : 'Ungrouped',
        status: u.status,
        caseInfo: u.case_info || '',
        formData: u.dynamic_fields || {}
      }));
      saveUserData();
      console.log('✅ Users synced:', userData.length);
    }
    
    // Sync groups
    const { data: groupsData } = await supabaseClient
      .from('user_groups')
      .select('*');
    
    if (groupsData && groupsData.length > 0) {
      groups = groupsData.map(g => ({
        id: g.id,
        name: g.name,
        size: g.size,
        members: g.members || [],
        leader: g.leader_id,
        flagged: g.is_flagged || false
      }));
      saveGroups();
      console.log('✅ Groups synced:', groups.length);
    }
    
    // Sync registration settings
    const { data: settingsData } = await supabaseClient
      .from('registration_settings')
      .select('*')
      .limit(1);
    
    if (settingsData && settingsData.length > 0) {
      localStorage.setItem('ring0_registration_enabled', settingsData[0].is_registration_enabled);
      console.log('✅ Settings synced');
    }
  } catch (error) {
    console.error('❌ Supabase sync error:', error);
  }
}

// ========== DATA FRAMEWORK MANAGEMENT ==========
function loadDataFramework() {
  const saved = localStorage.getItem('ring0_data_framework');
  dataFramework = saved ? JSON.parse(saved) : [...defaultFramework];
}

function saveDataFramework() {
  localStorage.setItem('ring0_data_framework', JSON.stringify(dataFramework));
  updateFrameworkPreview();
  generateRegistrationFormPreview();
}

async function addField() {
  const name = document.getElementById('fieldName').value.trim();
  const type = document.getElementById('fieldType').value;
  const required = document.getElementById('fieldRequired').value;
  
  if (!name) {
    showTemporaryMessage('Please enter a field name', 'warning');
    return;
  }
  
  const field = {
    name, type, required,
    order: dataFramework.length + 1
  };
  
  // Try Supabase first
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('registration_fields')
        .insert([{
          field_name: name,
          field_type: type,
          is_required: required === 'yes',
          field_order: field.order
        }]);
      
      if (error) {
        console.warn('⚠️ Supabase insert error:', error.message);
      } else {
        console.log('✅ Field saved to Supabase');
      }
    } catch (err) {
      console.warn('⚠️ Supabase save failed:', err.message);
    }
  }
  
  dataFramework.push(field);
  saveDataFramework();
  
  document.getElementById('fieldName').value = '';
  document.getElementById('fieldType').value = 'text';
  document.getElementById('fieldRequired').value = 'yes';
  
  showTemporaryMessage('Field added successfully!', 'success');
}

function updateFrameworkPreview() {
  const tbody = document.getElementById('frameworkFields');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  dataFramework.forEach((field, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${field.name}</td>
      <td>${field.type}</td>
      <td>${field.required === 'yes' ? '✓ Required' : 'Optional'}</td>
      <td>
        <button class="user-action-btn user-action-edit-btn" onclick="editField(${index})">Edit</button>
        <button class="user-action-btn user-action-delete-btn" onclick="removeField(${index})">Remove</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function editField(index) {
  const field = dataFramework[index];
  document.getElementById('fieldName').value = field.name;
  document.getElementById('fieldType').value = field.type;
  document.getElementById('fieldRequired').value = field.required;
  dataFramework.splice(index, 1);
  saveDataFramework();
}

function removeField(index) {
  if (confirm('Remove this field?')) {
    dataFramework.splice(index, 1);
    saveDataFramework();
  }
}

function resetFramework() {
  if (confirm('Reset framework? This will affect all existing user data.')) {
    dataFramework = [...defaultFramework];
    saveDataFramework();
  }
}

function generateRegistrationFormPreview() {
  const preview = document.getElementById('registrationFormPreview');
  if (!preview) return;
  
  let html = '';
  dataFramework.forEach(field => {
    html += `
      <div class="form-group" style="margin-bottom: 15px;">
        <label class="form-label" style="display: block; margin-bottom: 5px; color: var(--text);">
          ${field.name} ${field.required === 'yes' ? '<span style="color: var(--warning);">*</span>' : ''}
        </label>
        ${getFieldInputHTML(field)}
      </div>
    `;
  });
  
  html += '<button class="form-btn primary" style="margin-top: 20px;">Submit Registration</button>';
  preview.innerHTML = html;
}

function getFieldInputHTML(field) {
  switch(field.type) {
    case 'text':
    case 'email':
    case 'phone':
    case 'number':
      return `<input type="${field.type}" class="form-input" placeholder="Enter ${field.name.toLowerCase()}" ${field.required === 'yes' ? 'required' : ''} style="width: 100%;">`;
    case 'date':
      return `<input type="date" class="form-input" ${field.required === 'yes' ? 'required' : ''} style="width: 100%;">`;
    case 'select':
      return `
        <select class="form-select" ${field.required === 'yes' ? 'required' : ''} style="width: 100%;">
          <option value="">Select ${field.name}</option>
          <option value="option1">Option 1</option>
          <option value="option2">Option 2</option>
          <option value="option3">Option 3</option>
        </select>
      `;
    default:
      return `<input type="text" class="form-input" placeholder="Enter ${field.name.toLowerCase()}" ${field.required === 'yes' ? 'required' : ''} style="width: 100%;">`;
  }
}

// ========== USER MANAGEMENT ==========
function loadUserData() {
  const saved = localStorage.getItem('ring0_user_data');
  userData = saved ? JSON.parse(saved) : [...defaultUsers];
}

function saveUserData() {
  localStorage.setItem('ring0_user_data', JSON.stringify(userData));
}

function populateUserTable() {
  const tbody = document.getElementById('userTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (userData.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="user-empty-state">
          <div class="user-empty-icon">👤</div>
          <h3>No Users Found</h3>
          <p>Add your first user using the "Add New User" button.</p>
        </td>
      </tr>
    `;
    return;
  }
  
  userData.forEach(user => {
    const row = document.createElement('tr');
    if (user.status === 'flagged') {
      row.classList.add('red-flag');
    }
    
    row.innerHTML = `
      <td>${user.name}</td>
      <td>${user.regNo}</td>
      <td>${user.phone}</td>
      <td>${user.email || 'N/A'}</td>
      <td>${user.group || 'Not assigned'}</td>
      <td>
        <span class="user-status-badge user-status-${user.status}">
          ${user.status.charAt(0).toUpperCase() + user.status.slice(1)}
        </span>
        ${user.caseInfo ? '<button class="user-action-flag-btn" onclick="showCaseInfo(' + user.id + ')">View Case</button>' : ''}
      </td>
      <td>
        <div class="user-action-buttons">
          <button class="user-action-btn user-action-edit-btn" onclick="openEditUserModal('${user.id}')">Edit</button>
          <button class="user-action-btn user-action-delete-btn" onclick="deleteUser('${user.id}')">Delete</button>
          ${user.status !== 'flagged' ? '<button class="user-action-flag-btn" onclick="openCaseModal(\'' + user.id + '\')">Flag</button>' : '<button class="user-action-flag-btn" onclick="unflagUser(\'' + user.id + '\')">Unflag</button>'}
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function searchUsers() {
  const searchTerm = document.getElementById('userSearch').value.toLowerCase();
  const filtered = userData.filter(u =>
    u.name?.toLowerCase().includes(searchTerm) ||
    u.regNo?.toLowerCase().includes(searchTerm) ||
    u.email?.toLowerCase().includes(searchTerm) ||
    u.phone?.includes(searchTerm)
  );
  updateTableWithFilteredUsers(filtered);
}

function filterUsers() {
  const status = document.getElementById('statusFilter').value;
  if (status === 'all') {
    populateUserTable();
  } else {
    updateTableWithFilteredUsers(userData.filter(u => u.status === status));
  }
}

function updateTableWithFilteredUsers(filtered) {
  const tbody = document.getElementById('userTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--muted);">No users found</td></tr>';
    return;
  }
  
  filtered.forEach(user => {
    const row = document.createElement('tr');
    if (user.status === 'flagged') row.classList.add('red-flag');
    
    row.innerHTML = `
      <td>${user.name}</td>
      <td>${user.regNo}</td>
      <td>${user.phone}</td>
      <td>${user.email || 'N/A'}</td>
      <td>${user.group || 'Not assigned'}</td>
      <td>
        <span class="user-status-badge user-status-${user.status}">
          ${user.status.charAt(0).toUpperCase() + user.status.slice(1)}
        </span>
      </td>
      <td>
        <div class="user-action-buttons">
          <button class="user-action-btn user-action-edit-btn" onclick="openEditUserModal('${user.id}')">Edit</button>
          <button class="user-action-btn user-action-delete-btn" onclick="deleteUser('${user.id}')">Delete</button>
          ${user.status !== 'flagged' ? '<button class="user-action-flag-btn" onclick="openCaseModal(\'' + user.id + '\')">Flag</button>' : '<button class="user-action-flag-btn" onclick="unflagUser(\'' + user.id + '\')">Unflag</button>'}
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function openAddUserModal() {
  const container = document.getElementById('addUserFields');
  if (!container) return;
  
  container.innerHTML = '';
  dataFramework.forEach(field => {
    const fieldName = field.name.toLowerCase().replace(/\s+/g, '_');
    container.innerHTML += `
      <div class="form-group">
        <label class="form-label">${field.name} ${field.required === 'yes' ? '<span style="color: var(--warning);">*</span>' : ''}</label>
        ${getFieldInputHTML(field).replace('form-input', 'form-input new-user-field').replace('placeholder', `placeholder="Enter ${field.name.toLowerCase()}" data-field="${fieldName}"`)}
      </div>
    `;
  });
  
  document.getElementById('addUserModal').classList.add('active');
}

function closeAddUserModal() {
  document.getElementById('addUserModal').classList.remove('active');
}

async function handleAddUser(e) {
  e.preventDefault();
  
  const newUser = {
    id: Date.now().toString(),
    status: 'active',
    group: '',
    formData: {}
  };
  
  const inputs = document.querySelectorAll('.new-user-field');
  inputs.forEach(input => {
    const fieldName = input.getAttribute('data-field');
    const fieldValue = input.value.trim();
    
    if (fieldName.includes('name')) newUser.name = fieldValue;
    else if (fieldName.includes('reg')) newUser.regNo = fieldValue;
    else if (fieldName.includes('phone')) newUser.phone = fieldValue;
    else if (fieldName.includes('email')) newUser.email = fieldValue;
    else newUser[fieldName] = fieldValue;
    
    newUser.formData[fieldName] = fieldValue;
  });
  
  // Check duplicates
  const duplicate = userData.find(u => u.regNo === newUser.regNo || (newUser.email && u.email === newUser.email));
  if (duplicate) {
    showTemporaryMessage('User with this registration number or email already exists!', 'warning');
    return;
  }
  
  // Try Supabase first
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('users')
        .insert([{
          id: newUser.id,
          registration_number: newUser.regNo,
          status: 'active',
          dynamic_fields: newUser.formData
        }]);
      
      if (error) {
        console.warn('⚠️ Supabase error:', error.message);
      } else {
        console.log('✅ User saved to Supabase');
      }
    } catch (err) {
      console.warn('⚠️ Supabase save failed:', err.message);
    }
  }
  
  userData.push(newUser);
  saveUserData();
  populateUserTable();
  closeAddUserModal();
  showTemporaryMessage('User added successfully!', 'success');
}

function openEditUserModal(userId) {
  const user = userData.find(u => u.id === userId);
  if (!user) return;
  
  const container = document.getElementById('editUserFields');
  if (!container) return;
  
  container.innerHTML = `<input type="hidden" id="editUserId" value="${user.id}">`;
  
  dataFramework.forEach(field => {
    const fieldName = field.name.toLowerCase().replace(/\s+/g, '_');
    const fieldValue = user[fieldName] || user.formData?.[fieldName] || '';
    
    container.innerHTML += `
      <div class="form-group">
        <label class="form-label">${field.name}</label>
        ${getFieldInputHTML(field).replace('form-input', 'form-input edit-user-field').replace('value=""', `value="${fieldValue}"`).replace('>', ` data-field="${fieldName}">`)}
      </div>
    `;
  });
  
  document.getElementById('editUserModal').classList.add('active');
}

function closeEditUserModal() {
  document.getElementById('editUserModal').classList.remove('active');
}

async function handleEditUser(e) {
  e.preventDefault();
  
  const userId = document.getElementById('editUserId').value;
  const userIndex = userData.findIndex(u => u.id === userId);
  
  if (userIndex === -1) return;
  
  const inputs = document.querySelectorAll('.edit-user-field');
  inputs.forEach(input => {
    const fieldName = input.getAttribute('data-field');
    const fieldValue = input.value.trim();
    userData[userIndex][fieldName] = fieldValue;
    userData[userIndex].formData[fieldName] = fieldValue;
  });
  
  // Try Supabase update
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('users')
        .update({
          dynamic_fields: userData[userIndex].formData,
          registration_number: userData[userIndex].regNo
        })
        .eq('id', userId);
      
      if (error) {
        console.warn('⚠️ Supabase update error:', error.message);
      } else {
        console.log('✅ User updated in Supabase');
      }
    } catch (err) {
      console.warn('⚠️ Supabase update failed:', err.message);
    }
  }
  
  saveUserData();
  populateUserTable();
  closeEditUserModal();
  showTemporaryMessage('User updated successfully!', 'success');
}

async function deleteUser(userId) {
  if (!confirm('Delete this user? This cannot be undone.')) return;
  
  // Try Supabase delete first
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('users')
        .delete()
        .eq('id', userId);
      
      if (error) {
        console.warn('⚠️ Supabase delete error:', error.message);
      } else {
        console.log('✅ User deleted from Supabase');
      }
    } catch (err) {
      console.warn('⚠️ Supabase delete failed:', err.message);
    }
  }
  
  userData = userData.filter(u => u.id !== userId);
  saveUserData();
  populateUserTable();
  showTemporaryMessage('User deleted successfully!', 'warning');
}

function exportUsers() {
  const headers = dataFramework.map(f => f.name).join(',');
  const rows = userData.map(user =>
    dataFramework.map(f => {
      const fieldName = f.name.toLowerCase().replace(/\s+/g, '_');
      return `"${user[fieldName] || ''}"`;
    }).join(',')
  ).join('\n');
  
  const csv = headers + '\n' + rows;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'users_export.csv';
  a.click();
  
  showTemporaryMessage('Users exported successfully!', 'success');
}

function openCaseModal(userId) {
  currentCaseUserId = userId;
  document.getElementById('caseDetails').value = '';
  document.getElementById('caseModal').classList.add('active');
}

function closeCaseModal() {
  document.getElementById('caseModal').classList.remove('active');
  currentCaseUserId = null;
}

function saveCaseInfo() {
  const caseDetails = document.getElementById('caseDetails').value.trim();
  if (!caseDetails) {
    showTemporaryMessage('Please enter case details', 'warning');
    return;
  }
  
  const userIndex = userData.findIndex(u => u.id === currentCaseUserId);
  if (userIndex === -1) return;
  
  userData[userIndex].caseInfo = caseDetails;
  userData[userIndex].status = 'flagged';
  saveUserData();
  populateUserTable();
  closeCaseModal();
  
  showTemporaryMessage('Case information saved! User flagged.', 'warning');
}

function unflagUser(userId) {
  if (!confirm('Unflag this user?')) return;
  
  const userIndex = userData.findIndex(u => u.id === userId);
  if (userIndex === -1) return;
  
  userData[userIndex].status = 'active';
  userData[userIndex].caseInfo = '';
  saveUserData();
  populateUserTable();
  
  showTemporaryMessage(userData[userIndex].name + ' has been unflagged!', 'success');
}

function showCaseInfo(userId) {
  const user = userData.find(u => u.id === userId);
  if (user && user.caseInfo) {
    alert(`Case Information for ${user.name}:\n\n${user.caseInfo}`);
  }
}

// ========== GROUP MANAGEMENT ==========
function loadGroups() {
  const saved = localStorage.getItem('ring0_user_groups');
  groups = saved ? JSON.parse(saved) : [...defaultGroups];
}

function saveGroups() {
  localStorage.setItem('ring0_user_groups', JSON.stringify(groups));
}

async function createGroups() {
  const groupSize = parseInt(document.getElementById('groupSize').value);
  
  if (!groupSize || groupSize < 1) {
    showTemporaryMessage('Please enter a valid group size', 'warning');
    return;
  }
  
  groups = [];
  const totalUsers = userData.length;
  const numGroups = Math.ceil(totalUsers / groupSize);
  
  for (let i = 0; i < numGroups; i++) {
    groups.push({
      id: Date.now().toString() + i,
      name: `Group ${String.fromCharCode(65 + i)}`,
      size: groupSize,
      members: [],
      leader: null,
      flagged: false
    });
  }
  
  // Try Supabase insert
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('user_groups')
        .insert(groups.map(g => ({
          id: g.id,
          name: g.name,
          size: g.size,
          members: g.members,
          is_flagged: g.flagged
        })));
      
      if (error) {
        console.warn('⚠️ Supabase error:', error.message);
      } else {
        console.log('✅ Groups saved to Supabase');
      }
    } catch (err) {
      console.warn('⚠️ Supabase save failed:', err.message);
    }
  }
  
  saveGroups();
  populateGroups();
  showTemporaryMessage(numGroups + ' groups created!', 'success');
}

async function autoAssignGroups() {
  if (groups.length === 0) {
    showTemporaryMessage('Please create groups first', 'warning');
    return;
  }
  
  groups.forEach(g => g.members = []);
  
  userData.forEach((user, index) => {
    const groupIndex = index % groups.length;
    groups[groupIndex].members.push(user.id);
    user.group = groups[groupIndex].name;
  });
  
  // Try Supabase update
  if (supabaseClient) {
    try {
      for (const group of groups) {
        await supabaseClient
          .from('user_groups')
          .update({ members: group.members })
          .eq('id', group.id);
      }
      console.log('✅ Groups updated in Supabase');
    } catch (err) {
      console.warn('⚠️ Supabase update failed:', err.message);
    }
  }
  
  saveGroups();
  saveUserData();
  populateGroups();
  populateUserTable();
  showTemporaryMessage('Users auto-assigned to groups!', 'success');
}

function populateGroups() {
  const container = document.getElementById('groupList');
  if (!container) return;
  
  container.innerHTML = '';
  
  if (groups.length === 0) {
    container.innerHTML = `
      <div class="user-empty-state">
        <div class="user-empty-icon">👥</div>
        <h3>No Groups Created</h3>
        <p>Create groups using the controls above.</p>
      </div>
    `;
    return;
  }
  
  groups.forEach(group => {
    const groupCard = document.createElement('div');
    groupCard.className = `group-card ${group.flagged ? 'flagged-group' : ''}`;
    
    const memberNames = group.members.map(memberId => {
      const user = userData.find(u => u.id === memberId);
      return user ? user.name : `User ${memberId}`;
    });
    
    groupCard.innerHTML = `
      <div class="group-header">
        <div class="group-title">${group.name}</div>
        <button class="group-action-btn" onclick="openGroupActionModal('${group.id}')" title="Actions">?</button>
        <div class="group-count">${group.members.length}/${group.size}</div>
      </div>
      <ul class="group-members">
        ${memberNames.map((name, idx) => `
          <li class="group-member">
            <span>${name}</span>
            <button class="move-user-btn" onclick="startMoveUser('${group.members[idx]}', '${group.id}')">Move</button>
          </li>
        `).join('')}
      </ul>
    `;
    container.appendChild(groupCard);
  });
}

function startMoveUser(userId, fromGroupId) {
  selectedUserForMove = userId;
  groupToMoveTo = null;
  
  const user = userData.find(u => u.id === userId);
  if (!user) return;
  
  showMoveUserModal(user.name, fromGroupId);
}

function showMoveUserModal(userName, fromGroupId) {
  const modal = document.createElement('div');
  modal.className = 'move-user-modal active';
  modal.id = 'moveUserModal';
  
  const availableGroups = groups.filter(g => g.id !== fromGroupId);
  
  modal.innerHTML = `
    <div class="move-user-content">
      <div class="modal-title" style="color: var(--accent); margin-bottom: 15px;">
        Move User: <span style="color: var(--text);">${userName}</span>
      </div>
      
      <div class="groups-list-move" id="groupsListMove">
        ${availableGroups.map(g => {
          const isFull = g.members.length >= g.size;
          return `
            <div class="group-item-move ${isFull ? 'disabled' : ''}" onclick="${isFull ? '' : `selectGroupForMove('${g.id}')`}">
              <div style="display: flex; justify-content: space-between;">
                <strong>${g.name}</strong>
                <span style="color: ${isFull ? 'var(--warning)' : 'var(--muted)'};">
                  ${g.members.length}/${g.size} ${isFull ? '(Full)' : ''}
                </span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      
      <div class="modal-buttons">
        <button class="modal-btn cancel" onclick="closeMoveModal()">Cancel</button>
        <button class="modal-btn yes" onclick="completeMoveUser()" id="confirmMoveBtn" disabled>Move User</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

function selectGroupForMove(groupId) {
  groupToMoveTo = groupId;
  document.getElementById('confirmMoveBtn').disabled = false;
}

async function completeMoveUser() {
  if (!selectedUserForMove || !groupToMoveTo) return;
  
  const currentGroup = groups.find(g => g.members.includes(selectedUserForMove));
  const targetGroup = groups.find(g => g.id === groupToMoveTo);
  
  if (!currentGroup || !targetGroup) return;
  
  if (targetGroup.members.length >= targetGroup.size) {
    showTemporaryMessage('Target group is full!', 'warning');
    return;
  }
  
  currentGroup.members = currentGroup.members.filter(id => id !== selectedUserForMove);
  targetGroup.members.push(selectedUserForMove);
  
  const userIndex = userData.findIndex(u => u.id === selectedUserForMove);
  if (userIndex !== -1) {
    userData[userIndex].group = targetGroup.name;
  }
  
  // Try Supabase update
  if (supabaseClient) {
    try {
      await supabaseClient
        .from('user_groups')
        .update({ members: targetGroup.members })
        .eq('id', targetGroup.id);
      
      await supabaseClient
        .from('user_groups')
        .update({ members: currentGroup.members })
        .eq('id', currentGroup.id);
      
      console.log('✅ Move saved to Supabase');
    } catch (err) {
      console.warn('⚠️ Supabase update failed:', err.message);
    }
  }
  
  saveGroups();
  saveUserData();
  closeMoveModal();
  populateGroups();
  populateUserTable();
  showTemporaryMessage('User moved successfully!', 'success');
}

function closeMoveModal() {
  const modal = document.getElementById('moveUserModal');
  if (modal) modal.remove();
  selectedUserForMove = null;
  groupToMoveTo = null;
}

function openGroupActionModal(groupId) {
  const group = groups.find(g => g.id === groupId);
  if (!group) return;
  
  const existing = document.getElementById('groupActionModal');
  if (existing) existing.remove();
  
  const modal = document.createElement('div');
  modal.id = 'groupActionModal';
  modal.className = 'case-modal-overlay active';
  modal.innerHTML = `
    <div class="case-modal-content" style="max-width: 420px;">
      <h3 style="color: var(--accent); margin-bottom: 10px;">Actions for ${group.name}</h3>
      <div style="display: flex; gap: 10px; margin-bottom: 14px;">
        <button class="form-btn" style="background: linear-gradient(90deg, #ef4444, #f97316); color: white;" onclick="deleteGroup('${groupId}')">🔴 Delete</button>
        <button class="form-btn" style="background: linear-gradient(90deg, #a855f7, #9333ea); color: white;" onclick="toggleFlagGroup('${groupId}')">${group.flagged ? '🟣 Unflag' : '🟣 Flag'}</button>
      </div>
      <button class="modal-btn cancel" onclick="document.getElementById('groupActionModal').remove()">Close</button>
    </div>
  `;
  document.body.appendChild(modal);
}

async function deleteGroup(groupId) {
  if (!confirm('Delete this group?')) return;
  
  const idx = groups.findIndex(g => g.id === groupId);
  if (idx === -1) return;
  
  const removed = groups.splice(idx, 1)[0];
  removed.members.forEach(uid => {
    const u = userData.find(x => x.id === uid);
    if (u) u.group = '';
  });
  
  // Try Supabase delete
  if (supabaseClient) {
    try {
      await supabaseClient
        .from('user_groups')
        .delete()
        .eq('id', groupId);
      
      console.log('✅ Group deleted from Supabase');
    } catch (err) {
      console.warn('⚠️ Supabase delete failed:', err.message);
    }
  }
  
  saveGroups();
  saveUserData();
  populateGroups();
  populateUserTable();
  
  const m = document.getElementById('groupActionModal');
  if (m) m.remove();
  
  showTemporaryMessage(removed.name + ' deleted. Members are now ungrouped.', 'success');
}

async function toggleFlagGroup(groupId) {
  const group = groups.find(g => g.id === groupId);
  if (!group) return;
  
  group.flagged = !group.flagged;
  group.members.forEach(uid => {
    const u = userData.find(x => x.id === uid);
    if (u) {
      u.status = group.flagged ? 'flagged' : 'active';
    }
  });
  
  // Try Supabase update
  if (supabaseClient) {
    try {
      await supabaseClient
        .from('user_groups')
        .update({ is_flagged: group.flagged })
        .eq('id', groupId);
      
      console.log('✅ Group flag updated in Supabase');
    } catch (err) {
      console.warn('⚠️ Supabase update failed:', err.message);
    }
  }
  
  saveGroups();
  saveUserData();
  populateGroups();
  populateUserTable();
  
  const m = document.getElementById('groupActionModal');
  if (m) m.remove();
  
  showTemporaryMessage(group.flagged ? 'Group flagged.' : 'Group unflagged.', group.flagged ? 'warning' : 'success');
}

// ========== REGISTRATION SETTINGS ==========
function updateRegistrationSwitch() {
  const isEnabled = localStorage.getItem('ring0_registration_enabled') !== 'false';
  const switch_el = document.getElementById('registrationSwitch');
  if (switch_el) {
    switch_el.checked = isEnabled;
  }
}

async function updateRegistrationVisibility() {
  const switch_el = document.getElementById('registrationSwitch');
  if (!switch_el) return;
  
  const isEnabled = switch_el.checked;
  
  localStorage.setItem('ring0_registration_enabled', isEnabled);
  
  const menuButtons = document.querySelectorAll('nav button');
  const memberSignUpBtn = menuButtons[menuButtons.length - 1];
  
  if (memberSignUpBtn && memberSignUpBtn.textContent.toLowerCase().includes('member')) {
    memberSignUpBtn.style.display = isEnabled ? 'block' : 'none';
  }
  
  // Try Supabase update
  if (supabaseClient) {
    try {
      await supabaseClient
        .from('registration_settings')
        .update({ is_registration_enabled: isEnabled })
        .neq('id', 'null');
      
      console.log('✅ Registration setting updated in Supabase');
    } catch (err) {
      console.warn('⚠️ Supabase update failed:', err.message);
    }
  }
  
  showTemporaryMessage(`Member sign up ${isEnabled ? 'enabled' : 'disabled'}!`, 'success');
}

function saveRegistrationSettings() {
  updateRegistrationVisibility();
}

// ========== TAB SWITCHING ==========
function switchUserTab(tabId) {
  const userContents = document.querySelectorAll('.user-management-content');
  userContents.forEach(c => c.classList.remove('active'));
  
  const userTabs = document.querySelectorAll('.user-management-tab');
  userTabs.forEach(t => t.classList.remove('active'));
  
  const selectedTab = document.getElementById(tabId + 'Tab');
  if (selectedTab) selectedTab.classList.add('active');
  
  const clickedTab = event.target;
  clickedTab.classList.add('active');
}

console.log('✅ User Management System Script Loaded');
