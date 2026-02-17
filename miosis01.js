// ======================================================================
// ENHANCED MANAGEMENT SYSTEM - ROBUST VERSION
// ======================================================================
// This file handles User Management with Supabase PostgreSQL
// STRICT COMPLIANCE WITH POSTGRESQL SCHEMA RULES
// 
// IMPORTANT: Link this file in index.html AFTER supabase.js:
// <script src="management.js"></script>
//
// PASTE YOUR MANAGEMENT SYSTEM CODE BETWEEN MARKERS BELOW
// ======================================================================

// ================= CONFIGURATION =================
// IMPORTANT: This file MUST be loaded AFTER miosis.html initializes Supabase
// We reuse the global supabaseClient created by miosis.html to ensure consistency
const CONFIG = {
    supabaseUrl: 'https://dngbicvrkxetsrirzmwn.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRuZ2JpY3Zya3hldHNyaXJ6bXduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MzAyMTMsImV4cCI6MjA4MjUwNjIxM30.RVDwv00a5ZuwKPbgq8dVYuMhAP0L55VYxmaCHRzM6dY',
    
    // Retry configuration
    maxRetries: 3,
    retryDelay: 1000,
    connectionTimeout: 10000,
    
    // LocalStorage keys
    storagePrefix: 'ring0_',
    
    // Health check interval (ms)
    healthCheckInterval: 30000,
    
    // Conflict resolution
    conflictStrategy: 'last-write-wins' // Options: 'last-write-wins', 'merge', 'error'
};

// ================= GLOBAL STATE =================
// NOTE: supabaseClient is created globally by miosis.html
// Do NOT create a separate Supabase instance here
let isConnected = false;
let retryCount = 0;
let pendingOperations = new Map();
let connectionHealthTimer = null;

// ================= ERROR HANDLER =================
class ManagementError extends Error {
    constructor(message, code, context = {}) {
        super(message);
        this.name = 'ManagementError';
        this.code = code;
        this.context = context;
        this.timestamp = new Date().toISOString();
    }
}

const ERROR_CODES = {
    NETWORK_ERROR: 'NETWORK_ERROR',
    SUPABASE_ERROR: 'SUPABASE_ERROR',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    CONFLICT_ERROR: 'CONFLICT_ERROR',
    PERMISSION_ERROR: 'PERMISSION_ERROR',
    TIMEOUT_ERROR: 'TIMEOUT_ERROR',
    STORAGE_ERROR: 'STORAGE_ERROR'
};

function handleError(error, operation = 'unknown') {
    console.error(`❌ [${operation}] Error:`, error);
    
    // Log error details for debugging
    const errorLog = {
        timestamp: new Date().toISOString(),
        operation,
        error: {
            name: error.name,
            message: error.message,
            code: error.code,
            stack: error.stack?.split('\n').slice(0, 3).join(' ')
        },
        supabaseConnected: isConnected,
        retryCount
    };
    
    // Save to localStorage for error recovery
    try {
        const errorHistory = JSON.parse(localStorage.getItem(`${CONFIG.storagePrefix}error_history`) || '[]');
        errorHistory.push(errorLog);
        if (errorHistory.length > 50) errorHistory.shift(); // Keep last 50 errors
        localStorage.setItem(`${CONFIG.storagePrefix}error_history`, JSON.stringify(errorHistory));
    } catch (e) {
        console.warn('Could not save error to localStorage:', e);
    }
    
    // Show user-friendly message
    showTemporaryMessage(getErrorMessage(error), 'warning');
    
    // Return standardized error
    return new ManagementError(
        error.message || 'Operation failed',
        error.code || ERROR_CODES.SUPABASE_ERROR,
        { originalError: error, operation }
    );
}

function getErrorMessage(error) {
    if (error.code === '42501') return 'Permission denied. Please contact administrator.';
    if (error.code === '42P01') return 'Database configuration error.';
    if (error.message.includes('Failed to fetch')) return 'Network error. Please check connection.';
    if (error.code === ERROR_CODES.VALIDATION_ERROR) return error.message;
    return 'An error occurred. Please try again.';
}

// ================= CONNECTION STABILITY =================
// Wait for global supabaseClient from miosis.html to be ready
async function initializeSupabase() {
    console.log('🔧 Waiting for Supabase connection from miosis.html...');
    
    try {
        // Poll for supabaseClient to be ready (set by miosis.html)
        let attempts = 0;
        while (typeof window.supabaseClient === 'undefined' && attempts < 20) {
            await new Promise(r => setTimeout(r, 250));
            attempts++;
        }
        
        if (typeof window.supabaseClient === 'undefined') {
            throw new ManagementError('Supabase client not found. Ensure miosis.html loads before miosis01.js', ERROR_CODES.SUPABASE_ERROR);
        }
        
        // Test connection using global supabaseClient
        const { data, error } = await window.supabaseClient
            .from('users')
            .select('count')
            .limit(1)
            .single();
        
        clearTimeout(timeoutId);
        
        if (error) {
            throw new ManagementError(`Connection test failed: ${error.message}`, ERROR_CODES.SUPABASE_ERROR);
        }
        
        isConnected = true;
        retryCount = 0;
        console.log('✅ Supabase connection verified (using global supabaseClient)');
        
        // Start health monitoring
        startHealthMonitoring();
        
        return true;
        
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new ManagementError('Connection timeout', ERROR_CODES.TIMEOUT_ERROR);
        }
        throw handleError(error, 'initialize');
    }
}

function startHealthMonitoring() {
    if (connectionHealthTimer) clearInterval(connectionHealthTimer);
    
    connectionHealthTimer = setInterval(async () => {
        try {
            const { error } = await window.supabaseClient
                .from('users')
                .select('id')
                .limit(1);
            
            if (error) {
                isConnected = false;
                console.warn('⚠️ Connection health check failed:', error.message);
                attemptReconnection();
            } else {
                isConnected = true;
            }
        } catch (error) {
            isConnected = false;
            console.warn('⚠️ Health check error:', error.message);
        }
    }, CONFIG.healthCheckInterval);
}

async function attemptReconnection() {
    if (retryCount >= CONFIG.maxRetries) {
        console.error('❌ Max reconnection attempts reached');
        showTemporaryMessage('Connection lost. Working in offline mode.', 'warning');
        return false;
    }
    
    retryCount++;
    console.log(`🔄 Reconnection attempt ${retryCount}/${CONFIG.maxRetries}`);
    
    try {
        await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay * retryCount));
        const reconnected = await initializeSupabase();
        if (reconnected) {
            showTemporaryMessage('Connection restored!', 'success');
            retryCount = 0;
            return true;
        }
    } catch (error) {
        console.warn(`Reconnection failed (attempt ${retryCount}):`, error.message);
    }
    
    return false;
}

// ================= CONFLICT PREVENTION =================
class ConflictResolver {
    constructor() {
        this.pendingWrites = new Map();
        this.conflictHistory = [];
    }
    
    generateOperationId(table, recordId) {
        return `${table}_${recordId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    async executeWithConflictHandling(operation, table, data, operationId = null) {
        if (!operationId) {
            operationId = this.generateOperationId(table, data.id || 'new');
        }
        
        // Check if same operation is already pending
        if (this.pendingWrites.has(operationId)) {
            console.warn(`⚠️ Duplicate operation detected: ${operationId}`);
            throw new ManagementError('Duplicate operation in progress', ERROR_CODES.CONFLICT_ERROR);
        }
        
        this.pendingWrites.set(operationId, { table, data, timestamp: Date.now() });
        
        try {
            const result = await operation();
            
            // Operation successful, remove from pending
            this.pendingWrites.delete(operationId);
            
            return result;
            
        } catch (error) {
            // Remove from pending on error
            this.pendingWrites.delete(operationId);
            
            // Handle specific conflict errors
            if (error.code === '23505') { // Unique violation
                return this.handleUniqueViolation(table, data, error);
            } else if (error.code === '23503') { // Foreign key violation
                return this.handleForeignKeyViolation(table, data, error);
            }
            
            throw error;
        }
    }
    
    handleUniqueViolation(table, data, error) {
        console.warn(`🔄 Unique violation in ${table}:`, error.message);
        
        const conflictRecord = {
            table,
            data,
            error: error.message,
            timestamp: new Date().toISOString(),
            strategy: CONFIG.conflictStrategy
        };
        
        this.conflictHistory.push(conflictRecord);
        
        if (CONFIG.conflictStrategy === 'last-write-wins') {
            // For last-write-wins, we could retry with updated data
            // This is a simplified version
            throw new ManagementError(
                `Record already exists: ${error.detail}`,
                ERROR_CODES.CONFLICT_ERROR,
                { originalError: error, table, data }
            );
        } else {
            throw new ManagementError(
                'Duplicate record detected',
                ERROR_CODES.CONFLICT_ERROR,
                { originalError: error, table, data }
            );
        }
    }
    
    handleForeignKeyViolation(table, data, error) {
        console.warn(`🔄 Foreign key violation in ${table}:`, error.message);
        
        throw new ManagementError(
            'Referenced record does not exist',
            ERROR_CODES.CONFLICT_ERROR,
            { originalError: error, table, data }
        );
    }
    
    cleanupOldOperations(maxAge = 300000) { // 5 minutes
        const now = Date.now();
        for (const [id, operation] of this.pendingWrites.entries()) {
            if (now - operation.timestamp > maxAge) {
                console.warn(`🧹 Cleaning up stale operation: ${id}`);
                this.pendingWrites.delete(id);
            }
        }
    }
}

const conflictResolver = new ConflictResolver();

// ================= ROOT PROCEDURES =================
class RootProcedures {
    constructor() {
        this.procedures = new Map();
        this.registerDefaultProcedures();
    }
    
    registerDefaultProcedures() {
        // Procedure 1: Safe user creation with validation
        this.register('createUser', async (userData) => {
            // Validate required fields
            const requiredFields = ['full_name', 'registration_number'];
            for (const field of requiredFields) {
                if (!userData[field] || userData[field].trim() === '') {
                    throw new ManagementError(
                        `Missing required field: ${field}`,
                        ERROR_CODES.VALIDATION_ERROR
                    );
                }
            }
            
            // Validate email format if provided
            if (userData.email && !isValidEmail(userData.email)) {
                throw new ManagementError(
                    'Invalid email format',
                    ERROR_CODES.VALIDATION_ERROR
                );
            }
            
            // Check for duplicates in localStorage first
            const existingUsers = this.getFromStorage('user_data') || [];
            const duplicate = existingUsers.find(u => 
                u.registration_number === userData.registration_number || 
                (userData.email && u.email === userData.email)
            );
            
            if (duplicate) {
                throw new ManagementError(
                    'User with this registration number or email already exists',
                    ERROR_CODES.CONFLICT_ERROR
                );
            }
            
            // Prepare data for Supabase
            const supabaseData = {
                full_name: userData.full_name,
                registration_number: userData.registration_number,
                phone_number: userData.phone || null,
                email: userData.email || null,
                status: 'active',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            
            // Execute with conflict handling
            return await conflictResolver.executeWithConflictHandling(
                async () => {
                    const { data, error } = await supabase
                        .from('users')
                        .insert([supabaseData])
                        .select()
                        .single();
                    
                    if (error) throw error;
                    return data;
                },
                'users',
                supabaseData
            );
        });
        
        // Procedure 2: Safe user update
        this.register('updateUser', async (userId, updates) => {
            // Validate user ID
            if (!userId) {
                throw new ManagementError('User ID required', ERROR_CODES.VALIDATION_ERROR);
            }
            
            // Prepare update data
            const updateData = {
                ...updates,
                updated_at: new Date().toISOString()
            };
            
            // Remove immutable fields
            delete updateData.id;
            delete updateData.created_at;
            delete updateData.registration_number; // Cannot change registration number
            
            return await conflictResolver.executeWithConflictHandling(
                async () => {
                    const { data, error } = await supabase
                        .from('users')
                        .update(updateData)
                        .eq('id', userId)
                        .select()
                        .single();
                    
                    if (error) throw error;
                    return data;
                },
                'users',
                updateData
            );
        });
        
        // Procedure 3: Safe group management
        this.register('createGroup', async (groupData) => {
            if (!groupData.name) {
                throw new ManagementError('Group name required', ERROR_CODES.VALIDATION_ERROR);
            }
            
            const supabaseData = {
                name: groupData.name,
                size: groupData.size || 10,
                members: [],
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            
            return await conflictResolver.executeWithConflictHandling(
                async () => {
                    const { data, error } = await supabase
                        .from('user_groups')
                        .insert([supabaseData])
                        .select()
                        .single();
                    
                    if (error) throw error;
                    return data;
                },
                'user_groups',
                supabaseData
            );
        });
    }
    
    register(name, procedure) {
        this.procedures.set(name, procedure);
    }
    
    async execute(name, ...args) {
        const procedure = this.procedures.get(name);
        if (!procedure) {
            throw new ManagementError(`Procedure not found: ${name}`, ERROR_CODES.VALIDATION_ERROR);
        }
        
        try {
            return await procedure(...args);
        } catch (error) {
            throw handleError(error, `procedure:${name}`);
        }
    }
    
    getFromStorage(key) {
        try {
            const data = localStorage.getItem(`${CONFIG.storagePrefix}${key}`);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            throw new ManagementError(
                `Failed to read from storage: ${key}`,
                ERROR_CODES.STORAGE_ERROR
            );
        }
    }
    
    saveToStorage(key, data) {
        try {
            localStorage.setItem(`${CONFIG.storagePrefix}${key}`, JSON.stringify(data));
        } catch (error) {
            throw new ManagementError(
                `Failed to save to storage: ${key}`,
                ERROR_CODES.STORAGE_ERROR
            );
        }
    }
}

const rootProcedures = new RootProcedures();

// ================= UTILITY FUNCTIONS =================
function showTemporaryMessage(message, type = 'info') {
    try {
        // Remove existing messages
        const existingMessages = document.querySelectorAll('.temp-message');
        existingMessages.forEach(msg => {
            if (msg.parentNode) msg.parentNode.removeChild(msg);
        });
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `temp-message temp-message-${type}`;
        messageDiv.textContent = message;
        messageDiv.style.cssText = `
            position: fixed;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: ${type === 'success' ? 'rgba(53, 208, 127, 0.9)' : 
                        type === 'warning' ? 'rgba(255, 107, 107, 0.9)' : 
                        type === 'error' ? 'rgba(239, 68, 68, 0.9)' :
                        'rgba(91, 140, 255, 0.9)'};
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            z-index: 9999;
            font-weight: 600;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: slideDown 0.3s ease;
            max-width: 90%;
            text-align: center;
            backdrop-filter: blur(4px);
        `;
        
        // Add animation styles if not present
        if (!document.querySelector('#temp-message-styles')) {
            const style = document.createElement('style');
            style.id = 'temp-message-styles';
            style.textContent = `
                @keyframes slideDown {
                    from { transform: translateX(-50%) translateY(-20px); opacity: 0; }
                    to { transform: translateX(-50%) translateY(0); opacity: 1; }
                }
                @keyframes slideUp {
                    from { transform: translateX(-50%) translateY(0); opacity: 1; }
                    to { transform: translateX(-50%) translateY(-20px); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(messageDiv);
        
        setTimeout(() => {
            messageDiv.style.animation = 'slideUp 0.3s ease';
            setTimeout(() => {
                if (messageDiv.parentNode) {
                    messageDiv.parentNode.removeChild(messageDiv);
                }
            }, 300);
        }, 3000);
        
    } catch (error) {
        console.error('Failed to show message:', error);
        // Fallback to alert for critical errors
        if (type === 'error') {
            alert(`Error: ${message}`);
        }
    }
}

function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return 'Invalid Date';
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch (error) {
        return 'Invalid Date';
    }
}

// ================= INITIALIZATION =================
async function initializeManagementSystem() {
    console.log('🚀 Initializing Enhanced Management System...');
    
    try {
        // Initialize Supabase
        await initializeSupabase();
        
        // Load from localStorage as fallback
        const cachedData = loadFromStorage('user_data');
        if (cachedData) {
            console.log('📥 Loaded cached data from localStorage');
        }
        
        // Start cleanup timer for stale operations
        setInterval(() => {
            conflictResolver.cleanupOldOperations();
        }, 60000); // Cleanup every minute
        
        console.log('✅ Enhanced Management System initialized');
        showTemporaryMessage('Management System Ready', 'success');
        
    } catch (error) {
        console.error('❌ Failed to initialize management system:', error);
        showTemporaryMessage('Starting in offline mode. Some features limited.', 'warning');
        
        // Even if Supabase fails, we can work offline
        isConnected = false;
    }
}

function loadFromStorage(key) {
    try {
        const data = localStorage.getItem(`${CONFIG.storagePrefix}${key}`);
        return data ? JSON.parse(data) : null;
    } catch (error) {
        console.warn(`Failed to load ${key} from storage:`, error);
        return null;
    }
}

function saveToStorage(key, data) {
    try {
        localStorage.setItem(`${CONFIG.storagePrefix}${key}`, JSON.stringify(data));
        return true;
    } catch (error) {
        console.warn(`Failed to save ${key} to storage:`, error);
        return false;
    }
}

// ================= PUBLIC API =================
window.ManagementSystem = {
    // Core functions
    initialize: initializeManagementSystem,
    isConnected: () => isConnected,
    
    // Procedures
    createUser: (userData) => rootProcedures.execute('createUser', userData),
    updateUser: (userId, updates) => rootProcedures.execute('updateUser', userId, updates),
    createGroup: (groupData) => rootProcedures.execute('createGroup', groupData),
    
    // Utilities
    showMessage: showTemporaryMessage,
    formatDate: formatDate,
    isValidEmail: isValidEmail,
    
    // Storage
    loadFromStorage: loadFromStorage,
    saveToStorage: saveToStorage,
    
    // Error handling
    getErrorHistory: () => {
        try {
            return JSON.parse(localStorage.getItem(`${CONFIG.storagePrefix}error_history`) || '[]');
        } catch {
            return [];
        }
    },
    clearErrorHistory: () => {
        localStorage.removeItem(`${CONFIG.storagePrefix}error_history`);
    },
    
    // Debug info
    getStatus: () => ({
        connected: isConnected,
        retryCount,
        pendingOperations: Array.from(pendingOperations.keys()),
        config: CONFIG
    })
};

// ======================================================================
// === BEGIN PASTE AREA ===
// PASTE YOUR FULL MANAGEMENT SYSTEM CODE BELOW THIS LINE
// Replace the existing code in your index.html between:
// //***************************FULL MANAGEMENT SYSTEM CODE***************************//
// and
// //***************************END OF FULL MANAGEMENT SYSTEM CODE***************************//
// ======================================================================

// PASTE YOUR CODE HERE


















//***************************FULL MANAGEMENT SYSTEM CODE***************************//

// ========================================================================
// USER MANAGEMENT SYSTEM INTEGRATION - From USER_MANAGEMENT_INTEGRATION.js
// ========================================================================
// Global state for user management backend
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
    const userData_transform = transformUserForSupabase(user);
    
