// ==========================================================================
// Carousel Forge Web Dashboard JavaScript
// ==========================================================================

let activeRunId = null;
let isCurationActive = false;
let activeRunDetails = { title: '', imagePaths: [] };
let currentModalRun = { title: '', imagePaths: [] };
let activeModalRunObj = null; // Reference to loaded run for interactive archives

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
    
    // Check if there is an active run in history (latest one or currently active)
    let activeWorkspaceRun = null;
    if (activeRunId) {
      activeWorkspaceRun = data.history.find(h => h.id === activeRunId);
    }
    if (!activeWorkspaceRun && data.history.length > 0) {
      activeWorkspaceRun = data.history[0];
    }

    if (activeWorkspaceRun) {
      renderCurationWorkspace(activeWorkspaceRun);
    } else {
      clearCurationWorkspace();
    }
    
    // Render History Archive Table
    renderHistoryTable(data.history);
    
    // Refresh scheduler settings to show updated tasks
    fetchSchedulerSettings();
    
    if (!isAutoRefresh) {
      logToTerminal(`Loaded ${data.history.length} historical records.`, 'SYSTEM');
    }
  } catch (err) {
    console.error('Failed to load history:', err);
    logToTerminal(`Failed to connect to history endpoint.`, 'ERROR');
  }
}

// Populate Slide Text Editor with editable fields
function populateSlideTextEditor(slides) {
  const container = document.getElementById('slide-text-fields-container');
  container.innerHTML = '';
  
  if (!slides || slides.length === 0) {
    container.innerHTML = '<p class="text-muted" style="font-size: 13px;">No slide content available to edit.</p>';
    return;
  }
  
  slides.forEach((slide, idx) => {
    const slideDiv = document.createElement('div');
    slideDiv.className = 'slide-editor-card';
    slideDiv.style = 'background: rgba(0,0,0,0.15); border: 1px solid rgba(255,255,255,0.03); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; margin-bottom: 5px;';
    
    const label = document.createElement('div');
    label.style = 'font-size: 11px; font-weight: 700; color: var(--indigo-accent); text-transform: uppercase; letter-spacing: 0.5px;';
    label.textContent = `Slide ${idx + 1} (${slide.type.toUpperCase()})`;
    slideDiv.appendChild(label);
    
    if (slide.type === 'intro' || slide.type === 'outro') {
      // Headline
      const headlineGroup = document.createElement('div');
      headlineGroup.style = 'display: flex; flex-direction: column; gap: 4px;';
      headlineGroup.innerHTML = `
        <label style="font-size: 10px; color: var(--text-secondary);">Headline</label>
        <input type="text" class="slide-input-headline" data-idx="${idx}" value="${slide.headline || ''}" style="width: 100%; background: rgba(0,0,0,0.2); border: 1px solid var(--border-panel); border-radius: 6px; padding: 8px; color: var(--text-primary); font-size: 13px;">
      `;
      slideDiv.appendChild(headlineGroup);
      
      // Subheadline
      const subheadlineGroup = document.createElement('div');
      subheadlineGroup.style = 'display: flex; flex-direction: column; gap: 4px;';
      subheadlineGroup.innerHTML = `
        <label style="font-size: 10px; color: var(--text-secondary);">Subheadline</label>
        <input type="text" class="slide-input-subheadline" data-idx="${idx}" value="${slide.subheadline || ''}" style="width: 100%; background: rgba(0,0,0,0.2); border: 1px solid var(--border-panel); border-radius: 6px; padding: 8px; color: var(--text-primary); font-size: 13px;">
      `;
      slideDiv.appendChild(subheadlineGroup);
    } else {
      // Title
      const titleGroup = document.createElement('div');
      titleGroup.style = 'display: flex; flex-direction: column; gap: 4px;';
      titleGroup.innerHTML = `
        <label style="font-size: 10px; color: var(--text-secondary);">Title</label>
        <input type="text" class="slide-input-title" data-idx="${idx}" value="${slide.title || ''}" style="width: 100%; background: rgba(0,0,0,0.2); border: 1px solid var(--border-panel); border-radius: 6px; padding: 8px; color: var(--text-primary); font-size: 13px;">
      `;
      slideDiv.appendChild(titleGroup);
      
      // Content
      const contentGroup = document.createElement('div');
      contentGroup.style = 'display: flex; flex-direction: column; gap: 4px;';
      contentGroup.innerHTML = `
        <label style="font-size: 10px; color: var(--text-secondary);">Content</label>
        <textarea class="slide-input-content" data-idx="${idx}" style="width: 100%; height: 60px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-panel); border-radius: 6px; padding: 8px; color: var(--text-primary); font-size: 13px; resize: none; font-family: inherit; line-height: 1.4;">${slide.content || ''}</textarea>
      `;
      slideDiv.appendChild(contentGroup);
    }
    
    container.appendChild(slideDiv);
  });
  
  // Bind input typing event handlers for instantaneous preview updates
  bindLiveTextListeners();
}

