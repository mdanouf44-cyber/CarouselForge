// ==========================================================================
// Carousel Forge Web Dashboard JavaScript
// ==========================================================================

let activeRunId = null;
let isCurationActive = false;

// Format local absolute file path to web-served URL
function getImageUrl(filePath) {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  const distIndex = normalized.indexOf('/dist/');
  if (distIndex !== -1) {
    return normalized.substring(distIndex); // Returns e.g. "/dist/runs/run-xxx/slide-1.png"
  }
  return filePath;
}

// Log message to the console panel
function logToTerminal(message, type = 'SYSTEM') {
  const terminal = document.getElementById('terminal-logs');
  const timestamp = new Date().toLocaleTimeString();
  let colorClass = 'text-info';
  
  if (type === 'SUCCESS') colorClass = 'text-success';
  if (type === 'ERROR') colorClass = 'text-danger';
  if (type === 'WARN') colorClass = 'text-warning';
  
  terminal.innerHTML += `<br><span class="text-muted">[${timestamp}]</span> <span class="${colorClass}">[${type}]</span> ${message}`;
  terminal.scrollTop = terminal.scrollHeight; // Auto-scroll to bottom
}

// Update the Live Clock (IST)
function updateClock() {
  const liveClockEl = document.getElementById('live-clock');
  const now = new Date();
  
  // Format current UTC time into Asia/Kolkata timezone representation
  const options = { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  const formatter = new Intl.DateTimeFormat('en-US', options);
  liveClockEl.textContent = formatter.format(now);
}

// Fetch System Status
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    
    // Update live clock initial reference (just in case)
    document.getElementById('bot-status-badge').textContent = data.botConfigured ? 'Bot Active' : 'Bot Offline';
    document.getElementById('bot-status-badge').className = data.botConfigured ? 'status-badge' : 'status-badge badge-status-rejected';
    
    // In case there is an active run running or pending
    if (data.activeRun) {
      logToTerminal(`Active run detected in cache: ${data.activeRun.runId} (Slot: ${data.activeRun.timeSlot.toUpperCase()})`, 'SYSTEM');
    }
  } catch (err) {
    console.error('Failed to fetch status:', err);
  }
}

// Fetch history records & update stats / table
async function fetchHistory(isAutoRefresh = false) {
  try {
    const res = await fetch('/api/history');
    const data = await res.json();
    
    // Update KPI metrics
    document.getElementById('stat-total').textContent = data.stats.total;
    document.getElementById('stat-approved').textContent = data.stats.approved;
    document.getElementById('stat-rejected').textContent = data.stats.rejected;
    document.getElementById('stat-rate').textContent = `${data.stats.approvalRate}%`;
    
    // Check if there is an active pending run
    const pendingRun = data.history.find(h => h.status === 'pending');
    if (pendingRun) {
      renderCurationWorkspace(pendingRun);
    } else {
      clearCurationWorkspace();
    }
    
    // Render History Archive Table
    renderHistoryTable(data.history);
    
    if (!isAutoRefresh) {
      logToTerminal(`Loaded ${data.history.length} historical records.`, 'SYSTEM');
    }
  } catch (err) {
    console.error('Failed to load history:', err);
    logToTerminal(`Failed to connect to history endpoint.`, 'ERROR');
  }
}

// Render Curation Workspace with the active pending run
function renderCurationWorkspace(run) {
  activeRunId = run.id;
  isCurationActive = true;
  
  document.getElementById('curation-empty').classList.add('hidden');
  document.getElementById('curation-content').classList.remove('hidden');
  
  document.getElementById('story-slot').textContent = `${run.timeSlot.toUpperCase()} SLOT`;
  document.getElementById('story-run-id').textContent = run.id;
  document.getElementById('story-title').textContent = run.angle.title;
  
  // Populate generated LinkedIn post copy
  document.getElementById('post-caption-textarea').value = run.linkedin_post || '';
  
  // Sources URL links
  const sourcesContainer = document.getElementById('story-sources');
  sourcesContainer.innerHTML = '';
  if (run.angle.url) {
    sourcesContainer.innerHTML = `<a href="${run.angle.url}" target="_blank" class="source-link">🔗 View original news article</a>`;
  }
  if (run.angle.sources && run.angle.sources.length > 0) {
    // Add additional links if present
    run.angle.sources.forEach(src => {
      if (src !== 'Hacker News' && !src.startsWith('r/')) {
        // Skip generic source tags, render actual URLs
      }
    });
  }

  // Render slides thumbnails in horizontal deck
  const deck = document.getElementById('slides-deck');
  deck.innerHTML = '';
  run.imagePaths.forEach((path, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'slide-thumbnail';
    thumb.innerHTML = `
      <span class="slide-thumb-label">${idx + 1}/5</span>
      <img src="${getImageUrl(path)}" alt="Slide ${idx + 1}">
    `;
    // Click thumbnail to expand preview
    thumb.addEventListener('click', () => openPreviewModal(run.angle.title, run.imagePaths));
    deck.appendChild(thumb);
  });
}

