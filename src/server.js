import TelegramBot from 'node-telegram-bot-api';
import cron from 'node-cron';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { scrapeTrending, getIstBoundaries } from './scraper.js';
import { generateCarouselContent } from './generator.js';
import { renderCarouselPngs } from './renderer.js';
import { readDb, writeDb, addHistoryEntry, updateHistoryStatus, initDb, cleanupOldHistoryEntries, deleteHistoryEntry } from './db.js';
import JSZip from 'jszip';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize local settings
const settingsPath = path.join(__dirname, '../data/settings.json');
if (!fs.existsSync(path.dirname(settingsPath))) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
}
if (!fs.existsSync(settingsPath)) {
  fs.writeFileSync(settingsPath, JSON.stringify({ defaultTheme: 'default', customTheme: null }, null, 2));
}

function readSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to read settings:', err);
  }
  return { defaultTheme: 'default', customTheme: null };
}

function writeSettings(settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Failed to write settings:', err);
  }
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const defaultChatId = process.env.TELEGRAM_CHAT_ID;

// Initialize Bot only if token is present (graceful offline development fallback)
let bot = null;
if (token) {
  try {
    bot = new TelegramBot(token, { polling: true });
    console.log('Telegram Bot client initialized and polling updates...');
  } catch (tgErr) {
    console.error('Failed to initialize Telegram Bot polling:', tgErr.message);
  }
} else {
  console.warn('⚠️ Warning: TELEGRAM_BOT_TOKEN is missing in .env. Telegram integration is disabled, but the Web Curation Dashboard is fully active.');
}

// Initialize database client connection
initDb().catch(console.error);

// Helper to escape HTML characters for safe Telegram delivery
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Helper to provide mockup slide data if API key is missing
async function getSlidesContent(story, timeSlot) {
  if (!process.env.GEMINI_API_KEY && !process.env.NVIDIA_API_KEY) {
    console.log('No GEMINI_API_KEY or NVIDIA_API_KEY detected. Using mockup slides content fallback...');

    // Shorten title if it is too long for the intro headline
    const cleanTitle = story.title.replace(/[^\w\s-]/g, '').trim();
    const words = cleanTitle.split(/\s+/);
    const shortTitle = words.slice(0, 8).join(' ');

    return {
      date: new Date().toISOString().split('T')[0],
      linkedin_post: `🚀 *Tech Insights: ${story.title}*\n\nHere is a breakdown of what happened and its industry implications:\n\n1️⃣ **The News**: This trending story originated from ${story.source || 'Tech feeds'}. \n2️⃣ **How it Works**: Mechanics are aligned with standardized square design template layout grids. \n3️⃣ **Implications**: Early developer reactions indicate significant structural software shifts.\n\nRead the full details in the slides below!\n\n#AI #TechNews #LinkedInCarousel`,
      slides: [
        {
          slide_number: 1,
          type: "intro",
          headline: shortTitle ? `Trending: ${shortTitle}` : "Latest Tech Updates",
          subheadline: "Curated key details and insights from this trending tech story."
        },
        {
          slide_number: 2,
          type: "story",
          title: "The Big Announcement",
          content: `This story originated from ${story.source || 'Tech feeds'}. Main news details: ${story.title.substring(0, 75)}${story.title.length > 75 ? '...' : ''}. We are actively tracking developer community feedback.`
        },
        {
          slide_number: 3,
          type: "deep_dive",
          title: "How It Works",
          content: "We analyzed the underlying mechanics and structural upgrades. The slide templates now render alternating light and dark backgrounds with clean custom typography."
        },
        {
          slide_number: 4,
          type: "impact",
          title: "Industry Impact",
          content: "Professionals are evaluating integration and deployment speed. Early feedback suggests notable efficiency gains and widespread adoption potential."
        },
        {
          slide_number: 5,
          type: "outro",
          headline: "THANK YOU!",
          subheadline: "Follow for daily AI & tech breakdowns. Share your thoughts in the comments!"
        }
      ]
    };
  }

  return await generateCarouselContent(story, timeSlot);
}

// ==========================================
// CORE REUSABLE ACTION HELPERS
// ==========================================