// Render Curation Workspace with the active pending run
function renderCurationWorkspace(run) {
  activeRunId = run.id;
  isCurationActive = true;
  
  activeRunDetails = run; // Save the full run details object
  
  document.getElementById('curation-empty').classList.add('hidden');
  document.getElementById('curation-content').classList.remove('hidden');
  
  document.getElementById('story-slot').textContent = `${run.timeSlot.toUpperCase()} SLOT`;
  document.getElementById('story-run-id').textContent = run.id;
  document.getElementById('story-title').textContent = run.angle.title;
  
  // Populate generated LinkedIn post copy
  document.getElementById('post-caption-textarea').value = run.linkedin_post || '';
  
  // Populate Slide Text Editor
  populateSlideTextEditor(run.slides);
  
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

  // Render live HTML preview slide simulator
  renderLivePreviewHtml(run);
}

// Clear Curation Workspace when no runs are pending
function clearCurationWorkspace() {
  activeRunId = null;
  isCurationActive = false;
  activeRunDetails = { title: '', imagePaths: [] };
  document.getElementById('curation-content').classList.add('hidden');
  document.getElementById('curation-empty').classList.remove('hidden');
  document.getElementById('post-caption-textarea').value = '';
  document.getElementById('slide-text-fields-container').innerHTML = '';
}

async function deleteCarousel(id) {
  logToTerminal(`Deleting carousel ${id}...`, 'SYSTEM');
  try {
    const res = await fetch(`/api/carousel/${id}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      logToTerminal(`Successfully deleted carousel ${id}`, 'SUCCESS');
      if (activeRunId === id) {
        clearCurationWorkspace();
      }
      fetchHistory(true);
    } else {
      logToTerminal(`Failed to delete carousel: ${data.error}`, 'ERROR');
      alert(`Delete failed: ${data.error}`);
    }
  } catch (err) {
    console.error('Delete failed:', err);
    logToTerminal(`Delete request failed: ${err.message}`, 'ERROR');
    alert(`Delete request failed: ${err.message}`);
  }
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
    tbody.innerHTML = `<tr><td colspan="5" class="text-center">No matching records found.</td></tr>`;
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
      <td data-label="Slot"><span class="slot-indicator">${h.timeSlot.toUpperCase()}</span></td>
      <td data-label="Topic">
        <div class="history-topic-title" title="${h.angle.title}">${h.angle.title}</div>
      </td>
      <td data-label="Created"><span class="history-date">${dateFormatted}</span></td>
      <td data-label="Status">${statusBadge}</td>
      <td data-label="Actions" class="action-cell">
        <button class="btn-delete-row" data-id="${h.id}" title="Delete Carousel">🗑️ Delete</button>
      </td>
    `;
    
    // Row click event opens the modal preview
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-row')) {
        return;
      }
      openPreviewModal(h);
    });

    const deleteBtn = tr.querySelector('.btn-delete-row');
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Are you sure you want to delete this carousel? This will permanently remove it from both the dashboard and the database.`)) {
        await deleteCarousel(h.id);
      }
    });

    tbody.appendChild(tr);
  });
}

// Trigger Pipeline Manually
async function triggerPipeline(slot) {
  const theme = document.getElementById('select-theme').value;
  let themePayload = theme;
  if (theme === 'custom') {
    themePayload = JSON.stringify(getCustomThemePayload());
  }
  logToTerminal(`Triggering manual pipeline execution for ${slot.toUpperCase()} slot with theme ${theme.toUpperCase()}...`, 'SYSTEM');
  try {
    const res = await fetch('/api/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot, theme: themePayload })
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

// Gather edited text data from the curation fields
function getEditedCurationData() {
  const linkedinPost = document.getElementById('post-caption-textarea').value;
  
  const headlineInputs = document.querySelectorAll('.slide-input-headline');
  const subheadlineInputs = document.querySelectorAll('.slide-input-subheadline');
  const titleInputs = document.querySelectorAll('.slide-input-title');
  const contentInputs = document.querySelectorAll('.slide-input-content');
  
  const updatedSlides = [];
  
  for (let idx = 0; idx < 5; idx++) {
    const isIntroOrOutro = idx === 0 || idx === 4;
    if (isIntroOrOutro) {
      const headlineEl = Array.from(headlineInputs).find(input => parseInt(input.dataset.idx, 10) === idx);
      const subheadlineEl = Array.from(subheadlineInputs).find(input => parseInt(input.dataset.idx, 10) === idx);
      
      updatedSlides.push({
        slide_number: idx + 1,
        type: idx === 0 ? 'intro' : 'outro',
        headline: headlineEl ? headlineEl.value : '',
        subheadline: subheadlineEl ? subheadlineEl.value : ''
      });
    } else {
      const titleEl = Array.from(titleInputs).find(input => parseInt(input.dataset.idx, 10) === idx);
      const contentEl = Array.from(contentInputs).find(input => parseInt(input.dataset.idx, 10) === idx);
      
      updatedSlides.push({
        slide_number: idx + 1,
        type: idx === 1 ? 'story' : (idx === 2 ? 'deep_dive' : 'impact'),
        title: titleEl ? titleEl.value : '',
        content: contentEl ? contentEl.value : ''
      });
    }
  }
  
  return {
    slides: updatedSlides,
    linkedin_post: linkedinPost
  };
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
  
  if (btnApprove) btnApprove.disabled = true;
  if (btnRegen) btnRegen.disabled = true;
  if (btnReject) btnReject.disabled = true;

  logToTerminal(`Submitting curation action "${action.toUpperCase()}" for run ${activeRunId}...`, 'SYSTEM');

  const bodyData = { action, runId: activeRunId };
  if (action === 'approve') {
    const edited = getEditedCurationData();
    bodyData.slides = edited.slides;
    bodyData.linkedin_post = edited.linkedin_post;
  }

  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
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
    if (btnApprove) btnApprove.disabled = false;
    if (btnRegen) btnRegen.disabled = false;
    if (btnReject) btnReject.disabled = false;
  }
}

// ==========================================
// ZIP FILE EXPORT CONTROLS
// ==========================================

async function downloadImagesAsZip(title, imagePaths) {
  if (!imagePaths || imagePaths.length === 0) {
    logToTerminal('No images available to download.', 'ERROR');
    alert('No images available to download!');
    return;
  }

  logToTerminal(`Preparing ZIP archive for: "${title}"...`, 'SYSTEM');

  try {
    const zip = new JSZip();
    const folderName = title.replace(/[^a-z0-9]/gi, '_').substring(0, 50).toLowerCase();

    for (let i = 0; i < imagePaths.length; i++) {
      const path = imagePaths[i];
      const url = getImageUrl(path);
      const filename = `slide-${i + 1}.png`;

      logToTerminal(`Fetching image ${i + 1} of ${imagePaths.length}...`, 'SYSTEM');
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to retrieve image: ${filename} (${response.statusText})`);
      }
      const blob = await response.blob();
      zip.file(filename, blob);
    }

    logToTerminal('Compressing and packaging ZIP archive...', 'SYSTEM');
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const zipUrl = URL.createObjectURL(zipBlob);

    const zipFileName = `carousel-${folderName}.zip`;
    const tempLink = document.createElement('a');
    tempLink.href = zipUrl;
    tempLink.download = zipFileName;
    document.body.appendChild(tempLink);
    tempLink.click();
    document.body.removeChild(tempLink);
    
    setTimeout(() => URL.revokeObjectURL(zipUrl), 100);

    logToTerminal(`ZIP archive downloaded: ${zipFileName}`, 'SUCCESS');
  } catch (err) {
    console.error('Failed to download ZIP:', err);
    logToTerminal(`ZIP download failed: ${err.message}`, 'ERROR');
    alert(`Failed to create ZIP: ${err.message}`);
  }
}

