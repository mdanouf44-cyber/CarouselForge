import fs from 'fs';
import path from 'path';

export async function sendPdfToTelegram(pdfPath) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('Warning: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing. Skipping Telegram upload.');
    return false;
  }

  console.log(`Sending PDF to Telegram chat ${chatId}...`);

  try {
    const fileBuffer = fs.readFileSync(pdfPath);
    const fileName = path.basename(pdfPath);
    
    // Create a Blob from the file buffer (required for native FormData in Node 20)
    const fileBlob = new Blob([fileBuffer], { type: 'application/pdf' });

    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('document', fileBlob, fileName);
    formData.append('caption', '⚡ Here is your fresh AI/Tech LinkedIn Carousel PDF! Drag & drop this file directly into LinkedIn to post.');

    const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: formData
    });

    const result = await response.json();
    if (result.ok) {
      console.log('PDF successfully delivered to Telegram!');
      return true;
    } else {
      console.error('Telegram API returned an error:', result.description);
      return false;
    }
  } catch (error) {
    console.error('Error sending document to Telegram:', error.message);
    return false;
  }
}