// Clear Curation Workspace when no runs are pending
function clearCurationWorkspace() {
  activeRunId = null;
  isCurationActive = false;
  document.getElementById('curation-content').classList.add('hidden');
  document.getElementById('curation-empty').classList.remove('hidden');
  document.getElementById('post-caption-textarea').value = '';
}

// Render the historical archive table logs
function renderHistoryTable(history) {
  const tbody = document.getElementById('history-tbody');
  tbody.innerHTML = '';
  
  const searchVal = document.getElementById('search-filter').value.toLowerCase();
  
  const filtered = history.filter(h => {
    const titleMatch = h.angle.title.toLowerCase().includes(searchVal);
    const slotMatch = h.timeSlot.toLowerCase().includes(searchVal);
    const statusMatch = h.status.toLowerCase().includes(searchVal);
    return titleMatch || slotMatch || statusMatch;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center">No matching records found.</td></tr>`;
    return;
  }

  filtered.forEach(h => {
    const tr = document.createElement('tr');
    
    const dateFormatted = new Date(h.timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const statusBadge = h.status === 'approved' 
      ? `<span class="badge-status badge-status-approved">APPROVED</span>` 
      : (h.status === 'rejected' 
        ? `<span class="badge-status badge-status-rejected">REJECTED</span>` 
        : `<span class="badge-status badge-status-pending">PENDING</span>`);

    tr.innerHTML = `
      <td><span class="slot-indicator">${h.timeSlot.toUpperCase()}</span></td>
      <td>
        <div class="history-topic-title" title="${h.angle.title}">${h.angle.title}</div>
      </td>
      <td><span class="history-date">${dateFormatted}</span></td>
      <td>${statusBadge}</td>
    `;
    
    // Row click event opens the modal preview
    tr.addEventListener('click', () => {
      openPreviewModal(h.angle.title, h.imagePaths);
    });

    tbody.appendChild(tr);
  });
}

// Trigger Pipeline Manually
async function triggerPipeline(slot) {
  logToTerminal(`Triggering manual pipeline execution for ${slot.toUpperCase()} slot...`, 'SYSTEM');
  try {
    const res = await fetch('/api/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot })
    });
    const data = await res.json();
    
    if (data.success) {
      logToTerminal(`Pipeline trigger response: ${data.message}`, 'SUCCESS');
      logToTerminal(`Waiting for scraping & rendering to complete (usually < 90 seconds)...`, 'WARN');
      
      // Auto reload after 20 seconds initially, then continuous polling will pick it up
      setTimeout(() => fetchHistory(true), 25000);
    } else {
      logToTerminal(`Failed to trigger pipeline: ${data.error}`, 'ERROR');
    }
  } catch (err) {
    console.error('Trigger failed:', err);
    logToTerminal(`Trigger request failed: ${err.message}`, 'ERROR');
  }
}

// Execute curation action panel (Approve / Reject / Regenerate)
async function submitCurationAction(action) {
  if (!activeRunId) {
    logToTerminal('No active run ID to perform actions on.', 'ERROR');
    return;
  }
  
  // Visual lock loading state
  const btnApprove = document.getElementById('btn-approve');
  const btnRegen = document.getElementById('btn-regen');
  const btnReject = document.getElementById('btn-reject');
  
  btnApprove.disabled = true;
  btnRegen.disabled = true;
  btnReject.disabled = true;

  logToTerminal(`Submitting curation action "${action.toUpperCase()}" for run ${activeRunId}...`, 'SYSTEM');

  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, runId: activeRunId })
    });
    const data = await res.json();

    if (data.success) {
      logToTerminal(`Curation action "${action.toUpperCase()}" successfully processed!`, 'SUCCESS');
      if (action === 'regen') {
        logToTerminal(`Slide generation for Angle #${data.result.nextIndex + 1} starting...`, 'WARN');
      }
      // Reload history and stats
      await fetchHistory(true);
    } else {
      logToTerminal(`Action execution failed: ${data.error}`, 'ERROR');
    }
  } catch (err) {
    console.error('Action failed:', err);
    logToTerminal(`Action request failed: ${err.message}`, 'ERROR');
  } finally {
    // Unlock buttons
    btnApprove.disabled = false;
    btnRegen.disabled = false;
    btnReject.disabled = false;
  }
}