// ==========================================
// PREVIEW MODAL DIALOG CONTROLS
// ==========================================

function openPreviewModal(run) {
  activeModalRunObj = run; // Set the active run reference for the Workspace loader button
  
  const modal = document.getElementById('preview-modal');
  const modalTitle = document.getElementById('modal-title');
  const container = document.getElementById('modal-slides-container');
  const pathLabel = document.getElementById('modal-folder-path');
  
  const title = run.angle?.title || 'Carousel Preview';
  const imagePaths = run.imagePaths || [];
  
  currentModalRun.title = title;
  currentModalRun.imagePaths = imagePaths;
  currentModalRun.pdfUrl = run.angle?.pdfUrl || (run.status === 'approved' ? `/dist/approved/run-${run.id}/carousel.pdf` : `/dist/runs/${run.id}/carousel.pdf`);
  
  modalTitle.textContent = title;
  container.innerHTML = '';

  if (imagePaths.length === 0) {
    container.innerHTML = `<div class="text-center text-muted" style="grid-column: span 3; padding: 40px;">No slide images available for this record (possibly cleaned up on rejection).</div>`;
    pathLabel.textContent = '';
  } else {
    // Show slides
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

  // Populate the LinkedIn post caption inside modal
  const modalPostCaption = document.getElementById('modal-post-caption');
  modalPostCaption.value = run.linkedin_post || '';
  
  // Populate slides text inside modal
  const slidesTextContainer = document.getElementById('modal-slides-text-container');
  slidesTextContainer.innerHTML = '';
  
  if (run.slides && run.slides.length > 0) {
    run.slides.forEach((slide, idx) => {
      const slideCard = document.createElement('div');
      slideCard.style = 'background: rgba(255,255,255,0.01); border: 1px solid var(--border-panel); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 4px;';
      
      const label = document.createElement('div');
      label.style = 'font-size: 11px; font-weight: 700; color: var(--indigo-accent); text-transform: uppercase; letter-spacing: 0.5px;';
      label.textContent = `Slide ${idx + 1} (${slide.type.toUpperCase()})`;
      slideCard.appendChild(label);
      
      if (slide.type === 'intro' || slide.type === 'outro') {
        slideCard.innerHTML += `
          <div style="font-size: 12px; font-weight: 600; color: var(--text-primary);">${slide.headline || ''}</div>
          <div style="font-size: 11px; color: var(--text-secondary);">${slide.subheadline || ''}</div>
        `;
      } else {
        slideCard.innerHTML += `
          <div style="font-size: 12px; font-weight: 600; color: var(--text-primary);">${slide.title || ''}</div>
          <div style="font-size: 11px; color: var(--text-secondary); line-height: 1.4;">${slide.content || ''}</div>
        `;
      }
      slidesTextContainer.appendChild(slideCard);
    });
  } else {
    slidesTextContainer.innerHTML = '<div style="grid-column: span 2; font-size: 12px; color: var(--text-muted);">No slide text content available for this record.</div>';
  }
  
  modal.classList.remove('hidden');
}

function closePreviewModal() {
  currentModalRun = { title: '', imagePaths: [] };
  activeModalRunObj = null;
  document.getElementById('preview-modal').classList.add('hidden');
}

// ==========================================================================
// ADVANCED PREMIUM SAAS WORKSPACE FUNCTION HELPERS
// ==========================================================================

function getCustomThemePayload() {
  const bg = document.getElementById('picker-bg').value;
  const textPrimary = document.getElementById('picker-text-primary').value;
  const textSecondary = document.getElementById('picker-text-secondary').value;
  const accent = document.getElementById('picker-accent').value;
  const brandSecondary = document.getElementById('picker-secondary').value;
  const font = document.getElementById('select-custom-font').value;
  return { bg, textPrimary, textSecondary, accent, brandSecondary, font };
}

function syncColorInputs(pickerId, hexId) {
  const picker = document.getElementById(pickerId);
  const hex = document.getElementById(hexId);
  picker.addEventListener('input', () => {
    hex.value = picker.value.toUpperCase();
    updateLivePreviewColors();
  });
  hex.addEventListener('input', () => {
    if (hex.value.match(/^#[0-9A-F]{6}$/i)) {
      picker.value = hex.value;
      updateLivePreviewColors();
    }
  });
}

function updateLivePreviewColors() {
  const theme = document.getElementById('select-theme').value;
  if (theme !== 'custom') return;
  
  const payload = getCustomThemePayload();
  let fontStack = "'Inter', sans-serif";
  if (payload.font === 'serif' || payload.font === 'Playfair Display') {
    fontStack = "'Playfair Display', Georgia, serif";
  } else if (payload.font === 'outfit' || payload.font === 'Outfit') {
    fontStack = "'Outfit', sans-serif";
  } else if (payload.font === 'bebas' || payload.font === 'Bebas Neue') {
    fontStack = "'Bebas Neue', sans-serif";
  }
  
  const slides = document.querySelectorAll('#slides-deck .slide');
  slides.forEach(slide => {
    // Override class for custom styles
    slide.className = slide.className.replace(/theme-\S+/g, 'theme-custom');
    
    // Inject custom colors
    slide.style.setProperty('--brand-bg', payload.bg);
    slide.style.setProperty('--brand-text-primary', payload.textPrimary);
    slide.style.setProperty('--brand-text-secondary', payload.textSecondary);
    slide.style.setProperty('--brand-accent', payload.accent);
    slide.style.setProperty('--brand-secondary', payload.brandSecondary);
    slide.style.setProperty('font-family', fontStack, 'important');
    
    // Calculate brightness for theme contrast classes
    const hex = payload.bg.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    
    if (brightness < 128) {
      slide.classList.add('slide-theme-dark');
      slide.classList.remove('slide-theme-light');
    } else {
      slide.classList.add('slide-theme-light');
      slide.classList.remove('slide-theme-dark');
    }
  });
}

function renderLivePreviewHtml(run) {
  const deck = document.getElementById('slides-deck');
  deck.innerHTML = '';
  
  const theme = run.theme || 'default';
  let themeClass = `theme-${theme}`;
  let customStyleAttr = '';
  
  if (typeof theme === 'string' && theme.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(theme);
      themeClass = 'theme-custom';
      let fontStack = "'Inter', sans-serif";
      if (parsed.font === 'serif' || parsed.font === 'Playfair Display') {
        fontStack = "'Playfair Display', Georgia, serif";
      } else if (parsed.font === 'outfit' || parsed.font === 'Outfit') {
        fontStack = "'Outfit', sans-serif";
      } else if (parsed.font === 'bebas' || parsed.font === 'Bebas Neue') {
        fontStack = "'Bebas Neue', sans-serif";
      }
      customStyleAttr = `style="` +
        `--brand-bg: ${parsed.bg || '#0F0F1A'}; ` +
        `--brand-text-primary: ${parsed.textPrimary || '#F9FAFB'}; ` +
        `--brand-text-secondary: ${parsed.textSecondary || '#9CA3AF'}; ` +
        `--brand-accent: ${parsed.accent || '#6366F1'}; ` +
        `--brand-secondary: ${parsed.brandSecondary || '#EC4899'}; ` +
        `font-family: ${fontStack} !important;"`;
    } catch (err) {
      console.error('Failed to parse custom theme in renderLivePreviewHtml:', err);
    }
  }
  
  const brandHandle = 'www.linkedin.com/in/mohammad-anouf-saani';
  const authorName = 'Mohammad Anouf Saani';
  const totalSlides = run.slides.length;
  
  run.slides.forEach((slide, index) => {
    const slideNumStr = String(slide.slide_number).padStart(2, '0');
    const progressPercent = (index / (totalSlides - 1 || 1)) * 100;
    
    let isDark;
    if (theme === 'light' || theme === 'r3' || theme === 'r4') {
      isDark = false;
    } else if (theme === 'dark' || theme === 'ocean' || theme === 'sunset' || theme === 'forest' || theme === 'r1' || theme === 'r2') {
      isDark = true;
    } else if (themeClass === 'theme-custom') {
      try {
        const parsed = JSON.parse(theme);
        const bg = parsed.bg || '#0F0F1A';
        const hex = bg.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        isDark = brightness < 128;
      } catch (e) {
        isDark = true;
      }
    } else {
      isDark = index === 0 || index === 1 || index === 4;
    }
    const slideThemeClass = isDark ? 'slide-theme-dark' : 'slide-theme-light';
    
    const isOutro = index === totalSlides - 1;
    const accentBarClass = isOutro ? 'accent-bar-top' : 'accent-bar-bottom';
    const contentAreaClass = isOutro ? 'slide-content-area-outro' : '';
    const titleClass = isOutro || index === 0 ? 'slide-title-large' : 'slide-title-body';
    
    const footerIconText = isOutro ? '💜' : '&rarr;';
    const footerIconClass = isOutro ? 'footer-icon-heart' : '';
    
    let titleText = '';
    let bodyText = '';
    
    if (index === 0) {
      titleText = slide.headline || '';
      bodyText = slide.subheadline || '';
    } else if (isOutro) {
      titleText = slide.headline || 'THANK YOU!';
      bodyText = slide.subheadline || '';
    } else {
      titleText = slide.title || '';
      bodyText = slide.content || '';
    }
    
    const formatMarkdownHtml = (txt) => {
      if (!txt) return '';
      return txt.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    };
    titleText = formatMarkdownHtml(titleText);
    bodyText = formatMarkdownHtml(bodyText);
    
    const slideWrapper = document.createElement('div');
    slideWrapper.className = 'html-slide-wrapper';
    slideWrapper.innerHTML = `
      <div class="slide ${themeClass} ${slideThemeClass} slide-index-${index}" ${customStyleAttr}>
        <div class="slide-backdrop-num">${slideNumStr}</div>
        
        <div class="slide-top-line-container">
          <div class="slide-top-line-left"></div>
          <div class="slide-top-line-number">${slideNumStr}</div>
          <div class="slide-top-line-right"></div>
        </div>
        
        <div class="slide-header">
          <div class="brand-handle">${brandHandle}</div>
          <div class="slide-number">${slideNumStr}</div>
          <div class="slide-number-r1">#2026</div>
          <div class="slide-number-r3">#${slideNumStr}</div>
        </div>
        
        ${index < totalSlides - 1 ? `<div class="slide-swipe-pill">Swipe</div>` : ''}
        
        <div class="accent-bar ${accentBarClass}"></div>
        <div class="slide-content-area ${contentAreaClass}">
          ${theme === 'r4' && index === 0 ? `<div class="slide-title-pre">3 WAYS TO:</div>` : ''}
          <h1 class="slide-title ${titleClass}">${titleText}</h1>
          <p class="slide-paragraph">${bodyText}</p>
        </div>
        
        <div class="slide-bottom-line-container">
          <div class="slide-bottom-line"></div>
          <div class="slide-bottom-line-arrow">&rarr;</div>
          <div class="curved-arrow"></div>
        </div>
        
        <div class="slide-progress-bar-container">
          <div class="slide-progress-bar-fill" style="width: ${progressPercent}%;"></div>
        </div>
        
        <div class="slide-footer">
          <div class="footer-author">${authorName}</div>
          <div class="footer-author-pill">
            <img src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=facearea&facepad=2&w=256&h=256&q=80" alt="Avatar">
            <span class="name">${authorName}</span>
          </div>
          <div class="footer-website">linkedin.com/in/mohammad-anouf-saani</div>
          <div class="footer-handle">@mohammadanoufsaani</div>
          <div class="footer-swipe-text">SWIPE</div>
          <div class="footer-icon ${footerIconClass}">${footerIconText}</div>
        </div>
      </div>
    `;
    
    slideWrapper.addEventListener('click', () => openPreviewModal(run));
    deck.appendChild(slideWrapper);
  });
}

function bindLiveTextListeners() {
  const container = document.getElementById('slide-text-fields-container');
  
  container.querySelectorAll('.slide-input-headline').forEach(input => {
    input.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const text = e.target.value.replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>');
      const slideEl = document.querySelector(`#slides-deck .slide-index-\${idx}`);
      if (slideEl) {
        const titleEl = slideEl.querySelector('.slide-title');
        if (titleEl) titleEl.innerHTML = text;
      }
    });
  });
  
  container.querySelectorAll('.slide-input-subheadline').forEach(input => {
    input.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const text = e.target.value.replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>');
      const slideEl = document.querySelector(`#slides-deck .slide-index-\${idx}`);
      if (slideEl) {
        const paraEl = slideEl.querySelector('.slide-paragraph');
        if (paraEl) paraEl.innerHTML = text;
      }
    });
  });
  
  container.querySelectorAll('.slide-input-title').forEach(input => {
    input.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const text = e.target.value.replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>');
      const slideEl = document.querySelector(`#slides-deck .slide-index-\${idx}`);
      if (slideEl) {
        const titleEl = slideEl.querySelector('.slide-title');
        if (titleEl) titleEl.innerHTML = text;
      }
    });
  });
  
  container.querySelectorAll('.slide-input-content').forEach(input => {
    input.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const text = e.target.value.replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>');
      const slideEl = document.querySelector(`#slides-deck .slide-index-\${idx}`);
      if (slideEl) {
        const paraEl = slideEl.querySelector('.slide-paragraph');
        if (paraEl) paraEl.innerHTML = text;
      }
    });
  });
}