export async function approveRun(runId, updatedSlides = null, updatedLinkedinPost = null) {
  const db = await readDb();
  const entryIndex = db.history.findIndex(h => h.id === runId && h.status === 'pending');

  if (entryIndex === -1) {
    const alreadyDone = db.history.find(h => h.id === runId);
    if (alreadyDone) {
      return { status: alreadyDone.status, message: `Carousel was already ${alreadyDone.status}` };
    }
    throw new Error('Pending run not found in history.');
  }

  const entry = db.history[entryIndex];

  // If slide or caption content was edited on the dashboard, update and re-render
  if (updatedSlides) {
    entry.slides = updatedSlides;
  }
  if (updatedLinkedinPost !== null && updatedLinkedinPost !== undefined) {
    entry.linkedin_post = updatedLinkedinPost;
  }

  if (updatedSlides) {
    console.log(`[Approve] Re-rendering slide PNGs for ${runId} due to custom content edits...`);
    
    // Clean up the old temp run directory before re-rendering
    if (entry.imagePaths && entry.imagePaths.length > 0) {
      const oldRunDir = path.dirname(entry.imagePaths[0]);
      try {
        if (fs.existsSync(oldRunDir)) {
          fs.rmSync(oldRunDir, { recursive: true, force: true });
        }
      } catch (err) {
        console.warn(`Failed to clean up old temp run directory ${oldRunDir}:`, err.message);
      }
    }

    const renderResult = await renderCarouselPngs({
      date: entry.angle?.publishedAt ? new Date(entry.angle.publishedAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      linkedin_post: entry.linkedin_post,
      slides: entry.slides,
      theme: entry.theme || 'default'
    });
    entry.imagePaths = renderResult.imagePaths;
    if (entry.angle) {
      entry.angle.pdfPath = renderResult.pdfPath;
    } else {
      entry.angle = { pdfPath: renderResult.pdfPath };
    }
  }

  const approvedDir = path.join(__dirname, `../dist/approved/run-${runId}`);
  fs.mkdirSync(approvedDir, { recursive: true });

  // Copy PNGs to output approved directory (downloading if they are remote URLs)
  const newPaths = [];
  for (const oldPath of entry.imagePaths) {
    const baseName = path.basename(oldPath.startsWith('http') ? new URL(oldPath).pathname : oldPath);
    const newPath = path.join(approvedDir, baseName);
    if (oldPath.startsWith('http://') || oldPath.startsWith('https://')) {
      const response = await fetch(oldPath);
      if (!response.ok) {
        throw new Error(`Failed to download slide image from ${oldPath}: Status ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      fs.writeFileSync(newPath, Buffer.from(arrayBuffer));
    } else {
      fs.copyFileSync(oldPath, newPath);
    }
    newPaths.push(newPath);
  }

  // Copy PDF if exists (downloading if it is a remote URL)
  let approvedPdfPath = '';
  const pdfUrl = entry.angle?.pdfUrl;
  const oldPdfPath = entry.angle?.pdfPath || path.join(__dirname, `../dist/runs/${runId}/carousel.pdf`);

  if (pdfUrl && (pdfUrl.startsWith('http://') || pdfUrl.startsWith('https://'))) {
    try {
      const pdfBaseName = path.basename(new URL(pdfUrl).pathname);
      approvedPdfPath = path.join(approvedDir, pdfBaseName);
      console.log(`[Approve] Downloading PDF from storage to local approved dir...`);
      const response = await fetch(pdfUrl);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(approvedPdfPath, Buffer.from(arrayBuffer));
      } else {
        console.warn(`[Approve] Failed to download PDF from URL: ${pdfUrl}`);
        approvedPdfPath = '';
      }
    } catch (pdfErr) {
      console.warn(`[Approve] Error downloading PDF:`, pdfErr.message);
      approvedPdfPath = '';
    }
  }

  // If download failed or wasn't a URL, try copying local path
  if (!approvedPdfPath && fs.existsSync(oldPdfPath)) {
    const pdfBaseName = path.basename(oldPdfPath);
    approvedPdfPath = path.join(approvedDir, pdfBaseName);
    fs.copyFileSync(oldPdfPath, approvedPdfPath);
  }

  // Update history entry status & fields in Supabase
  await updateHistoryStatus(runId, 'approved', { 
    imagePaths: newPaths,
    linkedin_post: entry.linkedin_post,
    slides: entry.slides,
    angle: entry.angle ? {
      ...entry.angle,
      pdfPath: approvedPdfPath || entry.angle.pdfPath
    } : { pdfPath: approvedPdfPath }
  });
  
  return { status: 'approved', approvedDir };
}

export async function rejectRun(runId) {
  const db = await readDb();
  const entryIndex = db.history.findIndex(h => h.id === runId && h.status === 'pending');

  if (entryIndex === -1) {
    const alreadyDone = db.history.find(h => h.id === runId);
    if (alreadyDone) {
      return { status: alreadyDone.status, message: `Carousel was already ${alreadyDone.status}` };
    }
    throw new Error('Pending run not found in history.');
  }

  const entry = db.history[entryIndex];

  // Update DB status to rejected
  await updateHistoryStatus(runId, 'rejected');

  // Clean up temporary PNG files
  if (entry.imagePaths && entry.imagePaths.length > 0) {
    const runDir = path.dirname(entry.imagePaths[0]);
    try {
      if (fs.existsSync(runDir)) {
        fs.rmSync(runDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn(`Failed to clean up rejected run directory ${runDir}:`, err.message);
    }
  }

  return { status: 'rejected' };
}

export async function regenerateRun(runId) {
  const db = await readDb();
  const currentRun = db.current_run;

  if (!currentRun || currentRun.runId !== runId) {
    throw new Error('This run is no longer active for regeneration.');
  }

  const nextIndex = currentRun.currentAngleIndex + 1;
  if (nextIndex >= currentRun.angles.length) {
    throw new Error('No more ranked stories/angles available for this run.');
  }

  // Update active angle index in DB
  currentRun.currentAngleIndex = nextIndex;
  await writeDb(db);

  const story = currentRun.angles[nextIndex];

  // Generate copy using fallback helper
  const slidesData = await getSlidesContent(story, currentRun.timeSlot);
  slidesData.theme = currentRun.theme || 'default';

  // Render to PNGs
  const renderResult = await renderCarouselPngs(slidesData);

  // Clean up the previous pending run files for space efficiency
  const lastPending = db.history.find(h => h.id === runId && h.status === 'pending');
  if (lastPending && lastPending.imagePaths && lastPending.imagePaths.length > 0) {
    const lastRunDir = path.dirname(lastPending.imagePaths[0]);
    try {
      if (fs.existsSync(lastRunDir)) {
        fs.rmSync(lastRunDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn(`Failed to remove old pending run files ${lastRunDir}:`, err.message);
    }
  }

  // Remove previous pending run ID records to keep ID unique
  const freshDb = await readDb();
  freshDb.history = freshDb.history.filter(h => h.id !== runId);
  await writeDb(freshDb);

  // Add fresh pending entry
  await addHistoryEntry({
    id: runId,
    timeSlot: currentRun.timeSlot,
    status: 'pending',
    angle: {
      ...story,
      pdfPath: renderResult.pdfPath
    },
    slides: slidesData.slides,
    imagePaths: renderResult.imagePaths,
    linkedin_post: slidesData.linkedin_post,
    theme: currentRun.theme || 'default'
  });

  // Sync back to Telegram if chatbot is enabled and running
  if (bot && currentRun.chatId && currentRun.chatId !== 'manual-trigger') {
    try {
      const media = renderResult.imagePaths.map((filePath, index) => ({
        type: 'photo',
        media: fs.createReadStream(filePath),
        caption: index === 0 ? `🎯 <b>Hook Headline</b>: ${escapeHtml(slidesData.slides[0].headline)}\n\n📖 <b>Story</b>: ${escapeHtml(story.title)}\n🔗 <b>Source</b>: ${escapeHtml(story.url)}` : undefined,
        parse_mode: index === 0 ? 'HTML' : undefined
      }));
      await bot.sendMediaGroup(currentRun.chatId, media);

      // Send the LinkedIn post text copy block
      await bot.sendMessage(currentRun.chatId, `🔄 <b>New LinkedIn Post Caption (Angle #${nextIndex + 1})</b>:\n\n<pre>${escapeHtml(slidesData.linkedin_post)}</pre>`, { parse_mode: 'HTML' });

      const opts = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approve', callback_data: `approve_${runId}` },
              { text: '🔄 Regenerate', callback_data: `regen_${runId}` },
              { text: '❌ Reject', callback_data: `reject_${runId}` }
            ]
          ]
        }
      };
      await bot.sendMessage(currentRun.chatId, `Actions for Carousel (${runId}) (Angle #${nextIndex + 1}):`, opts);
    } catch (tgErr) {
      console.error('Failed to send regenerated carousel to Telegram:', tgErr.message);
    }
  }

  return {
    status: 'regenerated',
    nextIndex,
    angle: story,
    slides: slidesData.slides,
    imagePaths: renderResult.imagePaths
  };
}

