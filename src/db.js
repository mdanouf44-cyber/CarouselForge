import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import ws from 'ws';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;

if (supabaseUrl && supabaseAnonKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false
      },
      realtime: {
        transport: ws
      }
    });
    console.log('Supabase Database client initialized successfully.');
  } catch (err) {
    console.error('Failed to initialize Supabase client:', err.message);
  }
} else {
  console.error('❌ Error: SUPABASE_URL or SUPABASE_ANON_KEY is missing in your .env file.');
}

// Helper to upload a local file to Supabase Storage and get its public URL
export async function uploadImageToStorage(localFilePath, runId, slideName) {
  if (!supabase) return null;

  try {
    const fileBuffer = fs.readFileSync(localFilePath);
    // Use standard forward slashes for path in storage bucket
    const storagePath = `${runId}/${slideName}`;

    // Upload to Supabase Storage bucket
    const { data, error } = await supabase.storage
      .from('carousel-images')
      .upload(storagePath, fileBuffer, {
        contentType: slideName.endsWith('.pdf') ? 'application/pdf' : 'image/png',
        upsert: true
      });

    if (error) {
      console.error(`Error uploading ${slideName} to Supabase Storage:`, error.message);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('carousel-images')
      .getPublicUrl(storagePath);

    return urlData?.publicUrl || null;
  } catch (err) {
    console.error(`Failed to upload local file ${localFilePath} to Supabase Storage:`, err.message);
    return null;
  }
}

// Check connection and log status
export async function initDb() {
  if (!supabase) {
    console.warn('⚠️ Warning: Supabase client is not initialized. Database operations will fail.');
    return false;
  }
  
  try {
    // Check if the table exists by selecting 1 row. Using limit(1) instead of single()
    // prevents errors when the table exists but contains 0 rows.
    const { data, error } = await supabase
      .from('current_run')
      .select('id')
      .limit(1);

    if (error) {
      console.error('Failed to query Supabase (check if tables exist):', error.message);
      return false;
    }
    
    console.log('Successfully connected to Supabase Database.');
    return true;
  } catch (err) {
    console.error('Database connection test failed:', err.message);
    return false;
  }
}

// Read database states
export async function readDb() {
  if (!supabase) return { history: [], cache: {} };

  try {
    // 1. Fetch history sorted by timestamp ascending
    const { data: historyData, error: historyErr } = await supabase
      .from('carousel_history')
      .select('*')
      .order('timestamp', { ascending: true });
       
    if (historyErr) {
      console.error('Error reading history from Supabase:', historyErr.message);
    }

    // 2. Fetch current active run state. Using select().eq() instead of single()
    // gracefully returns an empty list instead of throwing an error when 0 rows exist.
    const { data: runDataList, error: runErr } = await supabase
      .from('current_run')
      .select('*')
      .eq('id', 1);

    if (runErr) {
      console.error('Error reading current_run from Supabase:', runErr.message);
    }

    const runData = runDataList && runDataList.length > 0 ? runDataList[0] : null;

    // Map database fields to application shape
    return {
      history: (historyData || []).map(h => ({
        id: h.id,
        timestamp: h.timestamp ? new Date(h.timestamp).getTime() : Date.now(),
        timeSlot: h.time_slot,
        status: h.status,
        angle: h.angle,
        slides: h.slides,
        imagePaths: h.image_paths || [],
        linkedin_post: h.linkedin_post,
        theme: h.theme || 'default'
      })),
      current_run: runData && runData.run_id ? {
        runId: runData.run_id,
        timeSlot: runData.time_slot,
        angles: runData.angles,
        currentAngleIndex: runData.current_angle_index,
        chatId: runData.chat_id,
        theme: runData.theme || 'default'
      } : null
    };
  } catch (err) {
    console.error('Failed to read from Supabase:', err.message);
    return { history: [], cache: {} };
  }
}

// Write active run state
export async function writeDb(data) {
  if (!supabase) return;

  try {
    const run = data.current_run;
    if (!run) {
      // Clear active run state. We use upsert so that it works even if the row with ID 1
      // was never seeded.
      const { error } = await supabase
        .from('current_run')
        .upsert({
          id: 1,
          run_id: null,
          time_slot: null,
          angles: null,
          current_angle_index: 0,
          chat_id: null,
          updated_at: new Date()
        });
      
      if (error) console.error('Error clearing active run:', error.message);
      return;
    }

    // Use upsert to create or update the row with ID 1
    const { error } = await supabase
      .from('current_run')
      .upsert({
        id: 1,
        run_id: run.runId,
        time_slot: run.timeSlot,
        angles: run.angles,
        current_angle_index: run.currentAngleIndex,
        chat_id: run.chatId,
        theme: run.theme || 'default',
        updated_at: new Date()
      });

    if (error) {
      console.error('Error updating active run in Supabase:', error.message);
    }
  } catch (err) {
    console.error('Failed to write active run state to Supabase:', err.message);
  }
}

// Add a generated run entry to history
export async function addHistoryEntry(entry) {
  if (!supabase) return;

  try {
    const runId = entry.id || `run-${Date.now()}`;
    const remoteUrls = [];
    
    // Upload PDF to Supabase Storage and store public URL in angle metadata
    if (entry.angle && entry.angle.pdfPath) {
      console.log(`[Database] Uploading vector PDF to Supabase Storage...`);
      const localPdfPath = entry.angle.pdfPath;
      const pdfFileName = path.basename(localPdfPath);
      const publicPdfUrl = await uploadImageToStorage(localPdfPath, runId, pdfFileName);
      if (publicPdfUrl) {
        entry.angle.pdfUrl = publicPdfUrl;
      } else {
        entry.angle.pdfUrl = `/dist/runs/${runId}/${pdfFileName}`;
      }
    }

    // Upload slide images to Supabase Storage and get public URLs
    if (entry.imagePaths && entry.imagePaths.length > 0) {
      console.log(`[Database] Uploading ${entry.imagePaths.length} slide images to Supabase Storage...`);
      for (let i = 0; i < entry.imagePaths.length; i++) {
        const localPath = entry.imagePaths[i];
        const fileName = path.basename(localPath);
        const publicUrl = await uploadImageToStorage(localPath, runId, fileName);
        if (publicUrl) {
          remoteUrls.push(publicUrl);
        } else {
          remoteUrls.push(localPath);
        }
      }
    }

    const { error } = await supabase
      .from('carousel_history')
      .upsert({
        id: runId,
        time_slot: entry.timeSlot,
        status: entry.status,
        angle: entry.angle,
        slides: entry.slides,
        image_paths: remoteUrls,
        linkedin_post: entry.linkedin_post || '',
        theme: entry.theme || 'default',
        timestamp: new Date()
      });

    if (error) {
      console.error('Error adding history entry to Supabase:', error.message);
    }
  } catch (err) {
    console.error('Failed to insert history entry to Supabase:', err.message);
  }
}

// Get history list
export async function getHistory() {
  const db = await readDb();
  return db.history;
}

// Update the curation status of a run
export async function updateHistoryStatus(id, status, extraFields = {}) {
  if (!supabase) return false;

  try {
    const updateData = { status };
    
    // Map Javascript camelCase property to Postgres snake_case field
    if (extraFields.imagePaths) {
      const remoteUrls = [];
      console.log(`[Database] Uploading ${extraFields.imagePaths.length} approved slide images to Supabase Storage...`);
      for (let i = 0; i < extraFields.imagePaths.length; i++) {
        const localPath = extraFields.imagePaths[i];
        if (localPath.startsWith('http://') || localPath.startsWith('https://')) {
          // Already a remote URL
          remoteUrls.push(localPath);
        } else {
          // Upload local file to storage
          const fileName = path.basename(localPath);
          const publicUrl = await uploadImageToStorage(localPath, id, fileName);
          if (publicUrl) {
            remoteUrls.push(publicUrl);
          } else {
            remoteUrls.push(localPath);
          }
        }
      }
      updateData.image_paths = remoteUrls;
    }
    if (extraFields.linkedin_post) {
      updateData.linkedin_post = extraFields.linkedin_post;
    }
    if (extraFields.slides) {
      updateData.slides = extraFields.slides;
    }
    if (extraFields.theme) {
      updateData.theme = extraFields.theme;
    }
    if (extraFields.angle) {
      if (extraFields.angle.pdfPath) {
        const localPdfPath = extraFields.angle.pdfPath;
        const pdfFileName = path.basename(localPdfPath);
        const publicPdfUrl = await uploadImageToStorage(localPdfPath, id, pdfFileName);
        extraFields.angle.pdfUrl = publicPdfUrl || `/dist/approved/run-${id}/${pdfFileName}`;
      }
      updateData.angle = extraFields.angle;
    }

    const { error } = await supabase
      .from('carousel_history')
      .update(updateData)
      .eq('id', id);

    if (error) {
      console.error(`Error updating status for ${id} in Supabase:`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Failed to update status in Supabase for run ${id}:`, err.message);
    return false;
  }
}

export async function deleteHistoryEntry(runId) {
  if (!supabase) return false;

  try {
    console.log(`[Delete] Manually deleting history entry and files for run: ${runId}`);
    
    // Fetch the entry to check for local / remote image paths
    const { data: entryData, error: fetchErr } = await supabase
      .from('carousel_history')
      .select('image_paths')
      .eq('id', runId)
      .limit(1);

    if (fetchErr) {
      console.error(`[Delete] Failed to fetch entry ${runId}:`, fetchErr.message);
    }

    // 1. Delete files in Supabase Storage bucket for this run
    const { data: files, error: listErr } = await supabase.storage
      .from('carousel-images')
      .list(runId);
      
    if (listErr) {
      console.error(`[Delete] Failed to list files for storage folder ${runId}:`, listErr.message);
    } else if (files && files.length > 0) {
      const filesToRemove = files.map(file => `${runId}/${file.name}`);
      console.log(`[Delete] Removing ${filesToRemove.length} images from Supabase Storage for run ${runId}...`);
      const { error: removeErr } = await supabase.storage
        .from('carousel-images')
        .remove(filesToRemove);
        
      if (removeErr) {
        console.error(`[Delete] Failed to remove files for folder ${runId}:`, removeErr.message);
      }
    }
    
    // Clean up local dist files if they exist (just in case they are local file paths)
    if (entryData && entryData.length > 0 && entryData[0].image_paths && entryData[0].image_paths.length > 0) {
      const firstPath = entryData[0].image_paths[0];
      if (firstPath && !firstPath.startsWith('http://') && !firstPath.startsWith('https://')) {
        const runDir = path.dirname(firstPath);
        try {
          if (fs.existsSync(runDir)) {
            fs.rmSync(runDir, { recursive: true, force: true });
            console.log(`[Delete] Cleaned up local directory: ${runDir}`);
          }
        } catch (localErr) {
          console.warn(`[Delete] Failed to remove local run directory ${runDir}:`, localErr.message);
        }
      }
    }
    
    // 2. Delete database entry
    const { error: deleteErr } = await supabase
      .from('carousel_history')
      .delete()
      .eq('id', runId);
      
    if (deleteErr) {
      console.error(`[Delete] Failed to delete database history entry ${runId}:`, deleteErr.message);
      return false;
    } else {
      console.log(`[Delete] Successfully deleted history entry ${runId} from database.`);
      return true;
    }
  } catch (err) {
    console.error(`[Delete] Error during manual history entry deletion:`, err.message);
    return false;
  }
}

// Automatically clean up history entries and storage files older than 7 days
export async function cleanupOldHistoryEntries() {
  if (!supabase) return;
  
  try {
    console.log('[Cleanup] Running weekly database and storage cleanup check...');
    
    // Calculate date threshold (7 days ago)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    // Fetch entries older than 7 days
    const { data: oldEntries, error: fetchErr } = await supabase
      .from('carousel_history')
      .select('id, image_paths')
      .lt('timestamp', sevenDaysAgo.toISOString());
      
    if (fetchErr) {
      console.error('[Cleanup] Failed to fetch old entries:', fetchErr.message);
      return;
    }
    
    if (!oldEntries || oldEntries.length === 0) {
      console.log('[Cleanup] No old entries found to clean up.');
      return;
    }
    
    console.log(`[Cleanup] Found ${oldEntries.length} entries older than 7 days. Starting cleanup...`);
    
    for (const entry of oldEntries) {
      const runId = entry.id;
      
      // 1. Delete files in Supabase Storage bucket for this run
      const { data: files, error: listErr } = await supabase.storage
        .from('carousel-images')
        .list(runId);
        
      if (listErr) {
        console.error(`[Cleanup] Failed to list files for storage folder ${runId}:`, listErr.message);
      } else if (files && files.length > 0) {
        const filesToRemove = files.map(file => `${runId}/${file.name}`);
        console.log(`[Cleanup] Removing ${filesToRemove.length} images from Supabase Storage for run ${runId}...`);
        const { error: removeErr } = await supabase.storage
          .from('carousel-images')
          .remove(filesToRemove);
          
        if (removeErr) {
          console.error(`[Cleanup] Failed to remove files for folder ${runId}:`, removeErr.message);
        }
      }
      
      // Clean up local dist files if they exist (just in case they are local file paths)
      if (entry.image_paths && entry.image_paths.length > 0) {
        const firstPath = entry.image_paths[0];
        if (firstPath && !firstPath.startsWith('http://') && !firstPath.startsWith('https://')) {
          const runDir = path.dirname(firstPath);
          try {
            if (fs.existsSync(runDir)) {
              fs.rmSync(runDir, { recursive: true, force: true });
              console.log(`[Cleanup] Cleaned up local directory: ${runDir}`);
            }
          } catch (localErr) {
            console.warn(`[Cleanup] Failed to remove local run directory ${runDir}:`, localErr.message);
          }
        }
      }
      
      // 2. Delete database entry
      const { error: deleteErr } = await supabase
        .from('carousel_history')
        .delete()
        .eq('id', runId);
        
      if (deleteErr) {
        console.error(`[Cleanup] Failed to delete database history entry ${runId}:`, deleteErr.message);
      } else {
        console.log(`[Cleanup] Successfully deleted history entry ${runId} from database.`);
      }
    }
    
    console.log('[Cleanup] History and storage cleanup task completed.');
  } catch (err) {
    console.error('[Cleanup] Error during history cleanup:', err.message);
  }
}