// ==========================================
// SCHEDULER MANAGEMENT HELPERS
// ==========================================

async function fetchSchedulerSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    
    if (data.scheduler) {
      document.getElementById('scheduler-enabled').checked = data.scheduler.enabled;
      document.getElementById('scheduler-am-time').value = data.scheduler.amTime || '08:00';
      document.getElementById('scheduler-pm-time').value = data.scheduler.pmTime || '20:00';
      
      renderOneOffTasksList(data.scheduler.oneOffs || []);
    }
  } catch (err) {
    console.error('Failed to load scheduler settings:', err);
  }
}

function renderOneOffTasksList(tasks) {
  const container = document.getElementById('scheduled-tasks-list');
  container.innerHTML = '';
  
  if (tasks.length === 0) {
    container.innerHTML = '<div style="color: var(--text-secondary); font-style: italic; font-size: 11px; text-align: center; padding: 10px 0;">No tasks scheduled</div>';
    return;
  }
  
  tasks.forEach(task => {
    const dateStr = new Date(task.time).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata'
    });
    
    const taskDiv = document.createElement('div');
    taskDiv.style = 'display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2); border: 1px solid var(--border-panel); border-radius: 6px; padding: 8px 10px; gap: 8px; margin-bottom: 2px;';
    
    let typeLabel = task.type.toUpperCase();
    if (task.type === 'custom') {
      typeLabel = `CUSTOM: "${task.topic}"`;
    }
    
    taskDiv.innerHTML = `
      <div style="flex-grow: 1; min-width: 0; text-align: left;">
        <div style="font-weight: 600; font-size: 11.5px; color: var(--indigo-accent); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${typeLabel}">${typeLabel}</div>
        <div style="font-size: 10.5px; color: var(--text-secondary); margin-top: 2px;">🕒 ${dateStr} (IST)</div>
      </div>
      <button class="btn-delete-oneoff" data-id="${task.id}" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #ef4444; border-radius: 4px; padding: 3px 6px; font-size: 10px; cursor: pointer; flex-shrink: 0;">Delete</button>
    `;
    
    container.appendChild(taskDiv);
  });
}

