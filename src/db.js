import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;

if (supabaseUrl && supabaseAnonKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    console.log('Supabase Database client initialized successfully.');
  } catch (err) {
    console.error('Failed to initialize Supabase client:', err.message);
  }
} else {
  console.error('❌ Error: SUPABASE_URL or SUPABASE_ANON_KEY is missing in your .env file.');
}

// Check connection and log status
export async function initDb() {
  if (!supabase) {
    console.warn('⚠️ Warning: Supabase client is not initialized. Database operations will fail.');
    return false;
  }
  
  try {
    const { data, error } = await supabase
      .from('current_run')
      .select('id')
      .eq('id', 1)
      .single();

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

    // 2. Fetch current active run state
    const { data: runData, error: runErr } = await supabase
      .from('current_run')
      .select('*')
      .eq('id', 1)
      .single();

    if (runErr && runErr.code !== 'PGRST116') { // PGRST116 is single row empty result
      console.error('Error reading current_run from Supabase:', runErr.message);
    }

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
        linkedin_post: h.linkedin_post
      })),
      current_run: runData && runData.run_id ? {
        runId: runData.run_id,
        timeSlot: runData.time_slot,
        angles: runData.angles,
        currentAngleIndex: runData.current_angle_index,
        chatId: runData.chat_id
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
      // Clear active run state
      const { error } = await supabase
        .from('current_run')
        .update({
          run_id: null,
          time_slot: null,
          angles: null,
          current_angle_index: 0,
          chat_id: null,
          updated_at: new Date()
        })
        .eq('id', 1);
      
      if (error) console.error('Error clearing active run:', error.message);
      return;
    }

    const { error } = await supabase
      .from('current_run')
      .update({
        run_id: run.runId,
        time_slot: run.timeSlot,
        angles: run.angles,
        current_angle_index: run.currentAngleIndex,
        chat_id: run.chatId,
        updated_at: new Date()
      })
      .eq('id', 1);

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
    const { error } = await supabase
      .from('carousel_history')
      .insert({
        id: entry.id || `run-${Date.now()}`,
        time_slot: entry.timeSlot,
        status: entry.status,
        angle: entry.angle,
        slides: entry.slides,
        image_paths: entry.imagePaths || [],
        linkedin_post: entry.linkedin_post || ''
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
      updateData.image_paths = extraFields.imagePaths;
    }
    if (extraFields.linkedin_post) {
      updateData.linkedin_post = extraFields.linkedin_post;
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
