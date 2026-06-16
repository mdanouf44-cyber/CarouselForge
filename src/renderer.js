import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to find Chrome or Edge executable on Windows
function findChromeExecutable() {
  if (process.platform !== 'win32') {
    const linuxPaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ];
    for (const p of linuxPaths) {
      if (fs.existsSync(p)) return p;
    }
    return null; // fall back to default puppeteer behavior
  }

  const userProfile = process.env.USERPROFILE || 'C:\\Users\\Default';
  const windowsPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(userProfile, 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
    path.join(userProfile, 'AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe')
  ];

  for (const p of windowsPaths) {
    if (fs.existsSync(p)) {
      console.log(`Auto-detected browser executable at: ${p}`);
      return p;
    }
  }

  throw new Error('Could not find Google Chrome or Microsoft Edge installed on your Windows machine. Please install Chrome or specify custom path.');
}

// Generate the HTML for slides dynamically based on the AI output
function buildSlidesHtml(slidesData, brandHandle, authorName) {
  return slidesData.slides.map((slide, index) => {
    const slideNumStr = String(slide.slide_number).padStart(2, '0');

    // Theme rules:
    // Slides 1 (index 0), 2 (index 1), 5 (index 4) are Dark
    // Slides 3 (index 2), 4 (index 3) are Light
    const isDark = index === 0 || index === 1 || index === 4;
    const themeClass = isDark ? 'slide-theme-dark' : 'slide-theme-light';

    // Outro slide (index 4) specific layout tweaks
    const isOutro = index === 4;
    const accentBarClass = isOutro ? 'accent-bar-top' : 'accent-bar-bottom';
    const contentAreaClass = isOutro ? 'slide-content-area-outro' : '';
    const titleClass = isOutro || index === 0 ? 'slide-title-large' : 'slide-title-body';
    
    // Bottom-right icon: Arrow for slides 1-4, purple heart for slide 5
    const footerIconText = isOutro ? '💜' : '&rarr;';
    const footerIconClass = isOutro ? 'footer-icon-heart' : '';

    // Extract title and text content
    let titleText = '';
    let bodyText = '';

    if (index === 0) {
      // Intro
      titleText = slide.headline || '';
      bodyText = slide.subheadline || '';
    } else if (isOutro) {
      // Outro
      titleText = slide.headline || 'THANK YOU!';
      bodyText = slide.subheadline || '';
    } else {
      // Content Slides
      titleText = slide.title || '';
      bodyText = slide.content || '';
    }

    return `
      <div class="slide ${themeClass}">
        <div class="slide-header">
          <div class="brand-handle">${brandHandle}</div>
          <div class="slide-number">${slideNumStr}</div>
        </div>
        <div class="accent-bar ${accentBarClass}"></div>
        <div class="slide-content-area ${contentAreaClass}">
          <h1 class="${titleClass}">${titleText}</h1>
          <p class="slide-paragraph">${bodyText}</p>
        </div>
        <div class="slide-footer">
          <div class="footer-author">${authorName}</div>
          <div class="footer-icon ${footerIconClass}">${footerIconText}</div>
        </div>
      </div>
    `;
  }).join('\n');
}

export async function renderCarouselPngs(slidesData) {
  console.log('Rendering carousel slides to PNGs...');

  const brandHandle = process.env.BRAND_HANDLE || 'www.linkedin.com/in/mohammad-anouf-saani';
  const authorName = process.env.BRAND_AUTHOR_NAME || 'Mohammad Anouf Saani';

  // Read the base HTML template
  const templatePath = path.join(__dirname, '../templates/slide.html');
  let html = fs.readFileSync(templatePath, 'utf-8');

  // Build the slides HTML and inject it
  const slidesContentHtml = buildSlidesHtml(slidesData, brandHandle, authorName);
  html = html.replace('{{SLIDES_CONTENT}}', slidesContentHtml);

  // Inject brand visual variables from .env
  html = html.replace('{{BRAND_BACKGROUND}}', process.env.BRAND_BACKGROUND || '#0F0F1A');
  html = html.replace('{{BRAND_TEXT_PRIMARY}}', process.env.BRAND_TEXT_PRIMARY || '#F9FAFB');
  html = html.replace('{{BRAND_TEXT_SECONDARY}}', process.env.BRAND_TEXT_SECONDARY || '#9CA3AF');
  html = html.replace('{{BRAND_ACCENT}}', process.env.BRAND_ACCENT || '#6366F1');
  html = html.replace('{{BRAND_SECONDARY}}', process.env.BRAND_SECONDARY || '#EC4899');
  html = html.replace('{{BRAND_CARD_BG}}', process.env.BRAND_CARD_BG || '#1E1E2E');

  // Write temporary file for Puppeteer
  const tempHtmlPath = path.join(__dirname, '../templates/temp_slide_render.html');
  fs.writeFileSync(tempHtmlPath, html, 'utf-8');

  let browser;
  try {
    const launchOptions = {
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    };

    // Auto-detect system Chrome/Edge path
    const chromePath = findChromeExecutable();
    if (chromePath) {
      launchOptions.executablePath = chromePath;
    }

    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    // Set viewport to square (1080x1080px) with high DPI scale
    await page.setViewport({
      width: 1080,
      height: 1080,
      deviceScaleFactor: 2 // yields sharp, crisp images for LinkedIn
    });

    // Load the local HTML file
    const fileUrl = `file://${path.resolve(tempHtmlPath)}`;
    await page.goto(fileUrl, { waitUntil: 'networkidle0' });

    // Output directory for this run
    const runId = `run-${Date.now()}`;
    const runDir = path.join(__dirname, `../dist/runs/${runId}`);
    if (!fs.existsSync(runDir)) {
      fs.mkdirSync(runDir, { recursive: true });
    }

    // Find all slide elements and take screenshots
    const slides = await page.$$('.slide');
    const imagePaths = [];

    for (let i = 0; i < slides.length; i++) {
      const slidePath = path.join(runDir, `slide-${i + 1}.png`);
      await slides[i].screenshot({
        path: slidePath,
        type: 'png'
      });
      imagePaths.push(slidePath);
    }

    console.log(`Carousel PNGs rendered successfully in: ${runDir}`);
    return {
      runId,
      runDir,
      imagePaths
    };
  } catch (error) {
    console.error('Error rendering PNGs with Puppeteer:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
    // Clean up temporary HTML file
    if (fs.existsSync(tempHtmlPath)) {
      fs.unlinkSync(tempHtmlPath);
    }
  }
}