async function saveSchedulerSettings() {
  const enabled = document.getElementById('scheduler-enabled').checked;
  const amTime = document.getElementById('scheduler-am-time').value;
  const pmTime = document.getElementById('scheduler-pm-time').value;
  
  logToTerminal('Saving scheduler configurations to server...', 'SYSTEM');
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scheduler: { enabled, amTime, pmTime }
      })
    });
    const data = await res.json();
    if (data.success) {
      logToTerminal('Scheduler configurations saved successfully!', 'SUCCESS');
      alert('Scheduler configuration saved successfully!');
    } else {
      logToTerminal(`Failed to save scheduler: ${data.error}`, 'ERROR');
    }
  } catch (err) {
    console.error('Failed to save settings:', err);
    logToTerminal(`Failed to save settings: ${err.message}`, 'ERROR');
  }
}

async function scheduleOneOffTask() {
  const datetimeVal = document.getElementById('oneoff-datetime').value;
  const type = document.getElementById('oneoff-type').value;
  const topic = document.getElementById('oneoff-topic').value;
  
  if (!datetimeVal) {
    alert('Please select a date and time for the one-off schedule.');
    return;
  }
  
  if (type === 'custom' && !topic.trim()) {
    alert('Please enter a custom topic prompt.');
    return;
  }
  
  logToTerminal(`Scheduling one-off task for ${datetimeVal}...`, 'SYSTEM');
  try {
    const res = await fetch('/api/settings/one-off', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        time: new Date(datetimeVal).toISOString(),
        type,
        topic: type === 'custom' ? topic.trim() : null
      })
    });
    const data = await res.json();
    if (data.success) {
      logToTerminal('One-off task successfully scheduled!', 'SUCCESS');
      document.getElementById('oneoff-datetime').value = '';
      document.getElementById('oneoff-topic').value = '';
      fetchSchedulerSettings();
    } else {
      logToTerminal(`Failed to schedule task: ${data.error}`, 'ERROR');
      alert(`Schedule failed: ${data.error}`);
    }
  } catch (err) {
    console.error('Failed to schedule task:', err);
    logToTerminal(`Schedule task failed: ${err.message}`, 'ERROR');
  }
}