// ==========================================
// TELEGRAM BOT UTILITY & COMMAND HANDLERS
// ==========================================

async function sendPdfToTelegram(runId, chatId) {
  const db = await readDb();
  const entry = db.history.find(h => h.id === runId);
  let pdfPath = entry?.angle?.pdfPath;
  if (!pdfPath) {
    const status = entry?.status;
    if (status === 'approved') {
      pdfPath = path.join(__dirname, `../dist/approved/run-${runId}/carousel.pdf`);
    } else {
      pdfPath = path.join(__dirname, `../dist/runs/${runId}/carousel.pdf`);
    }
  }

  if (pdfPath && fs.existsSync(pdfPath)) {
    try {
      await bot.sendDocument(chatId, fs.createReadStream(pdfPath), {
        caption: `📄 PDF Document for carousel: "${entry?.angle?.title || runId}"`
      });
    } catch (err) {
      console.error('Failed to send PDF to Telegram:', err.message);
    }
  } else if (pdfPath && pdfPath.startsWith('http')) {
    try {
      const response = await fetch(pdfPath);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const tempPdfPath = path.join(__dirname, `../dist/carousel-${runId}.pdf`);
        fs.writeFileSync(tempPdfPath, Buffer.from(arrayBuffer));
        await bot.sendDocument(chatId, fs.createReadStream(tempPdfPath), {
          caption: `📄 PDF Document for carousel: "${entry?.angle?.title || runId}"`
        });
        fs.unlinkSync(tempPdfPath);
      } else {
        await bot.sendMessage(chatId, `📄 PDF Document Link: ${pdfPath}`);
      }
    } catch (err) {
      await bot.sendMessage(chatId, `📄 PDF Document Link: ${pdfPath}`);
    }
  } else {
    await bot.sendMessage(chatId, '❌ PDF file not found on server.');
  }
}

async function sendZipToTelegram(runId, chatId) {
  const db = await readDb();
  const entry = db.history.find(h => h.id === runId);
  if (!entry || !entry.imagePaths || entry.imagePaths.length === 0) {
    await bot.sendMessage(chatId, '❌ No images found for this run.');
    return;
  }

  await bot.sendMessage(chatId, '📦 Packaging slide images into ZIP archive...');
  try {
    const zip = new JSZip();
    const cleanTitle = (entry.angle?.title || 'carousel').replace(/[^a-z0-9]/gi, '_').substring(0, 50).toLowerCase();

    for (let i = 0; i < entry.imagePaths.length; i++) {
      const imgPath = entry.imagePaths[i];
      if (fs.existsSync(imgPath)) {
        const fileBuffer = fs.readFileSync(imgPath);
        zip.file(`slide-${i + 1}.png`, fileBuffer);
      } else if (imgPath.startsWith('http')) {
        const response = await fetch(imgPath);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          zip.file(`slide-${i + 1}.png`, Buffer.from(arrayBuffer));
        }
      }
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const zipPath = path.join(__dirname, `../dist/carousel-${cleanTitle}.zip`);
    fs.writeFileSync(zipPath, zipBuffer);

    await bot.sendDocument(chatId, fs.createReadStream(zipPath), {
      caption: `📥 ZIP Archive for carousel: "${entry.angle?.title || runId}"`
    });

    fs.unlinkSync(zipPath);
  } catch (err) {
    console.error('Failed to create ZIP for Telegram:', err.message);
    await bot.sendMessage(chatId, `🚨 Failed to create ZIP archive: ${err.message}`);
  }
}

