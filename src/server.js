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
import { readDb, writeDb, addHistoryEntry, updateHistoryStatus, initDb } from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Initialize local JSON database
initDb();

// Helper to provide mockup slide data if API key is missing
async function getSlidesContent(story, timeSlot) {
  if (!process.env.GEMINI_API_KEY) {
    console.log('No GEMINI_API_KEY detected. Using mockup slides content fallback...');

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

export async function approveRun(runId) {
  const db = readDb();
  const entryIndex = db.history.findIndex(h => h.id === runId && h.status === 'pending');

  if (entryIndex === -1) {
    const alreadyDone = db.history.find(h => h.id === runId);
    if (alreadyDone) {
      return { status: alreadyDone.status, message: `Carousel was already ${alreadyDone.status}` };
    }
    throw new Error('Pending run not found in history.');
  }

  const entry = db.history[entryIndex];
  const approvedDir = path.join(__dirname, `../dist/approved/run-${runId}`);
  fs.mkdirSync(approvedDir, { recursive: true });

  // Copy PNGs to output approved directory
  const newPaths = [];
  for (const oldPath of entry.imagePaths) {
    const baseName = path.basename(oldPath);
    const newPath = path.join(approvedDir, baseName);
    fs.copyFileSync(oldPath, newPath);
    newPaths.push(newPath);
  }

  // Update history entry status
  updateHistoryStatus(runId, 'approved', { imagePaths: newPaths });
  return { status: 'approved', approvedDir };
}

export async function rejectRun(runId) {
  const db = readDb();
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
  updateHistoryStatus(runId, 'rejected');

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
  const db = readDb();
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
  writeDb(db);

  const story = currentRun.angles[nextIndex];

  // Generate copy using fallback helper
  const slidesData = await getSlidesContent(story, currentRun.timeSlot);

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
  const freshDb = readDb();
  freshDb.history = freshDb.history.filter(h => h.id !== runId);
  writeDb(freshDb);

  // Add fresh pending entry
  addHistoryEntry({
    id: runId,
    timeSlot: currentRun.timeSlot,
    status: 'pending',
    angle: story,
    slides: slidesData.slides,
    imagePaths: renderResult.imagePaths,
    linkedin_post: slidesData.linkedin_post
  });

  // Sync back to Telegram if chatbot is enabled and running
  if (bot && currentRun.chatId && currentRun.chatId !== 'manual-trigger') {
    try {
      const media = renderResult.imagePaths.map((filePath, index) => ({
        type: 'photo',
        media: fs.createReadStream(filePath),
        caption: index === 0 ? `🔄 *Regenerated Slide (Angle #${nextIndex + 1})*\n\n🎯 *Hook Headline*: ${slidesData.slides[0].headline}\n\n📖 *Story*: ${story.title}\n🔗 *Source*: ${story.url}` : undefined,
        parse_mode: index === 0 ? 'Markdown' : undefined
      }));
      await bot.sendMediaGroup(currentRun.chatId, media);

      // Send the LinkedIn post text copy block
      const escapedPost = slidesData.linkedin_post.replace(/`/g, '\\`');
      await bot.sendMessage(currentRun.chatId, `🔄 *New LinkedIn Post Caption (Angle #${nextIndex + 1})*:\n\n\`\`\`\n${escapedPost}\n\`\`\``, { parse_mode: 'Markdown' });

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
// TELEGRAM BOT COMMAND HANDLERS
// ==========================================

if (bot) {
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, `👋 Hello! I am the *AI/Tech Carousel Generator Bot*.\n\nUse /help to view available commands.`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const helpMessage = `
🤖 *Bot Command Reference*:
/generate am - Trigger carousel generation using yesterday's stories.
/generate pm - Trigger carousel generation using today's stories.
/status - Check the bot and scheduler status.
/history - View the last 7 carousels and their approval status.
/help - Show this reference details.
    `;
    await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const db = readDb();
    const approvedCount = db.history.filter(h => h.status === 'approved').length;

    const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false };
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const istTimeStr = formatter.format(new Date());

    const statusMessage = `
🟢 *System Status*:
• *Bot Uptime*: Operational
• *Timezone*: Asia/Kolkata (IST)
• *Current Server Time (IST)*: \`${istTimeStr}\`
• *Approved Carousels*: \`${approvedCount}\`
• *Daily Runs Schedule*:
  - AM run: 08:00 AM IST (Yesterday's stories)
  - PM run: 08:00 PM IST (Today's stories)
    `;
    await bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/history/, async (msg) => {
    const chatId = msg.chat.id;
    const db = readDb();
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

    executePipeline(slot, chatId);
  });

  // Inline Callback Keyboard Handler
  bot.on('callback_query', async (callbackQuery) => {
    const action = callbackQuery.data;
    const message = callbackQuery.message;
    const chatId = message.chat.id;

    try {
      if (action.startsWith('approve_')) {
        const runId = action.replace('approve_', '');
        await approveRun(runId);

        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Carousel approved!' });
        await bot.editMessageText(`Carousel (${runId}) Approved ✅\n\n📁 Saved to output: \`dist/approved/run-${runId}\``, {
          chat_id: chatId,
          message_id: message.message_id,
          parse_mode: 'Markdown'
        });

      } else if (action.startsWith('reject_')) {
        const runId = action.replace('reject_', '');
        await rejectRun(runId);

        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Carousel rejected.' });
        await bot.editMessageText(`Carousel (${runId}) Rejected ❌\nTemporary files cleaned up.`, { chat_id: chatId, message_id: message.message_id });

      } else if (action.startsWith('regen_')) {
        const runId = action.replace('regen_', '');
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Regenerating carousel...' });
        await bot.editMessageText(`Carousel (${runId}) - Regenerating using Angle #${readDb().current_run.currentAngleIndex + 2}...`, { chat_id: chatId, message_id: message.message_id });

        await regenerateRun(runId);
      }
    } catch (err) {
      console.error(err);
      await bot.sendMessage(chatId, `🚨 *Bot Callback Action Error*: ${err.message}`);
    }
  });
}

// Unified pipeline trigger
async function executePipeline(timeSlot, chatId) {
  try {
    const isManualWeb = chatId === 'manual-trigger';
    if (!isManualWeb && bot) {
      await bot.sendMessage(chatId, `🤖 *Starting Carousel Pipeline* for slot: *${timeSlot.toUpperCase()}*...`, { parse_mode: 'Markdown' });
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
    const db = readDb();
    db.current_run = {
      runId,
      timeSlot,
      angles: stories,
      currentAngleIndex: 0,
      chatId
    };
    writeDb(db);

    // 3. Generate copy for Slide 1 (Angle #1) using fallback helper
    if (!isManualWeb && bot) {
      await bot.sendMessage(chatId, `✍ *Angle #1 Selected*:\n"${stories[0].title}"\nGenerating copy via Gemini/Nvidia...`, { parse_mode: 'Markdown' });
    }
    const slidesData = await getSlidesContent(stories[0], timeSlot);

    // 4. Render to PNGs
    if (!isManualWeb && bot) {
      await bot.sendMessage(chatId, `🎨 Rendering 5 slides to high-DPI PNGs via Puppeteer...`);
    }
    const renderResult = await renderCarouselPngs(slidesData);

    // Add pending history entry
    addHistoryEntry({
      id: runId,
      timeSlot,
      status: 'pending',
      angle: stories[0],
      slides: slidesData.slides,
      imagePaths: renderResult.imagePaths,
      linkedin_post: slidesData.linkedin_post
    });

    // 5. Send images to Telegram
    if (!isManualWeb && bot) {
      await bot.sendMessage(chatId, `📤 Sending carousel images to Telegram...`);
      const media = renderResult.imagePaths.map((filePath, index) => ({
        type: 'photo',
        media: fs.createReadStream(filePath),
        caption: index === 0 ? `🎯 *Hook Headline*: ${slidesData.slides[0].headline}\n\n📖 *Story Title*: ${stories[0].title}\n🔗 *Source*: ${stories[0].url}` : undefined,
        parse_mode: index === 0 ? 'Markdown' : undefined
      }));

      await bot.sendMediaGroup(chatId, media);

      // Send the LinkedIn post text copy block
      const escapedPost = slidesData.linkedin_post.replace(/`/g, '\\`');
      await bot.sendMessage(chatId, `📝 *Copy-pasteable LinkedIn Post Caption*:\n\n\`\`\`\n${escapedPost}\n\`\`\``, { parse_mode: 'Markdown' });

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
      await bot.sendMessage(chatId, `🚨 *Pipeline Failure Alert!*\n\n*Error*: ${error.message}\n*Timestamp*: ${new Date().toLocaleString()}`, { parse_mode: 'Markdown' });
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
    executePipeline('am', defaultChatId);
  }, {
    timezone: 'Asia/Kolkata'
  });

  // Evening cron: 08:00 PM IST
  cron.schedule('0 20 * * *', () => {
    console.log('Scheduled trigger activated: PM Run (20:00 IST)');
    executePipeline('pm', defaultChatId);
  }, {
    timezone: 'Asia/Kolkata'
  });

  console.log('Asia/Kolkata Scheduler initialized for 08:00 AM and 08:00 PM daily runs.');
}

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

// API: System Status
app.get('/api/status', (req, res) => {
  const db = readDb();
  const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false };
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const istTimeStr = formatter.format(new Date());

  res.json({
    status: 'online',
    timeZone: 'Asia/Kolkata',
    serverTimeIst: istTimeStr,
    botConfigured: !!token,
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    chatConfigured: !!defaultChatId,
    cronSchedule: {
      am: '08:00 AM IST',
      pm: '08:00 PM IST'
    },
    activeRun: db.current_run || null
  });
});

// API: Run History & KPI Stats
app.get('/api/history', (req, res) => {
  const db = readDb();
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
  const { slot } = req.body;
  const targetSlot = slot === 'pm' ? 'pm' : 'am';

  // Trigger pipeline asynchronously (manual-trigger flag bypasses TG messages)
  executePipeline(targetSlot, 'manual-trigger').catch(console.error);

  res.json({
    success: true,
    message: `Pipeline successfully triggered for ${targetSlot.toUpperCase()} slot.`
  });
});

// API: Curation Action Panel (Approve/Reject/Regenerate)
app.post('/api/action', async (req, res) => {
  const { action, runId } = req.body;

  if (!action || !runId) {
    return res.status(400).json({ error: 'Missing action or runId in request body.' });
  }

  try {
    let result;
    if (action === 'approve') {
      result = await approveRun(runId);
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

// Start Web Dashboard listening
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`Carousel Forge Web Dashboard running at:`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`====================================================`);
});