async function deleteOneOffTask(id) {
  logToTerminal(`Deleting scheduled task ${id}...`, 'SYSTEM');
  try {
    const res = await fetch(`/api/settings/one-off/${id}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      logToTerminal('Scheduled task deleted successfully.', 'SUCCESS');
      fetchSchedulerSettings();
    } else {
      logToTerminal(`Failed to delete task: ${data.error}`, 'ERROR');
    }
  } catch (err) {
    console.error('Failed to delete task:', err);
    logToTerminal(`Delete task failed: ${err.message}`, 'ERROR');
  }
}

function downloadActivePdf() {
  if (!activeRunId) {
    alert('No active run selected.');
    return;
  }
  
  let pdfUrl = activeRunDetails.angle?.pdfUrl;
  if (!pdfUrl) {
    const status = activeRunDetails.status;
    if (status === 'approved') {
      pdfUrl = `/dist/approved/run-\${activeRunId}/carousel.pdf`;
    } else {
      pdfUrl = `/dist/runs/\${activeRunId}/carousel.pdf`;
    }
  }
  
  const tempLink = document.createElement('a');
  tempLink.href = getImageUrl(pdfUrl);
  tempLink.download = `carousel-\${activeRunId}.pdf`;
  document.body.appendChild(tempLink);
  tempLink.click();
  document.body.removeChild(tempLink);
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
  document.getElementById('btn-download-zip-active').addEventListener('click', () => {
    downloadImagesAsZip(activeRunDetails.angle?.title || 'Carousel', activeRunDetails.imagePaths);
  });
  document.getElementById('btn-regen').addEventListener('click', () => submitCurationAction('regen'));
  const btnReject = document.getElementById('btn-reject');
  if (btnReject) {
    btnReject.addEventListener('click', () => submitCurationAction('reject'));
  }

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
  document.getElementById('btn-download-zip-modal').addEventListener('click', () => {
    downloadImagesAsZip(currentModalRun.title, currentModalRun.imagePaths);
  });
  document.getElementById('preview-modal').addEventListener('click', (e) => {
    if (e.target.id === 'preview-modal') closePreviewModal();
  });

  // Search Filter Handler
  document.getElementById('search-filter').addEventListener('input', () => {
    fetchHistory(true); // Redraw table based on input
  });

  // Theme Dropdown Customizer Selector
  document.getElementById('select-theme').addEventListener('change', (e) => {
    const customizer = document.getElementById('brand-customizer');
    if (e.target.value === 'custom') {
      customizer.classList.remove('hidden');
      updateLivePreviewColors();
    } else {
      customizer.classList.add('hidden');
      // If active workspace is loaded, re-render it to remove custom colors
      if (isCurationActive && activeRunDetails) {
        renderLivePreviewHtml(activeRunDetails);
      }
    }
  });

  // Color Pickers & Hex inputs Sync
  syncColorInputs('picker-bg', 'hex-bg');
  syncColorInputs('picker-text-primary', 'hex-text-primary');
  syncColorInputs('picker-text-secondary', 'hex-text-secondary');
  syncColorInputs('picker-accent', 'hex-accent');
  syncColorInputs('picker-secondary', 'hex-secondary');
  document.getElementById('select-custom-font').addEventListener('change', updateLivePreviewColors);

  // Reset Customizer Button
  document.getElementById('btn-reset-customizer').addEventListener('click', () => {
    document.getElementById('picker-bg').value = '#0F0F1A';
    document.getElementById('hex-bg').value = '#0F0F1A';
    document.getElementById('picker-text-primary').value = '#F9FAFB';
    document.getElementById('hex-text-primary').value = '#F9FAFB';
    document.getElementById('picker-text-secondary').value = '#9CA3AF';
    document.getElementById('hex-text-secondary').value = '#9CA3AF';
    document.getElementById('picker-accent').value = '#6366F1';
    document.getElementById('hex-accent').value = '#6366F1';
    document.getElementById('picker-secondary').value = '#EC4899';
    document.getElementById('hex-secondary').value = '#EC4899';
    document.getElementById('select-custom-font').value = 'Outfit';
    updateLivePreviewColors();
  });

  // Custom Topic Generator Button
  document.getElementById('btn-generate-custom').addEventListener('click', async () => {
    const topic = document.getElementById('input-custom-topic').value.trim();
    if (!topic) {
      alert('Please enter a topic prompt first.');
      return;
    }
    
    const selectTheme = document.getElementById('select-theme').value;
    let themePayload = selectTheme;
    if (selectTheme === 'custom') {
      themePayload = JSON.stringify(getCustomThemePayload());
    }
    
    logToTerminal(`Triggering custom generation for topic: "${topic}"...`, 'SYSTEM');
    
    try {
      const res = await fetch('/api/generate-custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, theme: themePayload })
      });
      const data = await res.json();
      if (data.success) {
        logToTerminal(`Custom generation started successfully for run ID ${data.runId}.`, 'SUCCESS');
        logToTerminal(`Generating content and rendering PNGs/PDF...`, 'WARN');
        document.getElementById('input-custom-topic').value = '';
        
        // Poll for updates
        setTimeout(() => fetchHistory(true), 25000);
      } else {
        logToTerminal(`Custom generation failed: ${data.error}`, 'ERROR');
      }
    } catch (err) {
      logToTerminal(`Custom generation request failed: ${err.message}`, 'ERROR');
    }
  });

  // Download PDF Active Workspace Trigger
  document.getElementById('btn-download-pdf-active').addEventListener('click', downloadActivePdf);

  // Modal Download PDF and Load in Workspace triggers
  document.getElementById('btn-download-pdf-modal').addEventListener('click', () => {
    if (!currentModalRun.pdfUrl) {
      alert('No PDF available.');
      return;
    }
    const tempLink = document.createElement('a');
    tempLink.href = getImageUrl(currentModalRun.pdfUrl);
    tempLink.download = `carousel-${currentModalRun.title.replace(/[^a-z0-9]/gi, '_')}.pdf`;
    document.body.appendChild(tempLink);
    tempLink.click();
    document.body.removeChild(tempLink);
  });

  document.getElementById('btn-load-workspace-modal').addEventListener('click', () => {
    if (activeModalRunObj) {
      logToTerminal(`Loading run ${activeModalRunObj.id} into active Curation Workspace...`, 'SYSTEM');
      closePreviewModal();
      
      // Force status to pending to enable interactive edits
      const editableRun = {
        ...activeModalRunObj,
        status: 'pending'
      };
      
      renderCurationWorkspace(editableRun);
      logToTerminal(`Loaded run "${activeModalRunObj.angle?.title || activeModalRunObj.id}" in curation space.`, 'SUCCESS');
    } else {
      alert('Could not find selected run to load.');
    }
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

  // LinkedIn Post Caption Copy Button (Modal version)
  const btnCopyModal = document.getElementById('btn-copy-post-modal');
  btnCopyModal.addEventListener('click', () => {
    const textarea = document.getElementById('modal-post-caption');
    if (!textarea.value) return;
    
    navigator.clipboard.writeText(textarea.value).then(() => {
      const originalText = btnCopyModal.textContent;
      btnCopyModal.textContent = 'Copied! ✓';
      btnCopyModal.style.background = 'var(--success-glow)';
      btnCopyModal.style.color = 'var(--success)';
      btnCopyModal.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      
      setTimeout(() => {
        btnCopyModal.textContent = originalText;
        btnCopyModal.style.background = '';
        btnCopyModal.style.color = '';
        btnCopyModal.style.borderColor = '';
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy text:', err);
    });
  });

  // Scheduler Event Listeners
  document.getElementById('btn-save-scheduler').addEventListener('click', saveSchedulerSettings);
  
  const selectOneOffType = document.getElementById('oneoff-type');
  const inputOneOffTopic = document.getElementById('oneoff-topic');
  selectOneOffType.addEventListener('change', (e) => {
    if (e.target.value === 'custom') {
      inputOneOffTopic.style.display = 'block';
    } else {
      inputOneOffTopic.style.display = 'none';
    }
  });
  
  document.getElementById('btn-schedule-oneoff').addEventListener('click', scheduleOneOffTask);
  
  // Delegate delete clicks in the scheduled tasks list
  document.getElementById('scheduled-tasks-list').addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-delete-oneoff')) {
      const id = e.target.dataset.id;
      if (confirm('Are you sure you want to cancel and delete this scheduled task?')) {
        deleteOneOffTask(id);
      }
    }
  });

  // Fetch scheduler settings initially
  fetchSchedulerSettings();
});