export async function executeCustomGeneration(topic, theme, chatId) {
  const targetTheme = theme || 'default';
  const runId = `run-custom-${Date.now()}`;
  
  const isManualWeb = chatId === 'manual-trigger';
  if (!isManualWeb && bot) {
    await bot.sendMessage(chatId, `🤖 <b>Starting Custom Topic Generation</b>:\n• <b>Topic</b>: "${escapeHtml(topic)}"\n• <b>Theme</b>: ${escapeHtml(targetTheme.toUpperCase())}\n\nGenerating copy and rendering slides...`, { parse_mode: 'HTML' });
  }

  try {
    const story = {
      title: topic,
      url: 'https://carousel-forge.custom',
      summary: `Generate a LinkedIn carousel about: ${topic}. Explain the key concepts, mechanics, and why it matters.`,
      source: 'Custom Input',
      publishedAt: new Date().toISOString()
    };

    const db = await readDb();
    db.current_run = {
      runId,
      timeSlot: 'custom',
      angles: [story],
      currentAngleIndex: 0,
      chatId,
      theme: targetTheme
    };
    await writeDb(db);

    const slidesData = await getSlidesContent(story, 'pm');
    slidesData.theme = targetTheme;

    const renderResult = await renderCarouselPngs(slidesData);

    await addHistoryEntry({
      id: runId,
      timeSlot: 'custom',
      status: 'pending',
      angle: {
        ...story,
        pdfPath: renderResult.pdfPath
      },
      slides: slidesData.slides,
      imagePaths: renderResult.imagePaths,
      linkedin_post: slidesData.linkedin_post,
      theme: targetTheme
    });

    if (!isManualWeb && bot) {
      await bot.sendMessage(chatId, `📤 Sending custom carousel images to Telegram...`);
      const media = renderResult.imagePaths.map((filePath, index) => ({
        type: 'photo',
        media: fs.createReadStream(filePath),
        caption: index === 0 ? `🎯 <b>Hook Headline</b>: ${escapeHtml(slidesData.slides[0].headline)}\n\n💡 <b>Topic</b>: ${escapeHtml(topic)}` : undefined,
        parse_mode: index === 0 ? 'HTML' : undefined
      }));

      await bot.sendMediaGroup(chatId, media);

      // Send the LinkedIn post text copy block
      await bot.sendMessage(chatId, `📝 <b>Copy-pasteable LinkedIn Post Caption</b>:\n\n<pre>${escapeHtml(slidesData.linkedin_post)}</pre>`, { parse_mode: 'HTML' });

      // Send inline action keyboard
      const opts = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approve', callback_data: `approve_${runId}` },
              { text: '❌ Reject', callback_data: `reject_${runId}` }
            ]
          ]
        }
      };
      await bot.sendMessage(chatId, `Actions for Carousel (${runId}):`, opts);
    }
    
    console.log(`[Custom Generate] Successfully generated and stored custom carousel for runId: ${runId}`);
    return { success: true, runId };
  } catch (err) {
    console.error(`[Custom Generate] Failed to generate custom carousel:`, err.message);
    if (!isManualWeb && bot) {
      await bot.sendMessage(chatId, `🚨 *Custom Generation Failure*:\n${err.message}`);
    }
    throw err;
  }
}

async function sendMainMenu(chatId) {
  const opts = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🌅 Trigger AM Run', callback_data: 'menu_generate_am' },
          { text: '🌃 Trigger PM Run', callback_data: 'menu_generate_pm' }
        ],
        [
          { text: '🎨 Select Theme', callback_data: 'menu_select_theme' },
          { text: '⏳ Review Pending', callback_data: 'menu_review_pending' }
        ],
        [
          { text: '📊 Status', callback_data: 'menu_status' },
          { text: '📜 Archives', callback_data: 'menu_archives' }
        ]
      ]
    }
  };
  await bot.sendMessage(chatId, '🎛️ *Carousel Forge Main Console*:\nSelect an action from the options below, or use /help to see all text commands.', {
    parse_mode: 'Markdown',
    reply_markup: opts.reply_markup
  });
}

async function showThemeSelector(chatId) {
  const currentTheme = readSettings().defaultTheme;
  const opts = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🌌 Obsidian (Default)', callback_data: 'select_theme_default' },
          { text: '🕶️ Minimalist Dark', callback_data: 'select_theme_r1' }
        ],
        [
          { text: '💙 Corporate Dark', callback_data: 'select_theme_r2' },
          { text: '🤍 Elegant Light', callback_data: 'select_theme_r3' }
        ],
        [
          { text: '🤎 Warm Serif', callback_data: 'select_theme_r4' },
          { text: '🕶️ Standard Dark', callback_data: 'select_theme_dark' }
        ],
        [
          { text: '☀️ Standard Light', callback_data: 'select_theme_light' },
          { text: '🌊 Ocean Breeze', callback_data: 'select_theme_ocean' }
        ],
        [
          { text: '🌆 Neon Sunset', callback_data: 'select_theme_sunset' },
          { text: '🌲 Forest Mint', callback_data: 'select_theme_forest' }
        ]
      ]
    }
  };
  
  await bot.sendMessage(chatId, `🎨 *Theme Selector*:\nCurrently selected theme: *${currentTheme.toUpperCase()}*\n\nSelect a theme to use as the default style for all future manual and scheduled carousel runs:`, {
    parse_mode: 'Markdown',
    reply_markup: opts.reply_markup
  });
}

