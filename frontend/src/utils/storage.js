// src/utils/storage.js
import { supabase } from '../supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PENDING_JOB_KEY = 'voxnote_pending_job';

const getCurrentUserId = async () => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Not authenticated');
  return user.id;
};

const mapDbToApp = (row) => ({
  id:           row.id,
  userId:       row.user_id,
  title:        row.title,
  text:         row.text,
  englishText:  row.english_text  || null,
  originalText: row.original_text || null,
  duration:     row.duration      || null,
  wordCount:    row.word_count    || 0,
  utterances:   row.utterances    || [],
  words:        row.words         || [],
  autoSummary:  row.auto_summary  || null,
  actionItems:  row.action_items  || [],
  folder:       row.folder        || 'General',
  mode:         row.mode          || 'en',
  shareToken:   row.share_token   || null,
  detectedLang: row.mode          || 'en',
  createdAt:    row.created_at,
});

// Called by HomeScreen: await getAllTranscripts(user?.id)
export const getAllTranscripts = async (userId = null) => {
  try {
    const uid = userId || await getCurrentUserId();
    const { data, error } = await supabase
      .from('transcripts')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapDbToApp);
  } catch (err) {
    console.error('getAllTranscripts error:', err.message);
    return [];
  }
};

export const saveTranscript = async (transcriptData) => {
  try {
    const userId = await getCurrentUserId();
    const { data, error } = await supabase
      .from('transcripts')
      .insert([{
        user_id:       userId,
        title:         transcriptData.title        || 'Untitled Recording',
        text:          transcriptData.text         || '',
        english_text:  transcriptData.englishText  || null,
        original_text: transcriptData.originalText || null,
        duration:      transcriptData.duration     || null,
        word_count:    transcriptData.wordCount     || 0,
        utterances:    transcriptData.utterances   || [],
        words:         transcriptData.words        || [],
        auto_summary:  transcriptData.autoSummary  || null,
        action_items:  transcriptData.actionItems  || [],
        folder:        transcriptData.folder       || 'General',
        mode:          transcriptData.mode         || 'en',
      }])
      .select()
      .single();
    if (error) throw error;
    return { success: true, id: data.id, data };
  } catch (err) {
    console.error('saveTranscript error:', err.message);
    return { success: false, error: err.message };
  }
};

// Called by HomeScreen: await deleteTranscript(id, user?.id)
export const deleteTranscript = async (id, userId = null) => {
  try {
    const uid = userId || await getCurrentUserId();
    const { error } = await supabase
      .from('transcripts')
      .delete()
      .eq('id', id)
      .eq('user_id', uid);
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error('deleteTranscript error:', err.message);
    return { success: false, error: err.message };
  }
};

// Client-side search on already user-filtered in-memory data
export const searchTranscripts = (transcripts, query) => {
  if (!query?.trim()) return transcripts.map(t => ({ ...t, matchContext: null }));
  const q = query.toLowerCase();
  return transcripts.map(t => {
    if (t.title?.toLowerCase().includes(q))
      return { ...t, matchContext: { field: 'title', snippet: t.title } };
    const mu = t.utterances?.find(u =>
      u.text?.toLowerCase().includes(q) ||
      u.englishText?.toLowerCase().includes(q) ||
      u.speaker?.toLowerCase().includes(q)
    );
    if (mu) {
      const s = mu.englishText || mu.text || '';
      const i = s.toLowerCase().indexOf(q);
      const a = Math.max(0, i - 30), b = Math.min(s.length, i + q.length + 60);
      return { ...t, matchContext: { field:'speaker', speaker:mu.speaker, snippet:(a>0?'...':'')+s.slice(a,b)+(b<s.length?'...':'') } };
    }
    if (t.autoSummary?.toLowerCase().includes(q)) {
      const i = t.autoSummary.toLowerCase().indexOf(q);
      const a = Math.max(0, i-30), b = Math.min(t.autoSummary.length, i+q.length+80);
      return { ...t, matchContext: { field:'summary', snippet:(a>0?'...':'')+t.autoSummary.slice(a,b)+'...' } };
    }
    const ma = t.actionItems?.find(a => a.task?.toLowerCase().includes(q) || a.owner?.toLowerCase().includes(q));
    if (ma) return { ...t, matchContext: { field:'action', snippet: ma.task } };
    const txt = t.englishText || t.text || '';
    if (txt.toLowerCase().includes(q)) {
      const i = txt.toLowerCase().indexOf(q);
      const a = Math.max(0, i-30), b = Math.min(txt.length, i+q.length+80);
      return { ...t, matchContext: { field:'transcript', snippet:(a>0?'...':'')+txt.slice(a,b)+'...' } };
    }
    return null;
  }).filter(Boolean);
};

export const createTranscriptObj = (title, text, duration = 0) => ({
  title:       title || 'Untitled Recording',
  text:        text  || '',
  englishText: null,
  duration:    duration,
  wordCount:   text ? text.split(' ').filter(Boolean).length : 0,
  utterances:  [],
  words:       [],
  autoSummary: null,
  actionItems: [],
  folder:      'General',
  mode:        'en',
});

export const updateSpeakerNames = async (id, utterances, nameMap) => {
  try {
    const userId = await getCurrentUserId();
    const updated = utterances.map(u => ({ ...u, speaker: nameMap[u.speaker] || u.speaker }));
    const { error } = await supabase.from('transcripts')
      .update({ utterances: updated }).eq('id', id).eq('user_id', userId);
    if (error) throw error;
    return { success: true, utterances: updated };
  } catch (err) {
    console.error('updateSpeakerNames error:', err.message);
    return { success: false, error: err.message };
  }
};

export const updateTranscriptFolder = async (id, folder) => {
  try {
    const userId = await getCurrentUserId();
    const { error } = await supabase.from('transcripts')
      .update({ folder }).eq('id', id).eq('user_id', userId);
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error('updateTranscriptFolder error:', err.message);
    return { success: false, error: err.message };
  }
};

export const updateAutoSummary = async (id, summary) => {
  try {
    const userId = await getCurrentUserId();
    const { error } = await supabase.from('transcripts')
      .update({ auto_summary: summary }).eq('id', id).eq('user_id', userId);
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error('updateAutoSummary error:', err.message);
    return { success: false, error: err.message };
  }
};

export const updateTranscriptTitle = async (id, title) => {
  try {
    const userId = await getCurrentUserId();
    const { error } = await supabase.from('transcripts')
      .update({ title }).eq('id', id).eq('user_id', userId);
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error('updateTranscriptTitle error:', err.message);
    return { success: false, error: err.message };
  }
};

export const savePendingJob = async (jobId) => {
  try { await AsyncStorage.setItem(PENDING_JOB_KEY, jobId); }
  catch (err) { console.error('savePendingJob error:', err.message); }
};

export const clearPendingJob = async () => {
  try { await AsyncStorage.removeItem(PENDING_JOB_KEY); }
  catch (err) { console.error('clearPendingJob error:', err.message); }
};