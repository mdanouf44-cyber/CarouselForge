// ==========================================================================
// Carousel Forge Web Dashboard JavaScript
// ==========================================================================

let activeRunId = null;
let isCurationActive = false;
let activeRunDetails = { title: '', imagePaths: [] };
let currentModalRun = { title: '', imagePaths: [] };

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
    thumb.addEventListener('click', () => openPreviewModal(run));
    deck.appendChild(thumb);
  });
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
      openPreviewModal(h);
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
  
  btnApprove.disabled = true;
  btnRegen.disabled = true;
  btnReject.disabled = true;

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
    btnApprove.disabled = false;
    btnRegen.disabled = false;
    btnReject.disabled = false;
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
  const modal = document.getElementById('preview-modal');
  const modalTitle = document.getElementById('modal-title');
  const container = document.getElementById('modal-slides-container');
  const pathLabel = document.getElementById('modal-folder-path');
  
  const title = run.angle?.title || 'Carousel Preview';
  const imagePaths = run.imagePaths || [];
  
  currentModalRun.title = title;
  currentModalRun.imagePaths = imagePaths;
  
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
  document.getElementById('btn-download-zip-active').addEventListener('click', () => {
    downloadImagesAsZip(activeRunDetails.title, activeRunDetails.imagePaths);
  });
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
});