async function showCurationWorkspace(chatId) {
  const db = await readDb();
  const activePending = db.history.find(h => h.status === 'pending');
  
  if (!activePending) {
    await bot.sendMessage(chatId, '📂 <b>Curation Space is Empty</b>\nNo pending carousels to review. Use /generate or /topic to create one.', { parse_mode: 'HTML' });
    return;
  }

  const runId = activePending.id;
  
  if (activePending.imagePaths && activePending.imagePaths.length > 0) {
    try {
      const media = activePending.imagePaths.map((filePath, index) => ({
        type: 'photo',
        media: filePath.startsWith('http') ? filePath : fs.createReadStream(filePath),
        caption: index === 0 ? `🎯 <b>Hook Headline</b>: ${escapeHtml(activePending.slides[0]?.headline || 'Carousel')}\n\n📖 <b>Story</b>: ${escapeHtml(activePending.angle?.title || '')}` : undefined,
        parse_mode: index === 0 ? 'HTML' : undefined
      }));
      await bot.sendMediaGroup(chatId, media);
    } catch (err) {
      console.error('Failed to send media group in curate command:', err.message);
    }
  }

  await bot.sendMessage(chatId, `📝 <b>LinkedIn Post Caption</b>:\n\n<pre>${escapeHtml(activePending.linkedin_post)}</pre>`, { parse_mode: 'HTML' });

  const opts = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `approve_${runId}` },
          { text: '🔄 Regen Next Angle', callback_data: `regen_${runId}` },
          { text: '❌ Reject', callback_data: `reject_${runId}` }
        ],
        [
          { text: '📄 Get PDF', callback_data: `download_pdf_${runId}` },
          { text: '📥 Get ZIP', callback_data: `download_zip_${runId}` }
        ]
      ]
    }
  };
  await bot.sendMessage(chatId, `Curation Workspace options for active run: <b>${escapeHtml(runId)}</b>`, {
    parse_mode: 'HTML',
    reply_markup: opts.reply_markup
  });
}

async function showSystemStatus(chatId) {
  const db = await readDb();
  const approvedCount = db.history.filter(h => h.status === 'approved').length;
  const currentTheme = readSettings().defaultTheme;

  const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false };
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const istTimeStr = formatter.format(new Date());

  const statusMessage = `
🟢 *System Status*:
• *Bot Uptime*: Operational
• *Timezone*: Asia/Kolkata (IST)
• *Current Server Time (IST)*: \`${istTimeStr}\`
• *Default Theme*: \`${currentTheme.toUpperCase()}\`
• *Approved Carousels*: \`${approvedCount}\`
• *Daily Scheduled Runs*:
  - AM run: 08:00 AM IST (Yesterday's news)
  - PM run: 08:00 PM IST (Today's trends)
  `;
  await bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
}

