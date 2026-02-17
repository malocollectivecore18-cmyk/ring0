// countdown_cards.js - extracted standalone implementation (namespaced)
(function(){
// Module-scoped variables to avoid colliding with page globals
let _container = null;
let _cards = [];

// Source resolver for countdown cards. Prefer runtime data (window.allPosts),
// then localStorage ('ring0_admin_cards'), then a small fallback sample.
function resolveSourceCards() {
    // 1) Prefer global allPosts populated by the main app
    if (Array.isArray(window.allPosts) && window.allPosts.length > 0) {
        return window.allPosts.map(c => ({
            id: c.id,
            title: c.title || c.name || 'Untitled',
            description: c.description || '',
            fileUrl: c.fileUrl || c.file_url || '#',
            start: c.start || c.start_time || c.start_time_iso || c.start_time_str || c.start_time,
            end: c.end || c.end_time || c.end_time_iso || c.end_time_str || c.end_time,
            status: c.status || 'active'
        }));
    }

    // 2) Try cached localStorage used by the main app
    try {
        const saved = localStorage.getItem('ring0_admin_cards');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch (e) {
        // ignore parse errors
    }

    // 3) Fallback sample (minimal)
    return [
        { id: 'sample-1', title: 'Sample Countdown', description: 'Fallback sample', fileUrl: '#', start: new Date(Date.now() + 86400000).toISOString(), end: new Date(Date.now() + 10*86400000).toISOString(), status: 'active' }
    ];
}

// Build card element
function buildCardElement(p) {
    const c = document.createElement('div');
    c.className = 'card';

    const startDate = new Date(p.start);
    const endDate = new Date(p.end);

    const formatTime24 = (date) => {
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    };

    const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    c.innerHTML = `
        <div class="spinner">
            <div class="ring"></div>
            <div class="ring"></div>
            <div class="ring"></div>
        </div>
        <h3>${p.title}</h3>
        <div class="meta" data-filename="${p.description}" data-url="${p.fileUrl || '#'}">${p.description}</div>

        <div class="countdown-container">
            <div class="countdown">
                <div class="pill"><b class="d">0</b>Days</div>
                <div class="pill"><b class="h">0</b>Hrs</div>
                <div class="pill"><b class="m">0</b>Min</div>
                <span class="left-label">left</span>
            </div>
        </div>

        <div class="progress"><div class="bar"></div></div>

        <div class="card-footer">
            <div class="badge-container">
                <span class="badge started">Started: ${formatDate(startDate)} ${formatTime24(startDate)}</span>
                <span class="badge ends">Ends: ${formatDate(endDate)} ${formatTime24(endDate)}</span>
            </div>
            <span class="status">Active</span>
        </div>
    `;

    const meta = c.querySelector('.meta');
    meta.addEventListener('click', function() {
        const fileUrl = this.getAttribute('data-url');
        if (fileUrl && fileUrl !== '#') {
            window.open(fileUrl, '_blank');
        } else {
            // Handle file download or modal here
            console.log('Clicked:', this.textContent);
        }
    });

    // append only if container exists
    if (_container) _container.appendChild(c);
    return c;
}

// Update countdown timers (module-scoped)
function updateCountdownModule() {
    if (!_container) return;
    // Clear the cards container
    _container.innerHTML = '';

    // Resolve source cards each update so new data is picked up dynamically
    const source = resolveSourceCards();
    // Build all cards
    _cards = source.map(p => ({ post: p, el: buildCardElement(p) }));

    const now = new Date();
    _cards.forEach(({ post, el }) => {
        const start = new Date(post.start);
        const end = new Date(post.end);

        const maximumPeriodMs = end - start;
        const remainingMs = end - now;

        let progressPercent;
        if (remainingMs <= 0) {
            progressPercent = 100;
        } else if (now < start) {
            progressPercent = 0;
        } else {
            const maximumPeriodSeconds = maximumPeriodMs / 1000;
            const remainingSeconds = Math.max(0, remainingMs / 1000);
            progressPercent = (remainingSeconds / maximumPeriodSeconds) * 100;
        }

        progressPercent = Math.min(100, Math.max(0, progressPercent));

        const bar = el.querySelector('.bar');
        const status = el.querySelector('.status');
        const spinner = el.querySelector('.spinner');
        const daysLeft = Math.floor(remainingMs / (1000 * 60 * 60 * 24));

        el.querySelector('.d').textContent = Math.max(0, daysLeft);
        el.querySelector('.h').textContent = Math.max(0, Math.floor((remainingMs / (1000 * 60 * 60)) % 24));
        el.querySelector('.m').textContent = Math.max(0, Math.floor((remainingMs / (1000 * 60)) % 60));

        if (bar) bar.style.width = progressPercent + '%';
        if (bar) bar.setAttribute('data-percent', Math.round(progressPercent) + '%');

        if (remainingMs <= 0) {
            status.textContent = 'Completed';
            bar.style.width = '0%';
            bar.setAttribute('data-percent', '0%');
            spinner.style.display = 'none';
            el.querySelectorAll('.pill b').forEach(b => b.textContent = 0);
            bar.classList.remove('active', 'critical');
            return;
        }

        if (now < start) {
            status.textContent = 'Not Started';
            bar.style.width = '100%';
            bar.setAttribute('data-percent', '100%');
            bar.classList.remove('active', 'critical');
            return;
        }

        bar.classList.add('active');

        if (daysLeft <= 2) {
            bar.classList.add('critical');
            status.textContent = 'Critical';
            status.style.color = '#ff6b6b';
        } else {
            bar.classList.remove('critical');
            status.textContent = 'Active';
            status.style.color = '';
        }
    });
}

// Initialize when page loads (exposed as `initCountdownModule`)
function initCountdownModule() {
    _container = document.getElementById('cards');
    if (!_container) {
        console.warn('countdown module: container #cards not found; skipping init');
        return;
    }
    updateCountdownModule();
    setInterval(updateCountdownModule, 1000);
}

// Expose init for page to call without polluting globals
window.initCountdownModule = initCountdownModule;
// Expose a refresh function so external code can request an update without touching DOM
window.refreshCountdownModule = function(){
    try { updateCountdownModule(); } catch(e) { /* ignore */ }
};

// NOTE: Auto-init removed so the module does NOT render on the public welcome page.
// Call `initCountdownModule()` explicitly from admin views where you want the live
// countdown UI to appear.

})();