    const { data, error } = await supabaseClient
      .from('users')
      .upsert([{
        id: user.id || undefined,
        ...userData_transform
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
  localStorage.setItem('ring0_registration_fields', JSON.stringify(fields));

  try {
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
  localStorage.setItem('ring0_users', JSON.stringify(users_list));

  try {
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

function saveGroupsToStorage(groups_list) {
  localStorage.setItem('ring0_user_groups', JSON.stringify(groups_list));

  try {
    if (window && window.groups !== undefined) {
      window.groups = groups_list;
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

// Helper to check if Supabase is ready
function isSupabaseAvailable() {
  return supabaseClient && isSupabaseReady;
}

// ================= USER MANAGEMENT SYSTEM =================
let userData = [];
let dataFramework = [];
let groups = [];
let currentCaseUserId = null;

// Default data framework
const defaultFramework = [
  { name: 'Full Name', type: 'text', required: 'yes', order: 1 },
  { name: 'Registration Number', type: 'text', required: 'yes', order: 2 },
  { name: 'Phone Number', type: 'phone', required: 'yes', order: 3 }
];

// Default user data with unique registration numbers
const defaultUsers = [
  { id: 1, name: 'John Doe', regNo: 'REG001', phone: '+1234567890', email: 'john@example.com', group: 'A', status: 'active', caseInfo: '' },
  { id: 2, name: 'Jane Smith', regNo: 'REG002', phone: '+1234567891', email: 'jane@example.com', group: 'B', status: 'active', caseInfo: '' },
  { id: 3, name: 'Bob Johnson', regNo: 'REG003', phone: '+1234567892', email: 'bob@example.com', group: 'A', status: 'flagged', caseInfo: 'Late payment - Contacted on 2025-01-15' },
  { id: 4, name: 'Alice Brown', regNo: 'REG004', phone: '+1234567893', email: 'alice@example.com', group: 'C', status: 'inactive', caseInfo: '' }
];

// Default groups
const defaultGroups = [
  { id: 1, name: 'Group A', size: 10, members: [1, 3] },
  { id: 2, name: 'Group B', size: 10, members: [2] },
  { id: 3, name: 'Group C', size: 10, members: [4] }
];

// ================= SUPABASE REAL-TIME SYNC =================

// Subscribe to registration field changes
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
        if (typeof renderUserList === 'function') renderUserList();
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
        if (typeof renderGroupList === 'function') renderGroupList();
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
        if (typeof updateRegistrationMenuButton === 'function') updateRegistrationMenuButton();
      }
    )
    .subscribe((status) => {
      console.log(`Registration settings subscription ${status === 'SUBSCRIBED' ? '✅' : '❌'}`);
    });
  
  return channel;
}

// ========================================================================
// INITIALIZATION - Main User Management Setup
// ========================================================================

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

// Fetch user management data from Supabase (legacy wrapper for compatibility)
async function fetchUserManagementData() {
  console.log('🔄 Fetching user management data from Supabase...');
  
  try {
    if (!supabaseClient) {
      console.error('❌ Supabase client not initialized');
      return;
    }
    
    // 1. Fetch registration fields
    const { data: fieldsData, error: fieldsError } = await supabaseClient
      .from('registration_fields')
      .select('*')
      .order('field_order', { ascending: true });
    
    if (fieldsError) {
      console.error('❌ Error fetching registration fields:', fieldsError);
    } else if (fieldsData) {
      // Transform to match local structure
      const transformedFields = fieldsData.map(field => ({
        id: field.id,
        name: field.field_name,
        type: field.field_type,
        required: field.is_required ? 'yes' : 'no',
        order: field.field_order,
        options: field.options || []
      }));
      
      console.log(`✅ Loaded ${transformedFields.length} registration fields`);
      localStorage.setItem('ring0_data_framework', JSON.stringify(transformedFields));
      dataFramework = transformedFields;
    }
    
    // 2. Fetch users
    const { data: usersData, error: usersError } = await supabaseClient
      .from('users')
      .select(`
        *,
        user_groups!users_group_id_fkey(name)
      `)
      .order('created_at', { ascending: false });
    
    if (usersError) {
      console.error('❌ Error fetching users:', usersError);
    } else if (usersData) {
      // Transform to match local structure
      const transformedUsers = usersData.map(user => ({
        id: user.id,
        name: user.full_name,
        regNo: user.registration_number,
        rowNumber: user.row_number,
        phone: user.phone_number,
        email: user.email,
        group: user.user_groups ? user.user_groups.name : '',
        status: user.status,
        caseInfo: user.case_info,
        dynamic_fields: user.dynamic_fields,
        created_at: user.created_at
      }));
      
      console.log(`✅ Loaded ${transformedUsers.length} users`);
      localStorage.setItem('ring0_user_data', JSON.stringify(transformedUsers));
      window.userData = transformedUsers;
      // Keep local variable in sync so UI functions can use `userData` immediately
      userData = transformedUsers;
    }
    
    // 3. Fetch groups with members
    const { data: groupsData, error: groupsError } = await supabaseClient
      .from('user_groups')
      .select(`
        *,
        users!users_group_id_fkey(id)
      `)
      .order('created_at', { ascending: true });
    
    if (groupsError) {
      console.error('❌ Error fetching groups:', groupsError);
    } else if (groupsData) {
      // Transform to match local structure
      const transformedGroups = groupsData.map(group => ({
        id: group.id,
        name: group.name,
        size: group.size,
        leader: group.leader_id,
        is_flagged: group.is_flagged,
        members: group.users ? group.users.map(u => u.id) : [],
        created_at: group.created_at
      }));
      
      console.log(`✅ Loaded ${transformedGroups.length} groups`);
      localStorage.setItem('ring0_user_groups', JSON.stringify(transformedGroups));
      window.groups = transformedGroups;
      // Keep local variable in sync so populateGroups() and other routines see the data
      groups = transformedGroups;
    }
    
    // 4. Fetch registration settings
    const { data: settingsData, error: settingsError } = await supabaseClient
      .from('registration_settings')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (settingsError && settingsError.code !== 'PGRST116') {
      console.error('❌ Error fetching registration settings:', settingsError);
    } else if (settingsData) {
      console.log('✅ Loaded registration settings');
      localStorage.setItem('ring0_registration_settings', JSON.stringify(settingsData));
    }
    
    console.log('🎉 User management data loaded successfully!');
    
    // Update UI
    if (typeof renderDataFramework === 'function') renderDataFramework();
    if (typeof populateUserTable === 'function') populateUserTable();
    if (typeof populateGroups === 'function') populateGroups();
    if (typeof generateRegistrationFormPreview === 'function') generateRegistrationFormPreview();
    
  } catch (error) {
    console.error('❌ Error in fetchUserManagementData:', error);
    // Load from local storage as fallback
    loadDataFramework();
    loadUserData();
    loadGroups();
  }
}

// Save registration field to Supabase
async function saveFieldToSupabase(field) {
  try {
    // Use upsert by field_name to avoid duplicates and to allow edits
    const payload = {
      field_name: field.name,
      field_type: field.type,
      is_required: (field.required === 'yes' || field.required === true),
      field_order: field.order || (dataFramework.length || 0) + 1,
      options: field.options || [],
      updated_at: new Date().toISOString()
    };

    // Prefer supabaseClient if available
    const client = (typeof supabaseClient !== 'undefined' && supabaseClient) ? supabaseClient : (typeof supabase !== 'undefined' && supabase) ? supabase : null;
    if (!client) {
      console.error('No Supabase client available to save field');
      return false;
    }

    const { data, error } = await client
      .from('registration_fields')
      .upsert([payload], { onConflict: 'field_name' })
      .select();

    if (error) {
      console.error('Error saving field to Supabase:', error);
      return false;
    }

    console.log('Field upserted to Supabase:', data);
    // Persist returned data to local framework
    try {
      const returned = Array.isArray(data) && data.length ? data[0] : null;
      if (returned) {
        // merge into dataFramework
        const idx = dataFramework.findIndex(f => f.name === returned.field_name);
        const transformed = {
          name: returned.field_name,
          type: returned.field_type,
          required: returned.is_required ? 'yes' : 'no',
          order: returned.field_order,
          options: returned.options || [],
          created_at: returned.created_at || new Date().toISOString()
        };
        if (idx === -1) dataFramework.push(transformed);
        else dataFramework[idx] = transformed;
        saveDataFramework();
      }
    } catch (e) {
      console.warn('Could not sync saved field into local framework:', e);
    }

    return data || true;
  } catch (error) {
    console.error('Error in saveFieldToSupabase:', error);
    return false;
  }
}

// Save user to Supabase
async function saveUserToSupabase(user) {
  try {
    if (!supabaseClient) {
      console.error('Supabase client not initialized');
      return false;
    }
    
    // Resolve group_id from possible inputs (group, groupId, group_id)
    let resolvedGroupId = null;
    if (user.group_id) resolvedGroupId = user.group_id;
    else if (user.groupId) resolvedGroupId = user.groupId;
    else if (user.group) {
      try {
        const found = (window.groups || groups || []).find(g => String(g.name) === String(user.group) || String(g.id) === String(user.group));
        if (found) resolvedGroupId = found.id;
      } catch (e) {}
    }

    const insertObj = {
      full_name: user.name,
      registration_number: user.regNo,
      phone_number: user.phone,
      email: user.email,
      status: user.status || 'active',
      group_id: resolvedGroupId,
      dynamic_fields: user.dynamic_fields || {}
    };

    const { data, error } = await supabaseClient
      .from('users')
      .insert([insertObj])
      .select();
    
    if (error) {
      console.error('Error saving user to Supabase:', error);
      return false;
    }
    
    console.log('User saved to Supabase:', data);
    // Immediately reflect new user in local cache/UI to avoid waiting for realtime
    try {
      const saved = Array.isArray(data) && data.length > 0 ? data[0] : null;
      if (saved) {
        const stored = JSON.parse(localStorage.getItem('ring0_user_data') || '[]');
        const idx = stored.findIndex(u => String(u.registration_number || u.regNo || u.id) === String(saved.registration_number || saved.regNo || saved.id));
        const transformed = {
          id: saved.id || saved.id,
          full_name: saved.full_name || saved.name || '',
          registration_number: saved.registration_number || saved.regNo || '',
          phone_number: saved.phone_number || saved.phone || '',
          email: saved.email || '',
          status: saved.status || 'active',
          dynamic_fields: saved.dynamic_fields || {}
        };
        if (idx >= 0) {
          stored[idx] = { ...stored[idx], ...transformed };
        } else {
          stored.unshift(transformed);
        }
        localStorage.setItem('ring0_user_data', JSON.stringify(stored));
        if (typeof renderUserList === 'function') renderUserList();
        if (typeof populateUserTable === 'function') populateUserTable();
      }
    } catch (e) {
      console.warn('Could not update local user cache after save:', e);
    }

    return true;
  } catch (error) {
    console.error('Error in saveUserToSupabase:', error);
    return false;
  }
}

// Save group to Supabase
async function saveGroupToSupabase(group) {
  console.log('💾 [SAVE GROUP] START - Group:', group.name, 'Members:', group.members?.length || 0);
  try {
    if (!supabaseClient) {
      console.error('❌ [SAVE GROUP] Supabase client not initialized');
      return false;
    }
    
    // Prepare group object with all required fields matching schema
    const groupData = {
      name: group.name,
      size: group.size || 10,
      leader_id: group.leader_id || group.leader || null,
      members: Array.isArray(group.members) ? group.members : [],
      flagged: group.flagged || false
    };
    
    console.log('💾 [SAVE GROUP] Prepared data:', groupData);
    
    const { data, error } = await supabaseClient
      .from('user_groups')
      .upsert([groupData], { onConflict: 'name' })
      .select();
    
    if (error) {
      console.error('❌ [SAVE GROUP] Error saving group to Supabase:', error);
      console.error('   Details:', error.details, 'Message:', error.message, 'Code:', error.code);
      return false;
    }
    
    console.log('💾 [SAVE GROUP] Response received:', data);
    
    if (data && data.length > 0) {
      const supabaseGroup = data[0];
      console.log('💾 [SAVE GROUP] Supabase returned:', supabaseGroup);
      
      // Update the local group object with the Supabase ID
      if (supabaseGroup.id) {
        group.id = supabaseGroup.id;
        console.log('✅ [SAVE GROUP] Group UUID assigned:', group.id);
      } else {
        console.warn('⚠️ [SAVE GROUP] No UUID returned from Supabase');
      }
      console.log('✅ [SAVE GROUP] COMPLETE - UUID:', group.id);
      return true;
    }
    
    console.warn('⚠️ [SAVE GROUP] Empty response from Supabase');
    console.log('✅ [SAVE GROUP] COMPLETE (empty response)');
    return true;
  } catch (error) {
    console.error('❌ [SAVE GROUP] Exception:', error);
    return false;
  }
}

// Update registration settings in Supabase
async function updateRegistrationSettingsInSupabase(settings) {
  try {
    if (!supabaseClient) {
      console.error('Supabase client not initialized');
      return false;
    }
    
    // First check if settings exist
    const { data: existing, error: existingErr } = await supabaseClient
      .from('registration_settings')
      .select('id')
      .limit(1)
      .single();

    if (existingErr && existingErr.code && existingErr.code !== 'PGRST116') {
      console.error('Error checking existing registration settings:', existingErr);
      return false;
    }

    let result;
    if (existing && existing.id) {
      // Update existing
      result = await supabaseClient
        .from('registration_settings')
        .update({
          enabled: settings.registration_enabled,
          mode: settings.registration_mode,
          registration_link: settings.registration_link,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select();
    } else {
      // Insert new
      result = await supabaseClient
        .from('registration_settings')
        .insert([{
          enabled: settings.registration_enabled,
          mode: settings.registration_mode,
          registration_link: settings.registration_link,
          updated_at: new Date().toISOString()
        }])
        .select();
    }

    if (result.error) {
      console.error('Error updating registration settings:', result.error);
      return false;
    }

    // Persist the returned settings to localStorage for immediate UI use
    try {
      const returned = Array.isArray(result.data) && result.data.length ? result.data[0] : (result.data || null);
      if (returned) {
        localStorage.setItem('ring0_registration_settings', JSON.stringify(returned));
      }
    } catch (e) {
      console.warn('Could not persist registration settings locally:', e);
    }

    console.log('Registration settings updated:', result.data);
    return result.data || true;
  } catch (error) {
    console.error('Error in updateRegistrationSettingsInSupabase:', error);
    return false;
  }
}

// Initialize user management system with real-time subscriptions
function initUserManagementSystem() {
  console.log('🚀 Initializing user management system...');
  
  // Use the new Supabase integration
  if (typeof initializeUserManagementWithSupabase === 'function') {
    initializeUserManagementWithSupabase();
  } else {
    console.warn('⚠️ Supabase integration not loaded, using localStorage fallback');
    
    // Fallback: load from localStorage
    if (typeof loadDataFramework === 'function') loadDataFramework();
    if (typeof loadUserData === 'function') loadUserData();
    if (typeof loadGroups === 'function') loadGroups();
  }
}

// ================= MISSING UI FUNCTIONS =================
function renderDataFramework() {
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

function renderUserList() {
  if (typeof populateUserTable === 'function') {
    populateUserTable();
  }
}

function renderGroupList() {
  if (typeof populateGroups === 'function') {
    populateGroups();
  }
}

// ================= CORE FUNCTIONS =================

// Open User Management
function openUserManagement() {
  document.getElementById('dashboardMenu').style.display = 'none';
  document.getElementById('userManagementSection').style.display = 'block';
  
  // Fetch fresh data from Supabase before initializing UI
  if (typeof fetchUserManagementData === 'function') {
    console.log('📡 Fetching latest user management data from Supabase...');
    fetchUserManagementData().then(() => {
      initializeUserManagement();
    });
  } else if (typeof initializeUserManagementWithSupabase === 'function') {
    console.log('🚀 Initializing with Supabase integration...');
    initializeUserManagementWithSupabase().then(() => {
      initializeUserManagement();
    });
  } else {
    console.warn('⚠️ Supabase functions not available, using localStorage only');
    initializeUserManagement();
  }
}

// Switch between user management tabs
function switchUserTab(tabId) {
  // Get all user management content sections
  const userContents = document.querySelectorAll('.user-management-content');
  userContents.forEach(content => {
    content.classList.remove('active');
  });

  // Get all user management tab buttons
  const userTabs = document.querySelectorAll('.user-management-tab');
  userTabs.forEach(tab => {
    tab.classList.remove('active');
  });

  // Show the selected tab content
  const selectedTab = document.getElementById(tabId + 'Tab');
  if (selectedTab) {
    selectedTab.classList.add('active');
  }

  // Activate the clicked tab button
  const clickedTab = event.target;
  clickedTab.classList.add('active');

  // Initialize registration settings UI when settings tab is opened
  if (tabId === 'settings') {
    const settingsTab = document.getElementById('settingsTab');
    const hasRegistrationUI = settingsTab.querySelector('.registration-mode-container');
    if (!hasRegistrationUI) {
      updateRegistrationSettingsUI();
    }
  }
}

// Initialize User Management
function initializeUserManagement() {
  // Load data (will use Supabase if available, localStorage as fallback)
  loadDataFramework();
  loadUserData();
  loadGroups();
  updateRegistrationSwitch();
  
  // Update framework preview
  renderDataFramework();
  generateRegistrationFormPreview();
  
  // Load users into table
  populateUserTable();
  
  // Load groups display
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
}

// ================= DATA FRAMEWORK MANAGEMENT =================
function loadDataFramework() {
  const savedFramework = localStorage.getItem('ring0_data_framework');
  if (savedFramework) {
    dataFramework = JSON.parse(savedFramework);
  } else {
    dataFramework = [...defaultFramework];
    saveDataFramework();
  }
}

function saveDataFramework() {
  localStorage.setItem('ring0_data_framework', JSON.stringify(dataFramework));
  renderDataFramework();
  generateRegistrationFormPreview();
}

function addField() {
  const name = document.getElementById('fieldName').value.trim();
  const type = document.getElementById('fieldType').value;
  const required = document.getElementById('fieldRequired').value;
  
  if (!name) {
    showTemporaryMessage('Please enter a field name', 'warning');
    return;
  }
  
  const newField = {
    name: name,
    type: type,
    required: required,
    order: dataFramework.length + 1,
    created_at: new Date().toISOString()
  };
  
  dataFramework.push(newField);
  saveDataFramework();
  
  // Save to Supabase for real-time sync
  saveFieldToSupabase(newField).then(success => {
    if (success) {
      showTemporaryMessage(`Field "${name}" saved to all devices!`, 'success');
    } else {
      showTemporaryMessage(`Field "${name}" saved locally only`, 'warning');
    }
  });
  
  // Clear inputs
  document.getElementById('fieldName').value = '';
  document.getElementById('fieldType').value = 'text';
  document.getElementById('fieldRequired').value = 'yes';
}

function updateFrameworkPreview() {
  // This is now handled by renderDataFramework()
  renderDataFramework();
}

function editField(index) {
  const field = dataFramework[index];
  document.getElementById('fieldName').value = field.name;
  document.getElementById('fieldType').value = field.type;
  document.getElementById('fieldRequired').value = field.required;
  
  // Remove the field
  dataFramework.splice(index, 1);
  saveDataFramework();
}

function removeField(index) {
  if (confirm('Are you sure you want to remove this field?')) {
    const removed = dataFramework.splice(index, 1);
    saveDataFramework();
    showTemporaryMessage('Field removed', 'warning');
    // Attempt to delete from Supabase
    try {
      const name = removed && removed[0] && removed[0].name;
      if (name) {
        if (typeof deleteFieldFromSupabase === 'function') {
          deleteFieldFromSupabase(name).then(success => {
            if (success) {
              showTemporaryMessage(`Field "${name}" removed from Supabase`, 'success');
            } else {
              showTemporaryMessage(`Field "${name}" removed locally but not from Supabase`, 'warning');
            }
          });
        }
      }
    } catch (e) {
      console.warn('Error deleting field from Supabase:', e);
    }
  }
}

function resetFramework() {
  if (confirm('Are you sure you want to reset the framework? All existing user data will be affected.')) {
    dataFramework = [...defaultFramework];
    saveDataFramework();

    // Try to push defaults to Supabase so all clients receive the reset
    if (typeof upsertRegistrationFields === 'function') {
      upsertRegistrationFields(dataFramework).then(success => {
        if (success) {
          showTemporaryMessage('Framework reset to default and synced to Supabase', 'success');
        } else {
          showTemporaryMessage('Framework reset locally but failed to sync to Supabase', 'warning');
        }
      }).catch(e => {
        console.warn('Failed to upsert registration fields:', e);
        showTemporaryMessage('Framework reset locally but sync errored', 'warning');
      });
    } else {
      showTemporaryMessage('Framework reset to default (no supabase helper available)', 'info');
    }
  }
}

// Bulk upsert registration fields to Supabase so reset propagates to all clients
async function upsertRegistrationFields(fields) {
  try {
    if (!supabaseClient) {
      console.error('Supabase client not initialized');
      return false;
    }

    const payload = fields.map((f, idx) => ({
      field_name: f.name,
      field_type: f.type,
      is_required: (f.required === 'yes' || f.required === true),
      field_order: f.order || (idx + 1),
      options: f.options || []
    }));

    // Upsert by field_name to avoid creating duplicates
    const { data, error } = await supabaseClient
      .from('registration_fields')
      .upsert(payload, { onConflict: 'field_name' })
      .select();

    if (error) {
      console.error('Error upserting registration fields:', error);
      return false;
    }

    // Map returned DB rows back into frontend framework shape and persist
    if (Array.isArray(data) && data.length) {
      dataFramework = data.map(d => ({
        name: d.field_name,
        type: d.field_type,
        required: d.is_required ? 'yes' : 'no',
        order: d.field_order,
        options: d.options || []
      }));
      saveDataFramework();
      if (typeof renderDataFramework === 'function') renderDataFramework();
    }

    return true;
  } catch (error) {
    console.error('Exception in upsertRegistrationFields:', error);
    return false;
  }
}

function generateRegistrationFormPreview() {
  const preview = document.getElementById('registrationFormPreview');
  if (!preview) return;
  
  let html = '';
  
  dataFramework.forEach(field => {
    html += `
      <div class="form-group" style="margin-bottom: 15px;">
        <label class="form-label" style="display: block; margin-bottom: 5px; color: var(--text);">${field.name} ${field.required === 'yes' ? '<span style="color: var(--warning);">*</span>' : ''}</label>
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

// ================= USER MANAGEMENT =================
function loadUserData() {
  const savedUsers = localStorage.getItem('ring0_user_data');
  if (savedUsers) {
    userData = JSON.parse(savedUsers);
  } else {
    userData = [...defaultUsers];
    saveUserData();
  }
  // Always sync window.userData with local userData
  window.userData = userData;
}

function saveUserData() {
  // Keep userData and window.userData in sync
  if (window.userData && Array.isArray(window.userData)) {
    userData = window.userData;
  } else if (!window.userData) {
    window.userData = userData;
  }
  localStorage.setItem('ring0_user_data', JSON.stringify(userData));
}

function populateUserTable() {
  const tbody = document.getElementById('userTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  // CRITICAL: Filter out deleted users using the global tracker
  const visibleUsers = window.deletedUsersTracker ? 
    userData.filter(u => !window.deletedUsersTracker.isDeleted(u.id)) : 
    userData;
  
  if (visibleUsers.length === 0) {
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
  
  visibleUsers.forEach(user => {
    const row = document.createElement('tr');
    row.setAttribute('data-user-id', user.id); // Add data attribute for realtime deletion
    if (user.status === 'flagged') {
      row.classList.add('red-flag');
    }
    
    row.innerHTML = `
      <td>${user.name}</td>
      <td>${user.regNo}</td>
      <td>${user.phone}</td>
      <td>${user.email || 'N/A'}</td>
      <td>${user.group ? user.group.replace('Group ', '').trim() : 'Not assigned'}</td>
      <td>
        <span class="user-status-badge user-status-${user.status}">
          ${user.status.charAt(0).toUpperCase() + user.status.slice(1)}
        </span>
        ${user.caseInfo ? '<button class="user-action-flag-btn" onclick="showCaseInfo(' + user.id + ')">View Case</button>' : ''}
      </td>
      <td>
        <div class="user-action-buttons">
          <button class="user-action-btn user-action-edit-btn" onclick="openEditUserModal(${user.id})">Edit</button>
          <button class="user-action-btn user-action-delete-btn" onclick="deleteUser(${user.id})">Delete</button>
          ${user.status !== 'flagged' ? '<button class="user-action-flag-btn" onclick="openCaseModal(' + user.id + ')">Flag</button>' : '<button class="user-action-flag-btn" onclick="unflagUser(' + user.id + ')">Unflag</button>'}
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function searchUsers() {
  const searchTerm = document.getElementById('userSearch').value.toLowerCase();
  const visibleUsers = window.deletedUsersTracker ? 
    userData.filter(u => !window.deletedUsersTracker.isDeleted(u.id)) : 
    userData;
  const filteredUsers = visibleUsers.filter(user => 
    user.name.toLowerCase().includes(searchTerm) ||
    user.regNo.toLowerCase().includes(searchTerm) ||
    (user.email && user.email.toLowerCase().includes(searchTerm)) ||
    (user.phone && user.phone.includes(searchTerm))
  );
  
  updateTableWithFilteredUsers(filteredUsers);
}

function filterUsers() {
  const status = document.getElementById('statusFilter').value;
  
  if (status === 'all') {
    populateUserTable();
    return;
  }
  
  const filteredUsers = userData.filter(user => user.status === status);
  updateTableWithFilteredUsers(filteredUsers);
}

function updateTableWithFilteredUsers(filteredUsers) {
  const tbody = document.getElementById('userTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (filteredUsers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 40px; color: var(--muted);">
          No users found matching your criteria.
        </td>
      </tr>
    `;
    return;
  }
  
  filteredUsers.forEach(user => {
    const row = document.createElement('tr');
    if (user.status === 'flagged') {
      row.classList.add('red-flag');
    }
    
    row.innerHTML = `
      <td>${user.name}</td>
      <td>${user.regNo}</td>
      <td>${user.phone}</td>
      <td>${user.email || 'N/A'}</td>
      <td>${user.group ? user.group.replace('Group ', '').trim() : 'Not assigned'}</td>
      <td>
        <span class="user-status-badge user-status-${user.status}">
          ${user.status.charAt(0).toUpperCase() + user.status.slice(1)}
        </span>
        ${user.caseInfo ? '<button class="user-action-flag-btn" onclick="showCaseInfo(' + user.id + ')">View Case</button>' : ''}
      </td>
      <td>
        <div class="user-action-buttons">
          <button class="user-action-btn user-action-edit-btn" onclick="openEditUserModal(${user.id})">Edit</button>
          <button class="user-action-btn user-action-delete-btn" onclick="deleteUser(${user.id})">Delete</button>
          ${user.status !== 'flagged' ? '<button class="user-action-flag-btn" onclick="openCaseModal(' + user.id + ')">Flag</button>' : '<button class="user-action-flag-btn" onclick="unflagUser(' + user.id + ')">Unflag</button>'}
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function openAddUserModal() {
  const fieldsContainer = document.getElementById('addUserFields');
  if (!fieldsContainer) return;
  
  fieldsContainer.innerHTML = '';
  
  dataFramework.forEach(field => {
    const fieldName = field.name.toLowerCase().replace(/\s+/g, '_');
    fieldsContainer.innerHTML += `
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

function handleAddUser(e) {
  e.preventDefault();
  
  const newUser = {
    id: Date.now().toString(),
    status: 'active',
    group: '',
    created_at: new Date().toISOString()
  };
  
  // Collect data from form fields
  const inputs = document.querySelectorAll('.new-user-field');
  inputs.forEach(input => {
    const fieldName = input.getAttribute('data-field');
    const fieldValue = input.value.trim();
    
    // Map to user properties
    if (fieldName.includes('name')) newUser.name = fieldValue;
    else if (fieldName.includes('reg')) newUser.regNo = fieldValue;
    else if (fieldName.includes('phone')) newUser.phone = fieldValue;
    else if (fieldName.includes('email')) newUser.email = fieldValue;
    else newUser[fieldName] = fieldValue;
  });
  
  // Check for duplicates
  const duplicate = userData.find(user => 
    user.regNo === newUser.regNo || 
    (newUser.email && user.email === newUser.email)
  );
  
  if (duplicate) {
    showTemporaryMessage('User with this registration number or email already exists!', 'warning');
    return;
  }
  
  // Add to local array immediately
  userData.push(newUser);
  saveUserData();
  populateUserTable();
  closeAddUserModal();
  
  showTemporaryMessage('User added successfully!', 'success');
  
  // Sync to Supabase in background (non-blocking)
  if (supabaseClient) {
    syncNewUserToSupabaseBackground(newUser);
  }
}

// Background sync for new user
async function syncNewUserToSupabaseBackground(newUser) {
  try {
    // Convert id to number for BIGINT primary key
    const userId = typeof newUser.id === 'string' ? parseInt(newUser.id, 10) : newUser.id;
    const regNo = newUser.regNo || 'GEN-' + Date.now();
    
    // Email should be null if empty to avoid unique constraint violations
    const email = newUser.email && newUser.email.trim() ? newUser.email.trim() : null;
    
    const { error } = await supabaseClient
      .from('users')
      .upsert([{
        id: userId,
        registration_number: regNo,
        full_name: newUser.name || '',
        phone_number: newUser.phone || '',
        email: email,
        status: 'active',
        created_at: new Date().toISOString()
      }], {
        onConflict: 'registration_number'  // Use registration_number as conflict key, not id
      });
    
    if (error) {
      console.error('❌ Background user sync failed:', error);
    } else {
      console.log('✅ New user synced to Supabase in background:', newUser.name);
    }
  } catch (error) {
    console.error('Error in background user sync:', error);
  }
}

function openEditUserModal(userId) {
  const user = userData.find(u => u.id === userId);
  if (!user) return;
  
  const fieldsContainer = document.getElementById('editUserFields');
  if (!fieldsContainer) return;
  
  fieldsContainer.innerHTML = '';
  
  // Add hidden input for user ID
  fieldsContainer.innerHTML += `<input type="hidden" id="editUserId" value="${user.id}">`;
  
  dataFramework.forEach(field => {
    const fieldName = field.name.toLowerCase().replace(/\s+/g, '_');
    const fieldValue = user[fieldName] || user[field.name.toLowerCase().replace(/\s+/g, '')] || '';
    
    let fieldHTML = '';
    switch(field.type) {
      case 'text':
      case 'email':
      case 'phone':
      case 'number':
        fieldHTML = `<input type="${field.type}" class="form-input edit-user-field" data-field="${fieldName}" value="${fieldValue}" placeholder="Enter ${field.name.toLowerCase()}" ${field.required === 'yes' ? 'required' : ''} style="width: 100%;">`;
        break;
      case 'date':
        fieldHTML = `<input type="date" class="form-input edit-user-field" data-field="${fieldName}" value="${fieldValue}" ${field.required === 'yes' ? 'required' : ''} style="width: 100%;">`;
        break;
      case 'select':
        fieldHTML = `
          <select class="form-select edit-user-field" data-field="${fieldName}" ${field.required === 'yes' ? 'required' : ''} style="width: 100%;">
            <option value="">Select ${field.name}</option>
            <option value="option1" ${fieldValue === 'option1' ? 'selected' : ''}>Option 1</option>
            <option value="option2" ${fieldValue === 'option2' ? 'selected' : ''}>Option 2</option>
            <option value="option3" ${fieldValue === 'option3' ? 'selected' : ''}>Option 3</option>
          </select>
        `;
        break;
      default:
        fieldHTML = `<input type="text" class="form-input edit-user-field" data-field="${fieldName}" value="${fieldValue}" placeholder="Enter ${field.name.toLowerCase()}" ${field.required === 'yes' ? 'required' : ''} style="width: 100%;">`;
    }
    
    fieldsContainer.innerHTML += `
      <div class="form-group">
        <label class="form-label">${field.name}</label>
        ${fieldHTML}
      </div>
    `;
  });
  
  document.getElementById('editUserModal').classList.add('active');
}

function closeEditUserModal() {
  document.getElementById('editUserModal').classList.remove('active');
}

function handleEditUser(e) {
  e.preventDefault();
  
  const userId = parseInt(document.getElementById('editUserId').value);
  const userIndex = userData.findIndex(u => u.id === userId);
  
  if (userIndex === -1) return;
  
  // Update user data from form fields
  const inputs = document.querySelectorAll('.edit-user-field');
  inputs.forEach(input => {
    const fieldName = input.getAttribute('data-field');
    const fieldValue = input.value.trim();
    
    userData[userIndex][fieldName] = fieldValue;
  });
  
  saveUserData();
  populateUserTable();
  closeEditUserModal();
  
  showTemporaryMessage('User updated successfully!', 'success');
  
  // Sync to Supabase immediately
  if (supabaseClient) {
    syncUserToSupabaseBackground(userId, userData[userIndex]);
  }
}

// Background sync function (doesn't block UI)
async function syncUserToSupabaseBackground(userId, user) {
  try {
    // Normalize numeric id and sanitize fields
    const numericUserId = Number(userId);
    // Email should be null if empty to avoid unique constraint violations
    const email = user.email && String(user.email).trim() ? String(user.email).trim() : null;
    const regNo = user.regNo || user.registrationNumber || user.registration_number || '';

    const updateData = {
      id: numericUserId,
      full_name: user.full_name || user.name || '',
      registration_number: regNo,
      phone_number: user.phone || '',
      email: email,  // null if empty
      status: user.status || 'active',
      group_id: user.group_id || user.groupId || null,
      dynamic_fields: user.dynamic_fields || null,
      case_info: user.caseInfo || user.case_info || null,
      flagged_at: user.status === 'flagged' ? (user.flagged_at || new Date().toISOString()) : null,
      updated_at: new Date().toISOString()
    };
    
    // Upsert by numeric ID (schema now uses BIGINT primary key)
    const { error } = await supabaseClient
      .from('users')
      .upsert(updateData, { onConflict: 'id' });
    
    if (error) {
      console.error('❌ Background sync failed:', error);
    } else {
      console.log('✅ User synced to Supabase in background:', userId);
    }
  } catch (error) {
    console.error('Error in background sync:', error);
  }
}

// Delete user from Supabase
async function deleteUserFromSupabase(userId) {
  try {
    if (!supabaseClient) {
      console.error('Supabase client not initialized');
      return false;
    }

    const { error } = await supabaseClient
      .from('users')
      .delete()
      .eq('id', userId);

    if (error) {
      console.error('Error deleting user from Supabase:', error);
      return false;
    }

    console.log('✅ User permanently deleted from Supabase:', userId);
    return true;
  } catch (error) {
    console.error('Error in deleteUserFromSupabase:', error);
    return false;
  }
}

// Delete user from all places (groups, settings, etc.)
function removeUserFromGroups(userId) {
  // Remove user from all groups
  groups.forEach(group => {
    const memberIndex = group.members.indexOf(userId);
    if (memberIndex !== -1) {
      group.members.splice(memberIndex, 1);
      console.log(`✅ Removed user ${userId} from group ${group.name}`);
    }
  });
  saveGroups();
}

// Update user status in Supabase (for flagging/unflagging)
async function updateUserStatusInSupabase(userId, status, caseInfo = null) {
  try {
    if (!supabaseClient) {
      console.error('Supabase client not initialized');
      return false;
    }

    const updateData = { status };
    if (caseInfo) {
      updateData.case_info = caseInfo;
      updateData.flagged_at = new Date().toISOString();
    } else if (status === 'active') {
      updateData.case_info = null;
      updateData.flagged_at = null;
    }

    const { error } = await supabaseClient
      .from('users')
      .update(updateData)
      .eq('id', userId);

    if (error) {
      console.error('Error updating user status in Supabase:', error);
      return false;
    }

    console.log('✅ User status updated in Supabase:', userId, status);
    return true;
  } catch (error) {
    console.error('Error in updateUserStatusInSupabase:', error);
    return false;
  }
}

// Delete user - optimized with immediate UI removal
async function deleteUser(userId) {
  if (confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
    // Use optimized delete if available, otherwise fallback
    if (typeof window.deleteUserOptimized === 'function') {
      window.deleteUserOptimized(userId);
      removeUserFromGroups(userId);
      populateGroups();
      showTemporaryMessage('User deleted successfully!', 'warning');
    } else {
      // Fallback to old method
      userData = userData.filter(user => user.id !== userId);
      removeUserFromGroups(userId);
      saveUserData();
      populateUserTable();
      populateGroups();
      showTemporaryMessage('User deleted successfully!', 'warning');
      if (supabaseClient) {
        deleteUserFromSupabaseBackground(userId);
      }
    }
  }
  }


// Background deletion from Supabase (tries registration_number then email)
async function deleteUserFromSupabaseBackground(userId) {
  try {
    if (!userId) {
      console.error('❌ Cannot delete from Supabase: no user ID provided');
      return;
    }

    const numericId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
    console.log('🗑️ [DELETE BACKGROUND] Attempting to delete user ID:', numericId);

    // Delete by numeric ID (schema now uses BIGINT primary key)
    const { data, error } = await supabaseClient
      .from('users')
      .delete()
      .eq('id', numericId);

    if (error) {
      console.error('❌ [DELETE FAILED] Background deletion error:', error);
      console.error('   Code:', error.code);
      console.error('   Message:', error.message);
      console.error('   Details:', error.details);
      console.error('   Hint:', error.hint);
      alert('❌ DELETE FAILED from Supabase!\n\nError: ' + error.message + '\n\nCheck console for details');
    } else {
      console.log('✅ [DELETE SUCCESS] User deleted from Supabase');
      console.log('   ID:', numericId);
      console.log('   Response Data:', data);
      showTemporaryMessage('✅ User successfully deleted from Supabase!', 'success');
    }
  } catch (error) {
    console.error('❌ [DELETE ERROR] Exception in background deletion:', error);
    console.error('   Stack:', error.stack);
    alert('❌ ERROR: ' + error.message);
  }
}


function exportUsers() {
  // Convert to CSV
  const headers = dataFramework.map(f => f.name).join(',');
  const rows = userData.map(user => 
    dataFramework.map(f => {
      const fieldName = f.name.toLowerCase().replace(/\s+/g, '_');
      return `"${user[fieldName] || ''}"`;
    }).join(',')
  ).join('\n');
  
  const csv = headers + '\n' + rows;
  
  // Download CSV
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'users_export.csv';
  a.click();
  
  showTemporaryMessage('Users exported successfully!', 'success');
}

// ================= CASE MANAGEMENT =================
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
  const numericUserId = Number(currentCaseUserId);
  const userIndex = userData.findIndex(u => Number(u.id) === numericUserId);
  if (userIndex === -1) return;

  userData[userIndex].caseInfo = caseDetails;
  userData[userIndex].status = 'flagged';
  userData[userIndex].flagged_at = new Date().toISOString();
  saveUserData();
  populateUserTable();
  closeCaseModal();
  
  showTemporaryMessage('Case information saved! User has been flagged.', 'warning');
  
  // Sync to Supabase immediately
  if (supabaseClient) {
    syncCaseInfoToSupabaseBackground(numericUserId, caseDetails);
  }
}

// Background sync for case info
async function syncCaseInfoToSupabaseBackground(userId, caseInfo) {
  try {
    const numericUserId = Number(userId);
    const user = userData.find(u => Number(u.id) === numericUserId);
    if (!user) {
      console.error('❌ Cannot sync case info: user not found', userId);
      return;
    }

    const { error } = await supabaseClient
      .from('users')
      .upsert({
        id: numericUserId,
        full_name: user.full_name || user.name || '',
        registration_number: user.regNo || user.registrationNumber || user.registration_number || '',
        phone_number: user.phone || '',
        email: user.email || '',
        status: 'flagged',
        case_info: caseInfo,
        flagged_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });
    
    if (error) {
      console.error('❌ Background case info sync failed:', error);
    } else {
      console.log('✅ Case info synced to Supabase in background:', userId);
    }
  } catch (error) {
    console.error('Error in background case sync:', error);
  }
}

function unflagUser(userId) {
  if (confirm('Are you sure you want to unflag this user? This will remove their flagged status and case information.')) {
    const numericUserId = Number(userId);
    const userIndex = userData.findIndex(u => Number(u.id) === numericUserId);
    if (userIndex === -1) return;

    userData[userIndex].status = 'active';
    userData[userIndex].caseInfo = '';
    userData[userIndex].flagged_at = null;
    saveUserData();
    populateUserTable();
    
    const user = userData[userIndex];
    showTemporaryMessage(`${user.name} has been unflagged and is now active.`, 'success');
    
    // Sync to Supabase in background (non-blocking)
    if (supabaseClient) {
      syncUnflagToSupabaseBackground(numericUserId);
    }
  }
}

// Background sync for unflag
async function syncUnflagToSupabaseBackground(userId) {
  try {
    const numericUserId = Number(userId);
    const { error } = await supabaseClient
      .from('users')
      .update({
        status: 'active',
        case_info: null,
        flagged_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', numericUserId);
    
    if (error) {
      console.error('❌ Background unflag sync failed:', error);
    } else {
      console.log('✅ Unflag synced to Supabase in background:', userId);
    }
  } catch (error) {
    console.error('Error in background unflag sync:', error);
  }
}

function showCaseInfo(userId) {
  const user = userData.find(u => u.id === userId);
  if (user && user.caseInfo) {
    alert(`Case Information for ${user.name}:\n\n${user.caseInfo}`);
  }
}

// ================= GROUP MANAGEMENT =================
function loadGroups() {
  const savedGroups = localStorage.getItem('ring0_user_groups');
  if (savedGroups) {
    groups = JSON.parse(savedGroups);
  } else {
    groups = [...defaultGroups];
    saveGroups();
  }
  // Always sync window.groups with local groups
  window.groups = groups;
}

function saveGroups() {
  // Keep groups and window.groups in sync
  if (window.groups && Array.isArray(window.groups)) {
    groups = window.groups;
  } else if (!window.groups) {
    window.groups = groups;
  }
  localStorage.setItem('ring0_user_groups', JSON.stringify(groups));
}

function populateGroups() {
  console.log('🎨 [POPULATE GROUPS] START - window.groups:', window.groups?.length || 0, 'groups array:', groups?.length || 0);
  const container = document.getElementById('groupList');
  if (!container) {
    console.warn('⚠️ [POPULATE GROUPS] Container not found');
    return;
  }
  
  container.innerHTML = '';
  
  if (groups.length === 0) {
    console.log('ℹ️ [POPULATE GROUPS] No groups to display');
    container.innerHTML = `
      <div class="user-empty-state">
        <div class="user-empty-icon">👥</div>
        <h3>No Groups Created</h3>
        <p>Create groups using the controls above.</p>
      </div>
    `;
    return;
  }
  
  console.log('🎨 [POPULATE GROUPS] Rendering', groups.length, 'groups');
  groups.forEach((group, idx) => {
    console.log('🎨 [POPULATE GROUPS] Processing group', idx + 1, ':', group.name, 'ID:', group.id, 'Members:', group.members?.length || 0);
    const groupCard = document.createElement('div');
    groupCard.className = 'group-card';
    
    // CRITICAL: Filter deleted users using tracker + filter userData check
    let validMemberIds = group.members.filter(memberId => {
      // First check deleted tracker
      if (window.deletedUsersTracker && window.deletedUsersTracker.isDeleted(memberId)) {
        console.log(`🚫 [DELETED TRACKER] Skipping deleted user ${memberId} from group "${group.name}"`);
        return false;
      }
      // Then check if user still exists in userData
      return userData.some(u => u.id === memberId);
    });
    
    // Clean up group members array to remove deleted users
    if (validMemberIds.length !== group.members.length) {
      console.log(`🧹 Cleaning group "${group.name}": removed ${group.members.length - validMemberIds.length} deleted users`);
      group.members = validMemberIds;
    }
    
    const memberNames = validMemberIds.map(memberId => {
      const user = userData.find(u => u.id === memberId);
      return user ? user.name : `User ${memberId}`;
    });
    
    groupCard.innerHTML = `
      <div class="group-header">
        <div class="group-title">${group.flagged ? '🚩 ' : ''}${group.name}</div>
        <div class="group-title">${group.name}${group.flagged ? ' 🚩' : ''}</div>
        <div class="group-count">${validMemberIds.length}/${group.size}</div>
        <button class="group-action-btn" onclick="openGroupActionModal('${group.id}')">?</button>
      </div>
      <ul class="group-members">
        ${memberNames.map(name => `
          <li class="group-member">
            <span>${name}</span>
            <button class="move-user-btn" onclick="moveUserToGroup(${validMemberIds.find((id, idx) => {
              const user = userData.find(u => u.id === id);
              return user && user.name === name;
            })}, '${group.id}')">Move</button>
          </li>
        `).join('')}
      </ul>
    `;
    container.appendChild(groupCard);
    console.log('🎨 [POPULATE GROUPS] Rendered group:', group.name);
    
    // Save updated groups to localStorage and Supabase
    if (validMemberIds.length !== group.members.length || group.members.length !== validMemberIds.length) {
      saveGroups();
      if (typeof window.syncGroupToSupabase === 'function') {
        window.syncGroupToSupabase(group);
      }
    }
  });
  console.log('✅ [POPULATE GROUPS] COMPLETE - rendered', groups.length, 'groups');
}

async function createGroups() {
  console.log('📋 [CREATE GROUPS] START');
  const groupSize = parseInt(document.getElementById('groupSize').value);
  console.log('📋 [CREATE GROUPS] Group size input:', groupSize);
  
  if (!groupSize || groupSize < 1) {
    console.warn('⚠️ [CREATE GROUPS] Invalid group size');
    showTemporaryMessage('Please enter a valid group size', 'warning');
    return;
  }
  
  // Clear existing groups
  console.log('📋 [CREATE GROUPS] Clearing', groups.length, 'existing groups');
  groups = [];
  
  // Create new groups
  const totalUsers = userData.length;
  const numGroups = Math.ceil(totalUsers / groupSize);
  
  console.log('📋 [CREATE GROUPS] Creating', numGroups, 'groups (', totalUsers, 'users ÷', groupSize, 'size)', 'Groups array will have', numGroups, 'elements');
  
  for (let i = 0; i < numGroups; i++) {
    const newGroup = {
      name: `Group ${String.fromCharCode(65 + i)}`,
      size: groupSize,
      members: [],
      flagged: false,
      leader_id: null,
      created_at: new Date().toISOString()
    };
    
    // Save to Supabase FIRST (synchronously), then add locally
    console.log('� [CREATE GROUPS] Processing group', i + 1, '/', numGroups, '- Name:', newGroup.name);
    console.log('📤 [CREATE GROUPS] Saving group', newGroup.name, 'to Supabase...');
    const supabaseSuccess = await saveGroupToSupabase(newGroup);
    console.log('📤 [CREATE GROUPS] Supabase save result:', supabaseSuccess, 'Group ID:', newGroup.id);
    
    if (supabaseSuccess) {
      console.log('✅ [CREATE GROUPS] Group', newGroup.name, 'successfully saved to Supabase with ID:', newGroup.id);
      groups.push(newGroup);
      console.log('📋 [CREATE GROUPS] Added to groups array, total groups now:', groups.length);
    } else {
      console.warn('⚠️ [CREATE GROUPS] Supabase sync failed for', newGroup.name, '- adding locally only');
      groups.push(newGroup);
    }
  }
  
  console.log('✅ [CREATE GROUPS] All groups created. Final groups array:', groups.length);
  console.log('📋 [CREATE GROUPS] Groups summary:', groups.map(g => ({ name: g.name, id: g.id, members: g.members.length })));
  saveGroups();
  populateGroups();
  showTemporaryMessage(`✅ ${numGroups} groups created with size ${groupSize}`, 'success');
  console.log('✅ [CREATE GROUPS] COMPLETE');
}

function autoAssignGroups() {
  console.log('🔀 [AUTO ASSIGN] START - groups:', groups.length, 'users:', userData.length);
  if (groups.length === 0) {
    console.warn('⚠️ [AUTO ASSIGN] No groups created');
    showTemporaryMessage('Please create groups first', 'warning');
    return;
  }
  
  // Reset all group members
  console.log('🔀 [AUTO ASSIGN] Resetting all group members');
  groups.forEach(group => group.members = []);
  
  // Assign users to groups in order
  console.log('🔀 [AUTO ASSIGN] Assigning users round-robin');
  userData.forEach((user, index) => {
    const groupIndex = index % groups.length;
    console.log('🔀 [AUTO ASSIGN] User:', user.name, '(ID:', user.id, ') → Group:', groups[groupIndex].name);
    const grp = groups[groupIndex];
    grp.members.push(user.id);
    // Assign both display name and canonical group_id so Supabase can store FK
    user.group = grp.name;
    user.group_id = grp.id;
    // Trigger background sync per user when Supabase client is available
    if (typeof syncUserToSupabaseBackground === 'function' && typeof supabaseClient !== 'undefined' && supabaseClient) {
      try { syncUserToSupabaseBackground(user.id, user); } catch (e) { console.warn('Auto-assign sync user failed', e); }
    }
  });
  
  console.log('🔀 [AUTO ASSIGN] Saving to localStorage');
  saveGroups();
  saveUserData();
  console.log('✅ [AUTO ASSIGN] COMPLETE');
  populateGroups();
  populateUserTable();
  
  showTemporaryMessage('Users auto-assigned to groups!', 'success');
}

function moveUserToGroup(userId, fromGroupId) {
  startMoveUser(userId, fromGroupId);
}


























// ================= ENHANCED GROUP MANAGEMENT =================
let groupOrderType = 'alphabetical';
let selectedUserForMove = null;
let groupToMoveTo = null;

function showManualGroupCreation() {
  const groupList = document.getElementById('groupList');
  if (!groupList) return;

  const manualDiv = document.createElement('div');
  manualDiv.className = 'manual-group-creation';
  manualDiv.innerHTML = `
    <div style="margin-bottom: 15px;">
      <strong style="color: var(--accent);">Create Groups Manually</strong>
      <p style="color: var(--muted); font-size: 0.9rem; margin-top: 5px;">
        Choose group naming style, then add groups one by one.
      </p>
    </div>

    <div class="group-order-options">
      <div class="order-option ${groupOrderType === 'alphabetical' ? 'active' : ''}"
           onclick="setGroupOrder('alphabetical')">
        <input type="radio" name="groupOrder" ${groupOrderType === 'alphabetical' ? 'checked' : ''}>
        Alphabetical (Group A, B, C...)
      </div>
      <div class="order-option ${groupOrderType === 'numerical' ? 'active' : ''}"
           onclick="setGroupOrder('numerical')">
        <input type="radio" name="groupOrder" ${groupOrderType === 'numerical' ? 'checked' : ''}>
        Numerical (Group 1, 2, 3...)
      </div>
    </div>

    <div class="manual-group-inputs">
      <input type="text" id="newGroupName" placeholder="Enter group name" class="form-input">
      <input type="number" id="newGroupSize" placeholder="Group size" class="form-input" min="1" max="50">
      <button class="form-btn secondary" onclick="addManualGroup()">Add Group</button>
    </div>

    <div id="manualGroupsPreview" style="margin-top: 15px;"></div>
  `;

  groupList.innerHTML = '';
  groupList.appendChild(manualDiv);
}

function setGroupOrder(order) {
  groupOrderType = order;
  document.querySelectorAll('.order-option').forEach(opt => {
    opt.classList.remove('active');
  });
  event.target.closest('.order-option').classList.add('active');
  updateManualGroupsPreview();
}

function addManualGroup() {
  console.log('➕ [ADD MANUAL GROUP] START');
  const nameInput = document.getElementById('newGroupName');
  const sizeInput = document.getElementById('newGroupSize');

  const name = nameInput.value.trim();
  const size = parseInt(sizeInput.value);
  console.log('➕ [ADD MANUAL GROUP] Name:', name, 'Size:', size);

  if (!name) {
    console.warn('⚠️ [ADD MANUAL GROUP] Missing group name');
    showTemporaryMessage('Please enter a group name', 'warning');
    return;
  }

  if (!size || size < 1) {
    console.warn('⚠️ [ADD MANUAL GROUP] Invalid size:', size);
    showTemporaryMessage('Please enter a valid group size', 'warning');
    return;
  }

  if (groups.find(g => g.name === name)) {
    console.warn('⚠️ [ADD MANUAL GROUP] Duplicate group name:', name);
    showTemporaryMessage('Group with this name already exists', 'warning');
    return;
  }

  const newGroup = {
    name: name,
    size: size,
    members: [],
    flagged: false,
    leader_id: null
  };
  console.log('➕ [ADD MANUAL GROUP] Created group object:', newGroup);

  // Sync to Supabase immediately so we get the UUID
  (async () => {
    console.log('📤 [ADD MANUAL GROUP] Calling saveGroupToSupabase...');
    const success = await saveGroupToSupabase(newGroup);
    console.log('📤 [ADD MANUAL GROUP] saveGroupToSupabase returned:', success, 'Group ID assigned:', newGroup.id);
    if (success) {
      console.log('✅ [ADD MANUAL GROUP] Group saved to Supabase with ID:', newGroup.id);
      groups.push(newGroup);
      console.log('✅ [ADD MANUAL GROUP] Added to groups array. Total groups now:', groups.length);
      saveGroups();
      nameInput.value = '';
      sizeInput.value = '';
      updateManualGroupsPreview();
      showTemporaryMessage(`✅ Group "${name}" created!`, 'success');
      console.log('✅ [ADD MANUAL GROUP] COMPLETE');
    } else {
      console.error('❌ [ADD MANUAL GROUP] Failed to save group to Supabase');
      showTemporaryMessage('Error creating group. Please try again.', 'error');
    }
  })();
}

function updateManualGroupsPreview() {
  const previewDiv = document.getElementById('manualGroupsPreview');
  if (!previewDiv) return;

  if (groups.length === 0) {
    previewDiv.innerHTML = '<p style="color: var(--muted);">No groups created yet</p>';
    return;
  }

  previewDiv.innerHTML = `
    <div style="margin-bottom: 10px; color: var(--accent); font-weight: bold;">
      Created Groups (${groups.length})
    </div>
    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
      ${groups.map(group => `
        <div style="background: rgba(12, 16, 36, 0.5); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(91, 140, 255, 0.3);">
          ${group.name} (0/${group.size})
        </div>
      `).join('')}
    </div>
    <button class="form-btn primary" onclick="finishManualGroupCreation()" style="margin-top: 15px;">
      Finish & View Groups
    </button>
  `;
}

function finishManualGroupCreation() {
  populateGroups();
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
        <button class="form-btn primary" onclick="showManualGroupCreation()" style="margin-top: 15px;">
          Create Groups Manually
        </button>
      </div>
    `;
    return;
  }

  let groupsContainer = document.getElementById('groupsContainer');
  if (!groupsContainer) {
    groupsContainer = document.createElement('div');
    groupsContainer.className = 'groups-container';
    groupsContainer.id = 'groupsContainer';
    container.appendChild(groupsContainer);

    const orderToggle = document.createElement('div');
    orderToggle.className = 'group-order-options';
    orderToggle.innerHTML = `
      <div style="color: var(--text); font-weight: bold; margin-right: 10px; display: block;">Group Order:</div><br>
      <div class="order-option ${groupOrderType === 'alphabetical' ? 'active' : ''}"
           onclick="toggleGroupOrder('alphabetical')">
        <input type="radio" name="groupOrderDisplay" ${groupOrderType === 'alphabetical' ? 'checked' : ''}>
        Alphabetical
      </div>
      <div class="order-option ${groupOrderType === 'numerical' ? 'active' : ''}"
           onclick="toggleGroupOrder('numerical')">
        <input type="radio" name="groupOrderDisplay" ${groupOrderType === 'numerical' ? 'checked' : ''}>
        Numerical
      </div>
    `;
    groupsContainer.appendChild(orderToggle);

    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'groups-scroll-container';
    scrollContainer.id = 'groupsScrollContainer';

    const horizontalLayout = document.createElement('div');
    horizontalLayout.className = 'groups-horizontal-layout';
    horizontalLayout.id = 'groupsHorizontalLayout';

    scrollContainer.appendChild(horizontalLayout);
    groupsContainer.appendChild(scrollContainer);

    const flagBadgeEl = document.createElement('div');
    flagBadgeEl.id = 'flagCountBadge';
    flagBadgeEl.className = 'flag-count-badge';
    flagBadgeEl.textContent = `Flagged: ${groups.filter(g => g.flagged).length}/${groups.length}`;
    groupsContainer.appendChild(flagBadgeEl);
  }

  const badge = document.getElementById('flagCountBadge');
  if (badge) {
    const flaggedTotal = groups.filter(g => g.flagged).length;
    const totalGroups = groups.length;
    badge.textContent = `Flagged: ${flaggedTotal}/${totalGroups}`;
    badge.style.display = totalGroups === 0 ? 'none' : 'block';
  }

  const sortedGroups = [...groups].sort((a, b) => {
    if (groupOrderType === 'numerical') {
      const numA = parseInt(a.name.replace(/\D/g, '')) || 0;
      const numB = parseInt(b.name.replace(/\D/g, '')) || 0;
      return numA - numB;
    } else {
      return a.name.localeCompare(b.name);
    }
  });

  const horizontalLayout = document.getElementById('groupsHorizontalLayout');
  if (!horizontalLayout) return;
  
  horizontalLayout.innerHTML = '';

  const displayGroups = sortedGroups;
  if (displayGroups.length === 0) {
    horizontalLayout.innerHTML = `<div style="padding:20px;color:var(--muted);">No groups match the current filters.</div>`;
  }

  displayGroups.forEach(group => {
    const groupCard = document.createElement('div');
    groupCard.id = `group-card-${group.id}`;
    
    if (group.flagged) {
      groupCard.className = 'group-card flagged-group';
    } else {
      groupCard.className = 'group-card';
    }

    const memberNames = group.members.map(memberId => {
      const user = userData.find(u => u.id === memberId);
      return user ? {
        id: user.id,
        name: user.name,
        isLeader: group.leader === user.id,
        flagged: user.status === 'flagged'
      } : null;
    }).filter(Boolean);
    // Determine if there are any unassigned users remaining (so Add Member should remain visible)
    const hasUnassigned = Array.isArray(userData) && Array.isArray(groups) && userData.some(u => !groups.some(g => Array.isArray(g.members) && g.members.includes(u.id)));

    groupCard.innerHTML = `
      <div class="group-header">
        <div style="display:flex; align-items:center; gap:8px;">
          <div class="group-title">${group.name}${group.flagged ? ' 🚩' : ''}</div>
          <button class="group-action-btn" title="Group actions" onclick="openGroupActionModal('${group.id}')">?</button>
        </div>
        <div class="group-count">${group.members.length}/${group.size}</div>
      </div>

      ${group.leader ? `
        <div style="margin: 10px 0; padding: 8px; background: rgba(255, 215, 0, 0.1); border-radius: 6px; border: 1px solid rgba(255, 215, 0, 0.3);">
          <span style="color: gold; font-weight: bold;">★ Group Leader:</span>
          ${userData.find(u => u.id === group.leader)?.name || 'Unknown'}
        </div>
      ` : ''}

      <div class="group-members-container">
        <ul class="group-members">
          ${memberNames.map(member => `
            <li class="group-member ${member.isLeader ? 'group-leader' : ''} ${member.flagged ? 'member-flagged' : ''}" id="member-${member.id}">
              <span>${member.isLeader ? '★ ' : ''}${member.name}</span>
              <div>
                ${!member.isLeader ? `<button class="move-user-btn" onclick="setUserAsLeader(${member.id}, '${group.id}')">Set as Leader</button>` : ''}
                <button class="move-user-btn" onclick="startMoveUser(${member.id}, '${group.id}')">Move</button>
              </div>
            </li>
          `).join('')}
        </ul>
      </div>

      ${(group.members.length < group.size || hasUnassigned) ? `
        <button class="form-btn secondary" onclick="addMemberToGroup('${group.id}')" style="width: 100%; margin-top: 10px; padding: 1px;">
          + Add Member
        </button>
      ` : ''}
    `;
    horizontalLayout.appendChild(groupCard);
  });
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
    <div class="case-modal-content" style="max-width:420px; padding:20px; border-radius:10px; background: var(--card);">
      <h3 style="color:var(--accent); margin-bottom:10px;">Actions for ${group.name}</h3>
      <div style="display:flex; gap:10px; margin-bottom:14px;">
        <button class="form-btn" style="background: linear-gradient(90deg,#ef4444,#f97316); color:white;" onclick="deleteGroup('${groupId}')">🔴 Delete Group</button>
        <button class="form-btn" style="background: linear-gradient(90deg,#a855f7,#9333ea); color:white;" onclick="toggleFlagGroup('${groupId}')">${group.flagged ? '🟣 Unflag Group' : '🟣 Flag Group'}</button>
      </div>
      <div style="text-align:right;"><button class="modal-btn cancel" onclick="document.getElementById('groupActionModal').remove()">Close</button></div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function deleteGroup(groupId) {
  try {
    if (!confirm('Delete this group? Members will become ungrouped.')) return;
    console.log('🗑️ [DELETE GROUP] Deleting group:', groupId, 'from window.groups:', window.groups?.length || 0, 'and groups:', groups?.length || 0);
    
    // Reload from localStorage to pick up any changes made by tests or external code
    const savedGroups = localStorage.getItem('ring0_user_groups');
    if (savedGroups) {
      try {
        const reloadedGroups = JSON.parse(savedGroups);
        if (reloadedGroups && reloadedGroups.length > groups.length) {
          console.log('[DELETE GROUP] Reloaded groups from localStorage:', reloadedGroups.length, 'items');
          groups = reloadedGroups;
          window.groups = reloadedGroups;
        }
      } catch (e) {
        console.warn('[DELETE GROUP] Failed to reload from localStorage:', e);
      }
    }
    
    // Prefer window.groups if available and larger
    const groupsToSearch = (window.groups && Array.isArray(window.groups) && window.groups.length >= groups.length) ? window.groups : groups;
    const idx = groupsToSearch.findIndex(g => g.id === groupId);
    
    if (idx === -1) {
      console.warn('⚠️ [DELETE GROUP] Group not found:', groupId, '- Searched in:', groupsToSearch.map(g => g.id));
      return;
    }
    const removed = groupsToSearch.splice(idx, 1)[0];
    
    // Sync both arrays
    groups = groupsToSearch;
    window.groups = groupsToSearch;

    // Ungroup members locally and queue background sync for each user
    for (const uid of (removed.members || [])) {
      const u = userData.find(x => Number(x.id) === Number(uid) || String(x.id) === String(uid));
      if (u) {
        u.group = '';
        u.group_id = null;
        // persist per-user change to Supabase asynchronously
        if (typeof syncUserToSupabaseBackground === 'function') {
          try { syncUserToSupabaseBackground(u.id, u); } catch (e) { console.warn('Failed to sync user after group delete:', e); }
        }
      }
    }

    // Persist groups/users locally
    saveGroups();
    saveUserData();
    populateGroups();
    populateUserTable();

    // Remove group from Supabase if client exists
    if (window.supabaseClient) {
      try {
        const { error } = await window.supabaseClient
          .from('user_groups')
          .delete()
          .eq('id', groupId);
        if (error) console.error('❌ [DELETE GROUP] Supabase delete error:', error);
        else console.log('✅ [DELETE GROUP] Removed group from Supabase:', groupId);
      } catch (e) {
        console.error('❌ [DELETE GROUP] Exception deleting group from Supabase:', e);
      }
    }

    const m = document.getElementById('groupActionModal'); if (m) m.remove();
    showTemporaryMessage(`Group ${removed.name} deleted. Members are now ungrouped.`, 'success');
  } catch (e) {
    console.error('❌ [DELETE GROUP] Exception:', e);
  }
}

async function toggleFlagGroup(groupId) {
  try {
    console.log('🚩 [TOGGLE FLAG] for group:', groupId, 'from window.groups:', window.groups?.length || 0, 'and groups:', groups?.length || 0);
    
    // Reload from localStorage to pick up any changes made by tests or external code
    const savedGroups = localStorage.getItem('ring0_user_groups');
    if (savedGroups) {
      try {
        const reloadedGroups = JSON.parse(savedGroups);
        console.log('[TOGGLE FLAG] Loaded from localStorage:', reloadedGroups?.length || 0, 'items. Group IDs:', reloadedGroups?.map(g => g.id).slice(0, 3) || []);
        if (reloadedGroups && reloadedGroups.length > groups.length) {
          console.log('[TOGGLE FLAG] Reloaded groups from localStorage:', reloadedGroups.length, 'items');
          groups = reloadedGroups;
          window.groups = reloadedGroups;
        }
      } catch (e) {
        console.warn('[TOGGLE FLAG] Failed to reload from localStorage:', e);
      }
    }
    
    // Prefer window.groups if available and larger
    const groupsToSearch = (window.groups && Array.isArray(window.groups) && window.groups.length >= groups.length) ? window.groups : groups;
    console.log('[TOGGLE FLAG] Searching in:', groupsToSearch === window.groups ? 'window.groups' : 'groups', 'with', groupsToSearch?.length || 0, 'items');
    const group = groupsToSearch.find(g => g.id === groupId);
    
    if (!group) {
      console.warn('⚠️ [TOGGLE FLAG] Group not found:', groupId, '- All group IDs:', groupsToSearch?.map(g => g.id) || []);
      return;
    }
    group.flagged = !group.flagged;
    console.log('✅ [TOGGLE FLAG] Found and toggled group:', group.name, 'flagged:', group.flagged);
    
    // Sync both arrays
    groups = groupsToSearch;
    window.groups = groupsToSearch;

    // Update member statuses locally and sync each user
    for (const uid of (group.members || [])) {
      const u = userData.find(x => Number(x.id) === Number(uid) || String(x.id) === String(uid));
      if (!u) continue;
      if (group.flagged) {
        u.status = 'flagged';
      } else {
        u.status = 'active';
        u.caseInfo = '';
      }
      if (typeof syncUserToSupabaseBackground === 'function') {
        try { syncUserToSupabaseBackground(u.id, u); } catch (e) { console.warn('Failed to sync user flag change:', e); }
      }
    }

    // Persist and sync group
    saveGroups();
    saveUserData();
    populateGroups();
    populateUserTable();

    if (typeof window.syncGroupToSupabase === 'function') {
      window.syncGroupToSupabase(group);
    } else if (typeof saveGroupToSupabase === 'function') {
      try { await saveGroupToSupabase(group); } catch (e) { console.warn('Failed to save group to Supabase:', e); }
    }

    const m = document.getElementById('groupActionModal'); if (m) m.remove();
    showTemporaryMessage(`${group.flagged ? 'Group flagged.' : 'Group unflagged.'}`, group.flagged ? 'warning' : 'success');
  } catch (e) {
    console.error('❌ [TOGGLE FLAG] Exception:', e);
  }
}

function toggleGroupOrder(order) {
  groupOrderType = order;
  populateGroups();
}

function startMoveUser(userId, fromGroupId) {
  selectedUserForMove = userId;
  groupToMoveTo = null;

  const user = userData.find(u => u.id === userId);
  if (!user) return;

  document.querySelectorAll('.group-member').forEach(member => {
    member.classList.remove('user-selected');
  });
  const selectedMember = document.getElementById(`member-${userId}`);
  if (selectedMember) {
    selectedMember.classList.add('user-selected');
  }

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

      <div class="group-search">
        <input type="text" class="group-search-input" id="searchGroups" placeholder="Search for a group..." onkeyup="searchAvailableGroups()">
      </div>

      <div class="groups-list-move" id="groupsListMove">
        ${availableGroups.map(group => {
          const userCount = group.members.length;
          const isFull = userCount >= group.size;

          return `
            <div class="group-item-move ${isFull ? 'disabled' : ''}" onclick="${isFull ? '' : `selectGroupForMove('${group.id}')`}">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <strong>${group.name}</strong>
                  ${group.leader ? ' <span style="color: gold; font-size: 0.9rem;">★</span>' : ''}
                </div>
                <div style="color: ${isFull ? 'var(--warning)' : 'var(--muted)'}; font-size: 0.9rem;">
                  ${userCount}/${group.size} members
                  ${isFull ? ' (Full)' : ''}
                </div>
              </div>
            </div>
          `;
        }).join('')}

        ${availableGroups.length === 0 ?
          '<p style="color: var(--muted); text-align: center; padding: 20px;">No other groups available</p>' :
          ''}
      </div>

      <div class="modal-buttons">
        <button class="modal-btn cancel" onclick="closeMoveModal()">Cancel</button>
        <button class="modal-btn yes" onclick="completeMoveUser()" id="confirmMoveBtn" disabled>
          Move User
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

function searchAvailableGroups() {
  const searchTerm = document.getElementById('searchGroups').value.toLowerCase();
  const groupItems = document.querySelectorAll('.group-item-move');

  groupItems.forEach(item => {
    const groupName = item.querySelector('strong').textContent.toLowerCase();
    if (groupName.includes(searchTerm)) {
      item.style.display = 'block';
    } else {
      item.style.display = 'none';
    }
  });
}

function selectGroupForMove(groupId) {
  groupToMoveTo = groupId;

  document.querySelectorAll('.group-item-move').forEach(item => {
    item.style.background = '';
    item.style.borderColor = '';
  });

  const selectedItem = document.querySelector(`.group-item-move[onclick*="${groupId}"]`);
  if (selectedItem) {
    selectedItem.style.background = 'rgba(91, 140, 255, 0.1)';
    selectedItem.style.borderColor = 'var(--accent)';
  }

  document.getElementById('confirmMoveBtn').disabled = false;
}

function completeMoveUser() {
  console.log('🔄 [MOVE USER] START - selectedUserForMove:', selectedUserForMove, 'groupToMoveTo:', groupToMoveTo);
  if (!selectedUserForMove || !groupToMoveTo) {
    console.warn('⚠️ [MOVE USER] Missing user or group selection');
    return;
  }

  const numericUserId = Number(selectedUserForMove);
  console.log('🔄 [MOVE USER] Numeric ID:', numericUserId);
  const currentGroup = groups.find(g => g.members && g.members.includes(numericUserId));
  const targetGroup = groups.find(g => g.id === groupToMoveTo);
  console.log('🔄 [MOVE USER] From group:', currentGroup?.name, 'To group:', targetGroup?.name);

  if (!currentGroup || !targetGroup) {
    console.error('❌ [MOVE USER] Group not found - currentGroup:', !!currentGroup, 'targetGroup:', !!targetGroup);
    return;
  }

  if (targetGroup.members.length >= targetGroup.size) {
    showTemporaryMessage('Target group is full!', 'warning');
    return;
  }

  // Remove from current group
  currentGroup.members = currentGroup.members.filter(id => id !== numericUserId);
  if (currentGroup.leader === numericUserId) {
    currentGroup.leader = null;
    currentGroup.leader_id = null;
  }

  // Add to target group
  if (!targetGroup.members) targetGroup.members = [];
  targetGroup.members.push(numericUserId);

  // Update local userData with new group info
  const userIndex = userData.findIndex(u => Number(u.id) === numericUserId);
  if (userIndex !== -1) {
    userData[userIndex].group = targetGroup.name;
    userData[userIndex].group_id = targetGroup.id;
    userData[userIndex].dynamic_fields = userData[userIndex].dynamic_fields || {};
    userData[userIndex].dynamic_fields.is_leader = false;
  }

  // Persist locally
  console.log('💾 [MOVE USER] Saving to localStorage...');
  saveGroups();
  saveUserData();
  closeMoveModal();
  populateGroups();
  populateUserTable();
  showTemporaryMessage('User moved successfully!', 'success');

  // Sync changes to Supabase: both groups and the user
  console.log('📤 [MOVE USER] Syncing to Supabase - User ID:', userData[userIndex]?.id, 'has valid ID:', !!userData[userIndex]?.id);
  if (typeof window.syncGroupToSupabase === 'function') {
    console.log('📤 [MOVE USER] Syncing current group:', currentGroup.name);
    window.syncGroupToSupabase(currentGroup);
    console.log('📤 [MOVE USER] Syncing target group:', targetGroup.name);
    window.syncGroupToSupabase(targetGroup);
  } else if (typeof saveGroupToSupabase === 'function') {
    console.log('📤 [MOVE USER] Syncing current group:', currentGroup.name);
    saveGroupToSupabase(currentGroup);
    console.log('📤 [MOVE USER] Syncing target group:', targetGroup.name);
    saveGroupToSupabase(targetGroup);
  }

  if (typeof syncUserToSupabaseBackground === 'function' && userIndex !== -1) {
    console.log('📤 [MOVE USER] Syncing user data for:', userData[userIndex].name, 'ID:', userData[userIndex].id);
    syncUserToSupabaseBackground(userData[userIndex].id, userData[userIndex]);
  } else {
    console.warn('⚠️ [MOVE USER] Could not sync user - function unavailable or userIndex invalid');
  }
  console.log('✅ [MOVE USER] COMPLETE');
}

function closeMoveModal() {
  const modal = document.getElementById('moveUserModal');
  if (modal) modal.remove();

  document.querySelectorAll('.user-selected').forEach(el => {
    el.classList.remove('user-selected');
  });

  selectedUserForMove = null;
  groupToMoveTo = null;
}

function setUserAsLeader(userId, groupId) {
  console.log('👑 [SET LEADER] START - userId:', userId, 'groupId:', groupId);
  const numericUserId = Number(userId);
  const group = groups.find(g => g.id === groupId);
  if (!group) {
    console.error('❌ [SET LEADER] Group not found:', groupId);
    return;
  }
  console.log('👑 [SET LEADER] Group found:', group.name);

  if (!group.members || !group.members.includes(numericUserId)) {
    console.warn('⚠️ [SET LEADER] User', numericUserId, 'not in group:', group.name);
    showTemporaryMessage('User is not in this group!', 'warning');
    return;
  }

  // Clear previous leader if exists
  const prevLeader = group.leader || group.leader_id || null;
  console.log('👑 [SET LEADER] Previous leader:', prevLeader);
  if (prevLeader && prevLeader !== numericUserId) {
    const prevIdx = userData.findIndex(u => Number(u.id) === Number(prevLeader));
    console.log('👑 [SET LEADER] Clearing previous leader, user index:', prevIdx);
    if (prevIdx !== -1) {
      userData[prevIdx].dynamic_fields = userData[prevIdx].dynamic_fields || {};
      userData[prevIdx].dynamic_fields.is_leader = false;
      console.log('👑 [SET LEADER] Syncing previous leader removal');
      if (typeof syncUserToSupabaseBackground === 'function') syncUserToSupabaseBackground(userData[prevIdx].id, userData[prevIdx]);
    }
  }

  // Set leader on group
  group.leader = numericUserId;
  group.leader_id = numericUserId;
  console.log('👑 [SET LEADER] Set new leader on group:', group.name, 'Leader ID:', numericUserId);

  // Update user record
  const userIdx = userData.findIndex(u => Number(u.id) === numericUserId);
  console.log('👑 [SET LEADER] Found user at index:', userIdx, 'User:', userData[userIdx]?.name);
  if (userIdx !== -1) {
    userData[userIdx].dynamic_fields = userData[userIdx].dynamic_fields || {};
    userData[userIdx].dynamic_fields.is_leader = true;
    userData[userIdx].group_id = group.id;
    userData[userIdx].group = group.name;
    console.log('👑 [SET LEADER] Updated user record, syncing to Supabase');
    if (typeof syncUserToSupabaseBackground === 'function') syncUserToSupabaseBackground(userData[userIdx].id, userData[userIdx]);
  }

  saveGroups();
  populateGroups();
  showTemporaryMessage(`${userData[userIdx]?.name || 'User'} set as group leader!`, 'success');

  console.log('👑 [SET LEADER] Syncing group to Supabase');
  if (typeof window.syncGroupToSupabase === 'function') {
    window.syncGroupToSupabase(group);
  } else if (typeof saveGroupToSupabase === 'function') {
    saveGroupToSupabase(group);
  }
  console.log('✅ [SET LEADER] COMPLETE');
}

function addMemberToGroup(groupId) {
  // Use optimized version if available
  if (typeof window.addMemberOptimized === 'function') {
    window.addMemberOptimized(groupId);
    showTemporaryMessage('Member added quickly!', 'success');
    return;
  }

  // Fallback to original implementation
  const unassignedUsers = userData.filter(user => {
    const inAnyGroup = groups.some(g => g.members.includes(user.id));
    return !inAnyGroup;
  });

  if (unassignedUsers.length === 0) {
    showTemporaryMessage('No unassigned users available', 'warning');
    return;
  }

  const group = groups.find(g => g.id === groupId);
  if (!group) return;

  const userToAdd = unassignedUsers[0];
  const numericId = Number(userToAdd.id);
  if (!group.members) group.members = [];
  group.members.push(numericId);

  const userIndex = userData.findIndex(u => Number(u.id) === numericId);
  if (userIndex !== -1) {
    userData[userIndex].group = group.name;
    userData[userIndex].group_id = group.id;
  }

  saveGroups();
  saveUserData();
  populateGroups();
  populateUserTable();
  showTemporaryMessage(`${userToAdd.name} added to ${group.name}!`, 'success');

  // Sync to Supabase
  if (typeof window.syncGroupToSupabase === 'function') {
    window.syncGroupToSupabase(group);
  } else if (typeof saveGroupToSupabase === 'function') {
    saveGroupToSupabase(group);
  }

  if (typeof syncUserToSupabaseBackground === 'function' && userIndex !== -1) {
    syncUserToSupabaseBackground(userData[userIndex].id, userData[userIndex]);
  }
}















// ================= REGISTRATION SETTINGS =================
function updateRegistrationSwitch() {
  const isEnabled = localStorage.getItem('ring0_registration_enabled') !== 'false';
  const registrationSwitch = document.getElementById('registrationSwitch');
  if (registrationSwitch) {
    registrationSwitch.checked = isEnabled;
  }
}

// NEW: Function to instantly toggle registration with immediate UI update
function toggleRegistrationInstantly() {
  const registrationSwitch = document.getElementById('registrationSwitch');
  if (!registrationSwitch) return;
  
  // Toggle the switch
  registrationSwitch.checked = !registrationSwitch.checked;
  const isEnabled = registrationSwitch.checked;
  
  // Update localStorage IMMEDIATELY
  localStorage.setItem('ring0_registration_enabled', isEnabled);
  
  // Update UI IMMEDIATELY without waiting for Supabase
  updateMainMenuInstantly();
  showTemporaryMessage(`Member sign up ${isEnabled ? 'enabled' : 'disabled'} instantly!`, 'success');
  
  // Then sync to Supabase in background
  saveRegistrationSettingsToSupabase();
}

function updateRegistrationVisibility() {
  const registrationSwitch = document.getElementById('registrationSwitch');
  if (!registrationSwitch) return;
  
  const isEnabled = registrationSwitch.checked;
  localStorage.setItem('ring0_registration_enabled', isEnabled);
  
  // Update UI instantly
  updateMainMenuInstantly();
  
  showTemporaryMessage(`Member sign up ${isEnabled ? 'enabled' : 'disabled'}!`, 'success');
}

async function saveRegistrationSettings() {
  try {
    // Read current UI values
    const registrationModeSwitch = document.getElementById('registrationModeSwitch');
    const registrationSwitch = document.getElementById('registrationSwitch');
    const linkInput = document.getElementById('registrationLink');

    const isEnabled = !!(registrationSwitch && registrationSwitch.checked);
    const useLink = !!(registrationModeSwitch && registrationModeSwitch.checked);
    const linkValue = (linkInput && linkInput.value && linkInput.value.trim()) ? linkInput.value.trim() : null;

    // Update localStorage and UI immediately
    localStorage.setItem('ring0_registration_enabled', isEnabled);
    localStorage.setItem('ring0_registration_mode', useLink ? 'link' : 'default');
    if (useLink && linkValue) {
      localStorage.setItem('ring0_registration_link', linkValue);
    } else {
      localStorage.removeItem('ring0_registration_link');
    }

    // Update UI instantly
    updateRegistrationSwitch();
    updateMainMenuInstantly();
    updateRegistrationSettingsUI();

    // Save to Supabase in background
    await saveRegistrationSettingsToSupabase();
    
    showTemporaryMessage('Registration settings saved and synced!', 'success');

  } catch (error) {
    console.error('Error saving registration settings:', error);
    showTemporaryMessage('Settings saved locally (sync will retry)', 'warning');
  }
}

// NEW: Separate function for Supabase sync
async function saveRegistrationSettingsToSupabase() {
  try {
    const isEnabled = localStorage.getItem('ring0_registration_enabled') !== 'false';
    const mode = localStorage.getItem('ring0_registration_mode') || 'default';
    const linkValue = localStorage.getItem('ring0_registration_link');

    const registrationSettings = {
      enabled: isEnabled,
      mode: mode,
      registration_link: mode === 'link' ? (linkValue || '') : null,
      updated_at: new Date().toISOString()
    };

    // Save to Supabase
    const { data: existingSettings, error: fetchError } = await supabaseClient
      .from('registration_settings')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1);

    if (fetchError) throw fetchError;

    if (existingSettings && existingSettings.length > 0) {
      // Update existing record
      const { error: updateError } = await supabaseClient
        .from('registration_settings')
        .update(registrationSettings)
        .eq('id', existingSettings[0].id);

      if (updateError) throw updateError;
      console.log('✅ Settings synced to Supabase');
    } else {
      // Insert new record
      const { error: insertError } = await supabaseClient
        .from('registration_settings')
        .insert([registrationSettings]);

      if (insertError) throw insertError;
      console.log('✅ Settings inserted to Supabase');
    }
  } catch (error) {
    console.error('Error syncing to Supabase:', error);
    // Don't show error to user - it will retry later
  }
}

// NEW: Instant UI update function
function updateMainMenuInstantly() {
  const isEnabled = localStorage.getItem('ring0_registration_enabled') !== 'false';
  const mode = localStorage.getItem('ring0_registration_mode') || 'default';

  // Get or create navigation
  const nav = document.querySelector('nav');
  if (!nav) {
    console.warn('Navigation not found');
    return;
  }
  
  // Find existing member sign up button
  let memberSignUpBtn = Array.from(nav.children).find(btn => 
    btn.id === 'memberSignUpBtn' ||
    (btn.textContent && btn.textContent.toLowerCase().includes('member') && 
     (btn.textContent.toLowerCase().includes('sign') || btn.textContent.toLowerCase().includes('up')))
  );

  // Create button if it doesn't exist
  if (!memberSignUpBtn) {
    memberSignUpBtn = document.createElement('button');
    memberSignUpBtn.id = 'memberSignUpBtn';
    memberSignUpBtn.className = 'menu-btn';
    
    // Find where to insert it (before admin login or at the end)
    const adminLoginBtn = nav.querySelector('button.admin-login');
    if (adminLoginBtn) {
      nav.insertBefore(memberSignUpBtn, adminLoginBtn);
    } else {
      nav.appendChild(memberSignUpBtn);
    }
  }

  // Update button based on settings
  if (isEnabled) {
    // Show button
    memberSignUpBtn.style.display = 'flex';
    memberSignUpBtn.style.alignItems = 'center';
    memberSignUpBtn.style.justifyContent = 'center';
    memberSignUpBtn.style.gap = '8px';
    
    // Add icon
    if (!memberSignUpBtn.querySelector('.btn-icon')) {
      const icon = document.createElement('span');
      icon.className = 'btn-icon';
      icon.innerHTML = '👤';
      icon.style.fontSize = '16px';
      memberSignUpBtn.prepend(icon);
    }
    
    // Set text and action
    memberSignUpBtn.innerHTML = 'Member Sign Up';
    
    // Set click handler
    if (mode === 'link') {
      memberSignUpBtn.onclick = function() {
        const link = localStorage.getItem('ring0_registration_link') || 'groups.html';
        if (link && (link.startsWith('http') || link.startsWith('https'))) {
          window.location.href = link;
        } else {
          window.open(link, '_blank');
        }
      };
    } else {
      memberSignUpBtn.onclick = function() {
        openDefaultRegistrationForm();
      };
    }
    
    // Add visual feedback
    memberSignUpBtn.style.opacity = '1';
    memberSignUpBtn.style.transform = 'scale(1)';
    memberSignUpBtn.style.transition = 'all 0.3s ease';
    
  } else {
    // Hide button with animation
    memberSignUpBtn.style.opacity = '0';
    memberSignUpBtn.style.transform = 'scale(0.9)';
    memberSignUpBtn.style.transition = 'all 0.3s ease';
    
    // Remove after animation
    setTimeout(() => {
      memberSignUpBtn.style.display = 'none';
    }, 300);
  }

  // Update groups button if needed
  updateGroupsButtonInstantly();
}

// NEW: Update groups button instantly
function updateGroupsButtonInstantly() {
  const mode = localStorage.getItem('ring0_registration_mode') || 'default';
  const nav = document.querySelector('nav');
  
  if (!nav) return;
  
  let groupsBtn = Array.from(nav.children).find(btn => 
    btn.id === 'groupsBtn' || 
    (btn.textContent && btn.textContent.toLowerCase().includes('groups'))
  );
  
  if (!groupsBtn && mode === 'link') {
    groupsBtn = document.createElement('button');
    groupsBtn.id = 'groupsBtn';
    groupsBtn.textContent = 'Groups';
    groupsBtn.className = 'menu-btn';
    
    const adminLoginBtn = nav.querySelector('button.admin-login');
    if (adminLoginBtn) {
      nav.insertBefore(groupsBtn, adminLoginBtn);
    } else {
      nav.appendChild(groupsBtn);
    }
  }
  
  if (groupsBtn) {
    groupsBtn.onclick = function() {
      if (mode === 'link') {
        const link = localStorage.getItem('ring0_registration_link') || 'groups.html';
        window.open(link, '_blank');
      } else {
        showTemporaryMessage('Groups functionality coming soon!', 'info');
      }
    };
  }
}

function updateRegistrationSettingsUI() {
  const registrationTab = document.getElementById('settingsTab');
  if (!registrationTab) return;

  const existingModeContainer = registrationTab.querySelector('.registration-mode-container');
  const existingLinkSettings = registrationTab.querySelector('.link-settings');

  if (existingModeContainer && existingLinkSettings) {
    const savedMode = localStorage.getItem('ring0_registration_mode') || 'default';
    const savedLink = localStorage.getItem('ring0_registration_link') || 'groups.html';

    const modeSwitch = document.getElementById('registrationModeSwitch');
    if (modeSwitch) modeSwitch.checked = savedMode === 'link';

    const linkInput = document.getElementById('registrationLink');
    if (linkInput) linkInput.value = savedLink;

    toggleLinkSettings(savedMode === 'link');
    return;
  }

  if (existingModeContainer) existingModeContainer.remove();
  if (existingLinkSettings) existingLinkSettings.remove();

  const existingSwitchContainer = registrationTab.querySelector('.registration-switch-container');

  const modeContainer = document.createElement('div');
  modeContainer.className = 'registration-mode-container';
  modeContainer.innerHTML = `
    <div class="registration-mode-label">Registration Method</div>
    <label class="registration-mode-switch">
      <input type="checkbox" id="registrationModeSwitch">
      <span class="registration-mode-slider"></span>
    </label>
  `;

  existingSwitchContainer.parentNode.insertBefore(modeContainer, existingSwitchContainer.nextSibling);

  const linkSettings = document.createElement('div');
  linkSettings.className = 'link-settings';
  linkSettings.id = 'linkSettings';
  linkSettings.innerHTML = `
    <div style="margin-bottom: 15px;">
      <strong style="color: var(--accent);">External Link Registration</strong>
      <div class="mode-description">
        When users click "Member Sign Up", they will be redirected to this external URL.
        In "Default" mode, users will use the built-in groups.html file.
      </div>
    </div>

    <div class="link-input-group">
      <input type="text" id="registrationLink" value="http://yourdomain.com/register.html" class="form-input" placeholder="Enter external registration URL">
      <button class="test-link-btn" onclick="testRegistrationLink()">Test Link</button>
    </div>

    <div class="form-group">
      <label class="form-label">Link Behavior</label>
      <select class="form-select" id="linkBehavior">
        <option value="redirect">Redirect to link (default)</option>
        <option value="embed">Embed link in iframe</option>
        <option value="popup">Open in popup window</option>
      </select>
    </div>

    <div style="margin-top: 20px; padding: 15px; background: rgba(53, 208, 127, 0.1); border-radius: 8px; border: 1px solid rgba(53, 208, 127, 0.3);">
      <strong style="color: var(--success);">Mode Information:</strong>
      <p style="color: var(--muted); font-size: 0.85rem; margin-top: 5px;">
        • <strong>Default mode:</strong> Uses built-in groups.html file for registration<br>
        • <strong>Link mode:</strong> Redirects to external URL (enter above)
      </p>
    </div>
  `;

  modeContainer.parentNode.insertBefore(linkSettings, modeContainer.nextSibling.nextSibling);

  const savedMode = localStorage.getItem('ring0_registration_mode') || 'default';
  const savedLink = localStorage.getItem('ring0_registration_link') || 'http://yourdomain.com/register.html';

  const modeSwitch = document.getElementById('registrationModeSwitch');
  if (modeSwitch) modeSwitch.checked = savedMode === 'link';

  const linkInput = document.getElementById('registrationLink');
  if (linkInput) linkInput.value = savedLink;

  toggleLinkSettings(savedMode === 'link');

  if (modeSwitch) {
    modeSwitch.addEventListener('change', function() {
      toggleLinkSettings(this.checked);
      // Update localStorage and UI immediately
      localStorage.setItem('ring0_registration_mode', this.checked ? 'link' : 'default');
      updateMainMenuInstantly();
    });
  }
}

function toggleLinkSettings(show) {
  const linkSettings = document.getElementById('linkSettings');
  if (linkSettings) {
    if (show) {
      linkSettings.classList.add('active');
    } else {
      linkSettings.classList.remove('active');
    }
  }
}

function testRegistrationLink() {
  const linkInput = document.getElementById('registrationLink');
  if (!linkInput) return;
  
  const link = linkInput.value;
  if (!link) {
    showTemporaryMessage('Please enter a link', 'warning');
    return;
  }

  window.open(link, '_blank');
  showTemporaryMessage('Link opened in new tab for testing', 'info');
}

// NEW: Optimized updateMainMenu function
function updateMainMenu() {
  updateMainMenuInstantly();
}

function openDefaultRegistrationForm() {
  // Check if registration is enabled
  const isEnabled = localStorage.getItem('ring0_registration_enabled') !== 'false';
  if (!isEnabled) {
    showTemporaryMessage('Registration is currently disabled. Please contact administrator.', 'warning');
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 600px;">
      <div class="modal-title">Member Registration</div>
      <div style="color: var(--muted); margin-bottom: 20px; text-align: center;">
        Fill out the form below to register as a member
      </div>

      <form id="memberRegistrationForm">
        <div id="registrationFormFields" style="max-height: 400px; overflow-y: auto; padding-right: 10px;">
        </div>

        <div class="modal-buttons" style="margin-top: 25px;">
          <button type="button" class="modal-btn cancel" onclick="closeRegistrationForm()">Cancel</button>
          <button type="submit" class="modal-btn yes">Submit Registration</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  const fieldsContainer = document.getElementById('registrationFormFields');
  fieldsContainer.innerHTML = '';

  dataFramework.forEach(field => {
    fieldsContainer.innerHTML += `
      <div class="form-group" style="margin-bottom: 15px;">
        <label class="form-label" style="display: block; margin-bottom: 5px; color: var(--text);">
          ${field.name} ${field.required === 'yes' ? '<span style="color: var(--warning);">*</span>' : ''}
        </label>
        ${getFieldInputHTML(field).replace('form-input', 'form-input registration-field').replace('placeholder', `placeholder="Enter your ${field.name.toLowerCase()}" data-field="${field.name.toLowerCase().replace(/\s+/g, '_')}"`)}
      </div>
    `;
  });

  document.getElementById('memberRegistrationForm').addEventListener('submit', function(e) {
    e.preventDefault();
    submitMemberRegistration();
  });
}

function closeRegistrationForm() {
  const modal = document.querySelector('.modal-overlay.active');
  if (modal) modal.remove();
}

async function submitMemberRegistration() {
  // Check if registration is enabled
  const isEnabled = localStorage.getItem('ring0_registration_enabled') !== 'false';
  if (!isEnabled) {
    showTemporaryMessage('Registration is currently disabled. Please try again later.', 'warning');
    closeRegistrationForm();
    return;
  }

  const newMember = {
    id: Date.now(),
    status: 'active',
    group: '',
    registeredAt: new Date().toISOString()
  };

  const inputs = document.querySelectorAll('.registration-field');
  let isValid = true;

  inputs.forEach(input => {
    const fieldName = input.getAttribute('data-field');
    const fieldValue = input.value.trim();
    const isRequired = input.hasAttribute('required');

    if (isRequired && !fieldValue) {
      input.style.borderColor = 'var(--warning)';
      isValid = false;
    } else {
      input.style.borderColor = '';

      if (fieldName.includes('name')) newMember.name = fieldValue;
      else if (fieldName.includes('reg')) newMember.regNo = fieldValue;
      else if (fieldName.includes('phone')) newMember.phone = fieldValue;
      else if (fieldName.includes('email')) newMember.email = fieldValue;
      else newMember[fieldName] = fieldValue;
    }
  });

  if (!isValid) {
    showTemporaryMessage('Please fill in all required fields', 'warning');
    return;
  }

  const duplicate = userData.find(user =>
    (newMember.regNo && user.regNo === newMember.regNo) ||
    (newMember.email && user.email === newMember.email)
  );

  if (duplicate) {
    showTemporaryMessage('A user with this registration number or email already exists!', 'warning');
    return;
  }

  // Save to Supabase
  const supabaseSuccess = await saveUserToSupabase(newMember);
  
  if (supabaseSuccess) {
    showTemporaryMessage('Thank you for registering! Your information has been saved.', 'success');
  } else {
    // Fallback: save locally
    userData.push(newMember);
    saveUserData();
    showTemporaryMessage('Thank you for registering! (Saved locally)', 'warning');
  }

  closeRegistrationForm();

  if (document.getElementById('adminDashboard').classList.contains('active')) {
    populateUserTable();
  }
}

function copyRegistrationLink() {
  const linkInput = document.getElementById('registrationLink');
  if (!linkInput) return;
  
  linkInput.select();
  linkInput.setSelectionRange(0, 99999);

  navigator.clipboard.writeText(linkInput.value)
    .then(() => {
      showTemporaryMessage('Link copied to clipboard!', 'success');
    })
    .catch(err => {
      console.error('Failed to copy: ', err);
    });
}

// ================= REAL-TIME REGISTRATION SETTINGS SYNC =================
async function setupRegistrationSettingsRealtime() {
  try {
    // First, load current settings from database
    await syncRegistrationSettingsFromSupabase();
    
    // Subscribe to real-time changes in registration_settings table
    registrationSettingsSubscription = supabaseClient
      .channel('registration-settings-changes')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'registration_settings'
        },
        async (payload) => {
          console.log('Real-time update received:', payload);
          
          // Handle the change based on event type
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            // Update localStorage with new settings
            localStorage.setItem('ring0_registration_enabled', payload.new.enabled);
            localStorage.setItem('ring0_registration_mode', payload.new.mode || 'default');
            
            if (payload.new.registration_link) {
              localStorage.setItem('ring0_registration_link', payload.new.registration_link);
            } else {
              localStorage.removeItem('ring0_registration_link');
            }
            
            // Update UI immediately
            updateRegistrationSwitch();
            updateMainMenuInstantly();
            updateRegistrationSettingsUI();
            
            // Show notification
            showTemporaryMessage('Registration settings updated in real-time!', 'info');
            
          } else if (payload.eventType === 'DELETE') {
            // Reset to defaults if settings are deleted
            resetToDefaultRegistrationSettings();
          }
        }
      )
      .subscribe((status) => {
        console.log('Realtime subscription status:', status);
        
        if (status === 'SUBSCRIBED') {
          console.log('✅ Real-time registration settings sync enabled');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('Realtime channel error, falling back to polling');
          startRegistrationSettingsPolling();
        }
      });
      
  } catch (error) {
    console.error('Failed to setup real-time sync:', error);
    // Fallback to polling
    startRegistrationSettingsPolling();
  }
}

// Fallback polling mechanism (if Realtime fails)
function startRegistrationSettingsPolling() {
  console.log('Starting polling for registration settings...');
  
  // Poll every 3 seconds
  setInterval(async () => {
    await syncRegistrationSettingsFromSupabase();
  }, 3000);
}

async function syncRegistrationSettingsFromSupabase() {
  try {
    const { data, error } = await supabaseClient
      .from('registration_settings')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1);
    
    if (error) throw error;
    
    if (data && data.length > 0) {
      const settings = data[0];
      
      // Check if settings have actually changed
      const currentEnabled = localStorage.getItem('ring0_registration_enabled') !== 'false';
      const currentMode = localStorage.getItem('ring0_registration_mode') || 'default';
      const currentLink = localStorage.getItem('ring0_registration_link');
      
      const hasChanged = 
        currentEnabled !== settings.enabled ||
        currentMode !== (settings.mode || 'default') ||
        currentLink !== (settings.registration_link || null);
      
      if (hasChanged) {
        // Update localStorage
        localStorage.setItem('ring0_registration_enabled', settings.enabled);
        localStorage.setItem('ring0_registration_mode', settings.mode || 'default');
        
        if (settings.registration_link) {
          localStorage.setItem('ring0_registration_link', settings.registration_link);
        } else {
          localStorage.removeItem('ring0_registration_link');
        }
        
        // Update UI
        updateRegistrationSwitch();
        updateMainMenuInstantly();
        updateRegistrationSettingsUI();
        
        console.log('Registration settings synced from Supabase');
      }
    }
  } catch (error) {
    console.error('Error syncing registration settings:', error);
  }
}

function resetToDefaultRegistrationSettings() {
  localStorage.setItem('ring0_registration_enabled', 'true');
  localStorage.setItem('ring0_registration_mode', 'default');
  localStorage.removeItem('ring0_registration_link');
  
  updateRegistrationSwitch();
  updateMainMenuInstantly();
  updateRegistrationSettingsUI();
  
  showTemporaryMessage('Registration settings reset to defaults', 'info');
}

// ================= INSTANT REGISTRATION TOGGLE =================
// NEW: One-click function to toggle registration instantly
function toggleRegistrationOneClick() {
  const currentState = localStorage.getItem('ring0_registration_enabled') !== 'false';
  const newState = !currentState;
  
  // Update localStorage instantly
  localStorage.setItem('ring0_registration_enabled', newState);
  
  // Update switch if exists
  const registrationSwitch = document.getElementById('registrationSwitch');
  if (registrationSwitch) {
    registrationSwitch.checked = newState;
  }
  
  // Update UI instantly
  updateMainMenuInstantly();
  
  // Show immediate feedback
  showTemporaryMessage(`Member sign up ${newState ? 'ENABLED' : 'DISABLED'} instantly!`, newState ? 'success' : 'warning');
  
  // Sync to Supabase in background
  saveRegistrationSettingsToSupabase();
}

// ================= ERROR HANDLING UTILITIES =================
function handleSupabaseError(error, context = 'operation') {
  console.error(`❌ Supabase error in ${context}:`, error);
  
  if (error.code === '42501') {
    showTemporaryMessage('Permission denied. Please check your Supabase RLS policies.', 'warning');
  } else if (error.code === '42P01') {
    showTemporaryMessage('Database table not found. Please run the SQL schema.', 'warning');
  } else if (error.message.includes('Failed to fetch')) {
    showTemporaryMessage('Network error. Please check your internet connection.', 'warning');
  } else {
    showTemporaryMessage(`Error: ${error.message || 'Unknown error occurred'}`, 'warning');
  }
  
  return false;
}

// ================= INITIALIZATION =================
function initializeUserManagementSystemOnLoad() {
  // Wait for Supabase to be ready
  setTimeout(async () => {
    if (supabaseClient) {
      console.log('✅ Supabase ready, initializing with Supabase integration');
      
      try {
        // Initialize real-time sync FIRST
        await setupRegistrationSettingsRealtime();
        
        // Then initialize the rest of the system
        if (typeof initUserManagementSystem === 'function') {
          initUserManagementSystem();
        }
        
        // Also sync immediately on load
        await syncRegistrationSettingsFromSupabase();
        
        // Initialize UI based on localStorage
        updateMainMenuInstantly();
        
      } catch (error) {
        console.error('Failed to initialize real-time sync:', error);
        // Fallback to local data
        if (typeof loadDataFramework === 'function') loadDataFramework();
        if (typeof loadUserData === 'function') loadUserData();
        if (typeof loadGroups === 'function') loadGroups();
        
        // Still update UI from localStorage
        updateMainMenuInstantly();
      }
      
    } else if (typeof initializeUserManagementWithSupabase === 'function') {
      console.log('✅ Supabase integration function available, initializing');
      initializeUserManagementWithSupabase();
      
      // Also setup real-time sync
      setupRegistrationSettingsRealtime();
      
      // Update UI
      updateMainMenuInstantly();
      
    } else {
      console.warn('⚠️ Supabase not ready, using local data only');
      if (typeof loadDataFramework === 'function') loadDataFramework();
      if (typeof loadUserData === 'function') loadUserData();
      if (typeof loadGroups === 'function') loadGroups();
      
      // Update UI from localStorage
      updateMainMenuInstantly();
    }
  }, 1000);
}

// Cleanup real-time subscription when page unloads
window.addEventListener('beforeunload', () => {
  if (registrationSettingsSubscription) {
    supabaseClient.removeChannel(registrationSettingsSubscription);
    console.log('Real-time subscription cleaned up');
  }
});

// Add this to your main initialization
document.addEventListener('DOMContentLoaded', function() {
  initializeUserManagementSystemOnLoad();
  
  // Add event listener for registration switch
  setTimeout(() => {
    const registrationSwitch = document.getElementById('registrationSwitch');
    if (registrationSwitch) {
      registrationSwitch.addEventListener('change', function() {
        // Update localStorage and UI immediately
        localStorage.setItem('ring0_registration_enabled', this.checked);
        updateMainMenuInstantly();
        showTemporaryMessage(`Member sign up ${this.checked ? 'enabled' : 'disabled'}!`, 'success');
        
        // Sync to Supabase in background
        saveRegistrationSettingsToSupabase();
      });
    }
  }, 1500);
});

// NEW: Quick toggle button for testing (optional - can be added to admin panel)
function addQuickToggleButton() {
  const adminPanel = document.querySelector('.admin-panel, #adminDashboard, #settingsTab');
  if (adminPanel) {
    const quickToggle = document.createElement('button');
    quickToggle.className = 'quick-toggle-btn';
    quickToggle.innerHTML = '⚡ Quick Toggle Registration';
    quickToggle.style.cssText = `
      background: var(--accent);
      color: white;
      border: none;
      padding: 8px 15px;
      border-radius: 6px;
      cursor: pointer;
      margin: 10px 0;
      font-weight: bold;
      display: flex;
      align-items: center;
      gap: 8px;
    `;
    
    quickToggle.onclick = toggleRegistrationOneClick;
    
    adminPanel.insertBefore(quickToggle, adminPanel.firstChild);
  }
}



//***************************END OF FULL MANAGEMENT SYSTEM CODE***************************//













































// ======================================================================
// === END PASTE AREA ===
// ======================================================================

// ================= STARTUP =================
document.addEventListener('DOMContentLoaded', () => {
    // Wait a bit for other scripts to load
    setTimeout(() => {
        if (typeof window.supabase === 'undefined') {
            console.error('❌ Supabase library not detected');
            showTemporaryMessage('Error: Database library not loaded', 'error');
            return;
        }
        
        initializeManagementSystem().catch(error => {
            console.error('Failed to initialize:', error);
        });
    }, 1000);
});

console.log('✅ Enhanced management.js loaded with robust error handling');