async function showRunHistory(chatId) {
  const db = await readDb();
  const history = db.history.slice(-7).reverse();

  if (history.length === 0) {
    await bot.sendMessage(chatId, '📭 No carousel runs registered in history.');
    return;
  }

  let listStr = '📜 *Recent Carousel History (Last 7 Runs)*:\n';
  history.forEach((h, i) => {
    const dateStr = new Date(h.timestamp).toLocaleString('en-US', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const statusEmoji = h.status === 'approved' ? '✅' : (h.status === 'rejected' ? '❌' : '⏳');
    listStr += `\n${i + 1}. *[${h.timeSlot.toUpperCase()}]* ${h.angle.title}\n   _Status_: ${statusEmoji} ${h.status.toUpperCase()} (${dateStr})\n`;
  });

  await bot.sendMessage(chatId, listStr, { parse_mode: 'Markdown' });
}

if (bot) {
  bot.onText(/\/start|\/menu/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, `👋 Welcome to *Carousel Forge* — AI LinkedIn Curation Assistant!`, { parse_mode: 'Markdown' });
    await sendMainMenu(chatId);
  });

  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const helpMessage = `
🤖 *Bot Command Reference*:
• /menu - Display interactive console menu.
• /generate [am|pm] - Scrape trending stories & generate carousel.
• /topic [topic] - Generate a carousel on a custom topic.
• /theme - Choose the default visual style theme.
• /curate - Review active pending carousel workspace.
• /caption [text] - Edit active pending carousel's LinkedIn caption.
• /edit [slide_number] [title] | [content] - Edit slide text content.
• /status - Check backend status and timezone clock.
• /history - View recent carousel runs archive.
    `;
    await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    await showSystemStatus(chatId);
  });

  bot.onText(/\/history/, async (msg) => {
    const chatId = msg.chat.id;
    await showRunHistory(chatId);
  });

  bot.onText(/\/generate(?:\s+(am|pm))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    let slot = match[1];

    if (!slot) {
      const nowUtc = new Date();
      const formatterHour = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false });
      const currentIstHour = parseInt(formatterHour.format(nowUtc), 10);
      slot = currentIstHour < 14 ? 'am' : 'pm';
      await bot.sendMessage(chatId, `ℹ️ No slot specified. Auto-detected *${slot.toUpperCase()}* slot based on current hour (${currentIstHour} IST).`, { parse_mode: 'Markdown' });
    }

    const theme = readSettings().defaultTheme;
    executePipeline(slot, chatId, theme);
  });

  bot.onText(/\/topic\s+(.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1].trim();
    if (!input) {
      await bot.sendMessage(chatId, '❌ Please enter a topic prompt (e.g. `/topic 5 CSS Flexbox tips`).');
      return;
    }

    let theme = readSettings().defaultTheme;
    let topic = input;
    if (input.includes('|')) {
      const parts = input.split('|');
      const themePart = parts[0].trim().toLowerCase();
      const validThemes = ['default', 'custom', 'r1', 'r2', 'r3', 'r4', 'dark', 'light', 'ocean', 'sunset', 'forest'];
      if (validThemes.includes(themePart)) {
        theme = themePart;
        topic = parts.slice(1).join('|').trim();
      }
    }

    executeCustomGeneration(topic, theme, chatId).catch(console.error);
  });

  bot.onText(/\/theme/, async (msg) => {
    const chatId = msg.chat.id;
    await showThemeSelector(chatId);
  });

  bot.onText(/\/curate/, async (msg) => {
    const chatId = msg.chat.id;
    await showCurationWorkspace(chatId);
  });

  bot.onText(/\/caption\s+(.+)/s, async (msg, match) => {
    const chatId = msg.chat.id;
    const newCaption = match[1].trim();

    const db = await readDb();
    const activePending = db.history.find(h => h.status === 'pending');
    if (!activePending) {
      await bot.sendMessage(chatId, '❌ No active pending carousel found to update caption.');
      return;
    }

    const runId = activePending.id;
    try {
      const entryIndex = db.history.findIndex(h => h.id === runId && h.status === 'pending');
      if (entryIndex !== -1) {
        db.history[entryIndex].linkedin_post = newCaption;
        await updateHistoryStatus(runId, 'pending', {
          linkedin_post: newCaption
        });
        await bot.sendMessage(chatId, '✅ LinkedIn caption updated successfully!');
      }
    } catch (err) {
      await bot.sendMessage(chatId, `🚨 Failed to update caption: ${err.message}`);
    }
  });

  bot.onText(/\/edit\s+(\d+)\s+(.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const slideNum = parseInt(match[1], 10);
    const contentPart = match[2].trim();

    if (isNaN(slideNum) || slideNum < 1 || slideNum > 5) {
      await bot.sendMessage(chatId, '❌ Slide number must be between 1 and 5.');
      return;
    }

    const db = await readDb();
    const activePending = db.history.find(h => h.status === 'pending');
    if (!activePending) {
      await bot.sendMessage(chatId, '❌ No active pending carousel found in workspace to edit.');
      return;
    }

    const runId = activePending.id;
    const slideIdx = slideNum - 1;
    const slide = activePending.slides[slideIdx];

    let updatedSlides = [...activePending.slides];
    const parts = contentPart.split('|');
    const partOne = parts[0].trim();
    const partTwo = parts[1] ? parts[1].trim() : '';
    
    if (slide.type === 'intro' || slide.type === 'outro') {
      updatedSlides[slideIdx] = {
        ...slide,
        headline: partOne,
        subheadline: partTwo
      };
    } else {
      updatedSlides[slideIdx] = {
        ...slide,
        title: partOne,
        content: partTwo
      };
    }

    await bot.sendMessage(chatId, `✍ Modifying Slide ${slideNum} content and re-rendering previews...`);

    try {
      const entryIndex = db.history.findIndex(h => h.id === runId && h.status === 'pending');
      if (entryIndex !== -1) {
        db.history[entryIndex].slides = updatedSlides;
        
        const renderResult = await renderCarouselPngs({
          date: activePending.angle?.publishedAt ? new Date(activePending.angle.publishedAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
          linkedin_post: activePending.linkedin_post,
          slides: updatedSlides,
          theme: activePending.theme || 'default'
        });
        
        db.history[entryIndex].imagePaths = renderResult.imagePaths;
        if (db.history[entryIndex].angle) {
          db.history[entryIndex].angle.pdfPath = renderResult.pdfPath;
        }

        await updateHistoryStatus(runId, 'pending', {
          slides: updatedSlides,
          imagePaths: renderResult.imagePaths,
          angle: db.history[entryIndex].angle
        });

        await bot.sendMessage(chatId, `✅ Slide ${slideNum} updated successfully! Sending new previews...`);

        const media = renderResult.imagePaths.map((filePath, index) => ({
          type: 'photo',
          media: fs.createReadStream(filePath),
          caption: index === 0 ? `📝 <b>Updated Slide Preview</b> (Slide ${slideNum} modified)` : undefined,
          parse_mode: index === 0 ? 'HTML' : undefined
        }));
        await bot.sendMediaGroup(chatId, media);
      }
    } catch (err) {
      console.error(err);
      await bot.sendMessage(chatId, `🚨 Failed to update slide text: ${err.message}`);
    }
  });

  // Interactive Callback Query Router
  bot.on('callback_query', async (callbackQuery) => {
    const action = callbackQuery.data;
    const message = callbackQuery.message;
    const chatId = message.chat.id;

    try {
      // 1. Core curation callbacks
      if (action.startsWith('approve_')) {
        const runId = action.replace('approve_', '');
        // Answer callback query immediately to prevent timeout errors
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Carousel approved! Saving and building assets...' });
        
        await approveRun(runId);

        await bot.editMessageText(`Carousel (${escapeHtml(runId)}) Approved ✅\n\n📁 Saved to output: <code>dist/approved/run-${escapeHtml(runId)}</code>`, {
          chat_id: chatId,
          message_id: message.message_id,
          parse_mode: 'HTML'
        });
        
        // Finalize by sending assets
        await sendPdfToTelegram(runId, chatId);
        await sendZipToTelegram(runId, chatId);

      } else if (action.startsWith('reject_')) {
        const runId = action.replace('reject_', '');
        // Answer callback query immediately to prevent timeout errors
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Carousel rejected. Cleaning up...' });
        
        await rejectRun(runId);

        await bot.editMessageText(`Carousel (${runId}) Rejected ❌\nTemporary files cleaned up.`, { chat_id: chatId, message_id: message.message_id });

      } else if (action.startsWith('regen_')) {
        const runId = action.replace('regen_', '');
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Regenerating carousel...' });
        const dbState = await readDb();
        const nextIdx = (dbState.current_run?.currentAngleIndex || 0) + 2;
        await bot.editMessageText(`Carousel (${runId}) - Regenerating using Angle #${nextIdx}...`, { chat_id: chatId, message_id: message.message_id });

        await regenerateRun(runId);
      
      // 2. Download callbacks
      } else if (action.startsWith('download_pdf_')) {
        const runId = action.replace('download_pdf_', '');
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Fetching PDF document...' });
        await sendPdfToTelegram(runId, chatId);

      } else if (action.startsWith('download_zip_')) {
        const runId = action.replace('download_zip_', '');
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Packaging ZIP file...' });
        await sendZipToTelegram(runId, chatId);

      // 3. Theme selection callbacks
      } else if (action.startsWith('select_theme_')) {
        const theme = action.replace('select_theme_', '');
        const settings = readSettings();
        settings.defaultTheme = theme;
        writeSettings(settings);
        
        await bot.answerCallbackQuery(callbackQuery.id, { text: `Default theme set to ${theme}!` });
        await bot.editMessageText(`✅ Default visual theme updated to <b>${escapeHtml(theme.toUpperCase())}</b> for future generations.`, {
          chat_id: chatId,
          message_id: message.message_id,
          parse_mode: 'HTML'
        });

      // 4. Interactive menu buttons router
      } else if (action === 'menu_generate_am') {
        await bot.answerCallbackQuery(callbackQuery.id);
        const theme = readSettings().defaultTheme;
        executePipeline('am', chatId, theme);

      } else if (action === 'menu_generate_pm') {
        await bot.answerCallbackQuery(callbackQuery.id);
        const theme = readSettings().defaultTheme;
        executePipeline('pm', chatId, theme);

      } else if (action === 'menu_select_theme') {
        await bot.answerCallbackQuery(callbackQuery.id);
        await showThemeSelector(chatId);

      } else if (action === 'menu_review_pending') {
        await bot.answerCallbackQuery(callbackQuery.id);
        await showCurationWorkspace(chatId);

      } else if (action === 'menu_status') {
        await bot.answerCallbackQuery(callbackQuery.id);
        await showSystemStatus(chatId);

      } else if (action === 'menu_archives') {
        await bot.answerCallbackQuery(callbackQuery.id);
        await showRunHistory(chatId);
      }
    } catch (err) {
      console.error(err);
      await bot.sendMessage(chatId, `🚨 *Bot Callback Action Error*: ${err.message}`);
    }
  });
}