// ==========================================
// PREVIEW MODAL DIALOG CONTROLS
// ==========================================

function openPreviewModal(title, imagePaths) {
  const modal = document.getElementById('preview-modal');
  const modalTitle = document.getElementById('modal-title');
  const container = document.getElementById('modal-slides-container');
  const pathLabel = document.getElementById('modal-folder-path');
  
  modalTitle.textContent = title;
  container.innerHTML = '';

  if (!imagePaths || imagePaths.length === 0) {
    container.innerHTML = `<div class="text-center text-muted" style="grid-column: span 3; padding: 40px;">No slide images available for this record (possibly cleaned up on rejection).</div>`;
    pathLabel.textContent = '';
  } else {
    // Show 6 slides
    imagePaths.forEach((path, idx) => {
      const card = document.createElement('div');
      card.className = 'modal-slide-card';
      card.innerHTML = `<img src="${getImageUrl(path)}" alt="Slide ${idx + 1}">`;
      container.appendChild(card);
    });
    
    // Get output folder base name representation
    const samplePath = imagePaths[0].replace(/\\/g, '/');
    const folderIdx = samplePath.lastIndexOf('/');
    if (folderIdx !== -1) {
      pathLabel.textContent = `Folder location: ${samplePath.substring(0, folderIdx)}`;
    } else {
      pathLabel.textContent = `Location: ${samplePath}`;
    }
  }
  
  modal.classList.remove('hidden');
}

function closePreviewModal() {
  document.getElementById('preview-modal').classList.add('hidden');
}

// ==========================================
// INITIALIZATION & EVENT LISTENERS
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  // Live Clock Interval
  setInterval(updateClock, 1000);
  updateClock();
  
  // Initial API Data Fetches
  fetchStatus();
  fetchHistory();
  
  // Setup Polling Loop every 12 seconds for real-time curation sync
  setInterval(() => fetchHistory(true), 12000);

  // Manual Trigger Listeners
  document.getElementById('btn-trigger-am').addEventListener('click', () => triggerPipeline('am'));
  document.getElementById('btn-trigger-pm').addEventListener('click', () => triggerPipeline('pm'));

  // Curation Action Listeners
  document.getElementById('btn-approve').addEventListener('click', () => submitCurationAction('approve'));
  document.getElementById('btn-regen').addEventListener('click', () => submitCurationAction('regen'));
  document.getElementById('btn-reject').addEventListener('click', () => submitCurationAction('reject'));

  // Horizontal Scroll Controls
  const deck = document.getElementById('slides-deck');
  document.getElementById('btn-scroll-left').addEventListener('click', () => {
    deck.scrollBy({ left: -400, behavior: 'smooth' });
  });
  document.getElementById('btn-scroll-right').addEventListener('click', () => {
    deck.scrollBy({ left: 400, behavior: 'smooth' });
  });

  // Modal Close Listeners
  document.getElementById('btn-close-modal').addEventListener('click', closePreviewModal);
  document.getElementById('preview-modal').addEventListener('click', (e) => {
    if (e.target.id === 'preview-modal') closePreviewModal();
  });

  // Search Filter Handler
  document.getElementById('search-filter').addEventListener('input', () => {
    fetchHistory(true); // Redraw table based on input
  });

  // LinkedIn Post Caption Copy Button
  const btnCopy = document.getElementById('btn-copy-post');
  btnCopy.addEventListener('click', () => {
    const textarea = document.getElementById('post-caption-textarea');
    if (!textarea.value) return;
    
    navigator.clipboard.writeText(textarea.value).then(() => {
      const originalText = btnCopy.textContent;
      btnCopy.textContent = 'Copied! ✓';
      btnCopy.style.background = 'var(--success-glow)';
      btnCopy.style.color = 'var(--success)';
      btnCopy.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      
      setTimeout(() => {
        btnCopy.textContent = originalText;
        btnCopy.style.background = '';
        btnCopy.style.color = '';
        btnCopy.style.borderColor = '';
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy text:', err);
    });
  });
});