// Unified pipeline trigger
async function executePipeline(timeSlot, chatId, theme = 'default') {
  try {
    const isManualWeb = chatId === 'manual-trigger';
    if (!isManualWeb && bot) {
      await bot.sendMessage(chatId, `🤖 <b>Starting Carousel Pipeline</b> for slot: <b>${escapeHtml(timeSlot.toUpperCase())}</b>...`, { parse_mode: 'HTML' });
    }

    // 1. Scrape & Rank
    const stories = await scrapeTrending(timeSlot);
    if (stories.length === 0) {
      if (!isManualWeb && bot) {
        await bot.sendMessage(chatId, `⚠️ No stories found matching the ${timeSlot.toUpperCase()} slot window.`);
      }
      return;
    }

    // 2. Cache run angles in db for regeneration
    const runId = `run-${Date.now()}`;
    const db = await readDb();
    db.current_run = {
      runId,
      timeSlot,
      angles: stories,
      currentAngleIndex: 0,
      chatId,
      theme
    };
    await writeDb(db);

    // 3. Generate copy for Slide 1 (Angle #1) using fallback helper
    if (!isManualWeb && bot) {
      await bot.sendMessage(chatId, `✍ <b>Angle #1 Selected</b>:\n"${escapeHtml(stories[0].title)}"\nGenerating copy via Gemini/Nvidia...`, { parse_mode: 'HTML' });
    }
    const slidesData = await getSlidesContent(stories[0], timeSlot);
    slidesData.theme = theme;

    // 4. Render to PNGs
    if (!isManualWeb && bot) {
      await bot.sendMessage(chatId, `🎨 Rendering 5 slides to high-DPI PNGs via Puppeteer...`);
    }
    const renderResult = await renderCarouselPngs(slidesData);

    // Add pending history entry
    await addHistoryEntry({
      id: runId,
      timeSlot,
      status: 'pending',
      angle: {
        ...stories[0],
        pdfPath: renderResult.pdfPath
      },
      slides: slidesData.slides,
      imagePaths: renderResult.imagePaths,
      linkedin_post: slidesData.linkedin_post,
      theme
    });

    // 5. Send images to Telegram
    if (!isManualWeb && bot) {
      await bot.sendMessage(chatId, `📤 Sending carousel images to Telegram...`);
      const media = renderResult.imagePaths.map((filePath, index) => ({
        type: 'photo',
        media: fs.createReadStream(filePath),
        caption: index === 0 ? `🎯 <b>Hook Headline</b>: ${escapeHtml(slidesData.slides[0].headline)}\n\n📖 <b>Story Title</b>: ${escapeHtml(stories[0].title)}\n🔗 <b>Source</b>: ${escapeHtml(stories[0].url)}` : undefined,
        parse_mode: index === 0 ? 'HTML' : undefined
      }));

      await bot.sendMediaGroup(chatId, media);

      // Send the LinkedIn post text copy block
      await bot.sendMessage(chatId, `📝 <b>Copy-pasteable LinkedIn Post Caption</b>:\n\n<pre>${escapeHtml(slidesData.linkedin_post)}</pre>`, { parse_mode: 'HTML' });

      // 6. Send follow-up inline action keyboard
      const opts = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approve', callback_data: `approve_${runId}` },
              { text: '🔄 Regenerate', callback_data: `regen_${runId}` },
              { text: '❌ Reject', callback_data: `reject_${runId}` }
            ]
          ]
        }
      };
      await bot.sendMessage(chatId, `Actions for Carousel (${runId}):`, opts);
    }

    console.log(`Pipeline successfully executed and pending approval for runId: ${runId}`);

  } catch (error) {
    console.error('Pipeline execution failed:', error);
    if (chatId && chatId !== 'manual-trigger' && bot) {
      try {
        await bot.sendMessage(chatId, `🚨 <b>Pipeline Failure Alert!</b>\n\n<b>Error</b>: ${escapeHtml(error.message)}\n<b>Timestamp</b>: ${escapeHtml(new Date().toLocaleString())}`, { parse_mode: 'HTML' });
      } catch (tgSendErr) {
        console.error('Failed to send pipeline failure alert to Telegram:', tgSendErr.message);
      }
    }
  }
}

// Scheduler Configuration (Asia/Kolkata timezone)
if (!token || !defaultChatId) {
  console.warn('⚠️ Warning: Scheduler is inactive because TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing.');
} else {
  // Morning cron: 08:00 AM IST
  cron.schedule('0 8 * * *', () => {
    console.log('Scheduled trigger activated: AM Run (08:00 IST)');
    const theme = readSettings().defaultTheme;
    executePipeline('am', defaultChatId, theme);
  }, {
    timezone: 'Asia/Kolkata'
  });

  // Evening cron: 08:00 PM IST
  cron.schedule('0 20 * * *', () => {
    console.log('Scheduled trigger activated: PM Run (20:00 IST)');
    const theme = readSettings().defaultTheme;
    executePipeline('pm', defaultChatId, theme);
  }, {
    timezone: 'Asia/Kolkata'
  });

  console.log('Asia/Kolkata Scheduler initialized for 08:00 AM and 08:00 PM daily runs.');
}

// Database/Storage Cleanup Cron: Runs every day at 12:00 AM Midnight IST
// Automatically deletes history entries and Supabase Storage files older than 7 days
cron.schedule('0 0 * * *', () => {
  console.log('Daily database and storage cleanup cron triggered...');
  cleanupOldHistoryEntries().catch(console.error);
}, {
  timezone: 'Asia/Kolkata'
});

// Run initial cleanup check immediately on server startup
cleanupOldHistoryEntries().catch(console.error);

// ==========================================
// EXPRESS HTTP WEB DASHBOARD SERVER
// ==========================================

const app = express();
app.use(express.json());

// Serve rendered images from dist/ directory (static folder lookup mapping)
const distDir = path.join(__dirname, '../dist');
app.use('/dist', express.static(distDir));

// Serve frontend static assets from public/ directory
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));

// Serve templates static assets from templates/ directory (for live preview slide.css)
const templatesDir = path.join(__dirname, '../templates');
app.use('/templates', express.static(templatesDir));

// API: System Status
app.get('/api/status', async (req, res) => {
  const db = await readDb();
  const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false };
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const istTimeStr = formatter.format(new Date());

  res.json({
    status: 'online',
    timeZone: 'Asia/Kolkata',
    serverTimeIst: istTimeStr,
    botConfigured: !!token,
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    nvidiaConfigured: !!process.env.NVIDIA_API_KEY,
    chatConfigured: !!defaultChatId,
    cronSchedule: {
      am: '08:00 AM IST',
      pm: '08:00 PM IST'
    },
    activeRun: db.current_run || null
  });
});

// API: Run History & KPI Stats
app.get('/api/history', async (req, res) => {
  const db = await readDb();
  const history = db.history || [];

  // Calculate analytics
  const total = history.length;
  const approved = history.filter(h => h.status === 'approved').length;
  const rejected = history.filter(h => h.status === 'rejected').length;
  const pending = history.filter(h => h.status === 'pending').length;
  const approvalRate = total > 0 ? ((approved / (approved + rejected || 1)) * 100).toFixed(0) : '0';

  res.json({
    history: history.slice().reverse(), // Deliver reverse chronological order
    stats: {
      total,
      approved,
      rejected,
      pending,
      approvalRate
    }
  });
});

// API: Trigger Pipeline Manually
app.post('/api/trigger', (req, res) => {
  const { slot, theme } = req.body;
  const targetSlot = slot === 'pm' ? 'pm' : 'am';
  const targetTheme = theme || 'default';

  // Trigger pipeline asynchronously (manual-trigger flag bypasses TG messages)
  executePipeline(targetSlot, 'manual-trigger', targetTheme).catch(console.error);

  res.json({
    success: true,
    message: `Pipeline successfully triggered for ${targetSlot.toUpperCase()} slot with theme ${targetTheme}.`
  });
});

// API: Generate Custom Topic
app.post('/api/generate-custom', async (req, res) => {
  const { topic, theme } = req.body;
  if (!topic) {
    return res.status(400).json({ error: 'Topic prompt is required.' });
  }

  const targetTheme = theme || 'default';
  const runId = `run-custom-${Date.now()}`;
  
  // Respond immediately that generation started
  res.json({
    success: true,
    runId,
    message: `Started custom generation for topic: "${topic}".`
  });

  // Run generation asynchronously using reusable helper
  executeCustomGeneration(topic, targetTheme, 'manual-trigger').catch(console.error);
});

// API: Curation Action Panel (Approve/Reject/Regenerate)
app.post('/api/action', async (req, res) => {
  const { action, runId, slides, linkedin_post } = req.body;

  if (!action || !runId) {
    return res.status(400).json({ error: 'Missing action or runId in request body.' });
  }

  try {
    let result;
    if (action === 'approve') {
      result = await approveRun(runId, slides, linkedin_post);
    } else if (action === 'reject') {
      result = await rejectRun(runId);
    } else if (action === 'regen') {
      result = await regenerateRun(runId);
    } else {
      return res.status(400).json({ error: `Invalid action type: ${action}` });
    }

    res.json({ success: true, result });
  } catch (err) {
    console.error(`API action error [${action}]:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// API: Delete Carousel Run
app.delete('/api/carousel/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const success = await deleteHistoryEntry(id);
    if (success) {
      res.json({ success: true, message: `Successfully deleted carousel ${id}` });
    } else {
      res.status(500).json({ error: `Failed to delete carousel ${id}` });
    }
  } catch (err) {
    console.error(`API delete error [${id}]:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Start Web Dashboard listening
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`Carousel Forge Web Dashboard running at:`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`====================================================`);
});
