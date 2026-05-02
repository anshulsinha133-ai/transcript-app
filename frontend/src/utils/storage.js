import { supabase } from '../supabase';

export const saveTranscript = async (transcriptObj) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not logged in');

    const { data, error } = await supabase
      .from('transcripts')
      .insert({
        user_id:      user.id,
        title:        transcriptObj.title,
        text:         transcriptObj.text,
        duration:     transcriptObj.duration,
        word_count:   transcriptObj.wordCount,
        audio_path:   transcriptObj.audioPath,
        utterances:   transcriptObj.utterances   || null,
        words:        transcriptObj.words        || null,
        english_text: transcriptObj.englishText  || null,
        original_text:transcriptObj.originalText || null,
        auto_summary: transcriptObj.autoSummary  || null,
        action_items: transcriptObj.actionItems  || null,
        mode:         transcriptObj.mode         || 'en',
        folder:       transcriptObj.folder       || 'General',
      })
      .select('id')
      .single();

    if (error) throw error;

    console.log('Transcript saved with UUID:', data.id);
    return { success: true, id: data.id };

  } catch (err) {
    console.error('Save error:', err);
    return { success: false, id: null };
  }
};

export const getAllTranscripts = async () => {
  try {
    const { data, error } = await supabase
      .from('transcripts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return data.map(t => ({
      id:           t.id,
      title:        t.title,
      text:         t.text,
      duration:     t.duration,
      wordCount:    t.word_count,
      audioPath:    t.audio_path,
      utterances:   t.utterances   || null,
      words:        t.words        || null,
      englishText:  t.english_text || null,
      originalText: t.original_text|| null,
      autoSummary:  t.auto_summary || null,
      actionItems:  t.action_items || null,
      folder:       t.folder       || 'General',
      mode:         t.mode         || 'en',
      createdAt:    t.created_at,
    }));
  } catch (err) {
    console.error('Load error:', err);
    return [];
  }
};

export const deleteTranscript = async (id) => {
  try {
    const { error } = await supabase
      .from('transcripts')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Delete error:', err);
    return false;
  }
};

// ─── Update speaker names ───
export const updateSpeakerNames = async (transcriptId, utterances, speakerMap) => {
  try {
    console.log('updateSpeakerNames called');
    console.log('transcriptId:', transcriptId);
    console.log('speakerMap:', speakerMap);

    if (!transcriptId) throw new Error('No transcript ID provided');

    const updatedUtterances = utterances.map(u => ({
      ...u,
      speaker: speakerMap[u.speaker] !== undefined ? speakerMap[u.speaker] : u.speaker,
    }));

    const { data, error } = await supabase
      .from('transcripts')
      .update({ utterances: updatedUtterances })
      .eq('id', transcriptId)
      .select('id, utterances');

    if (error) throw error;
    if (!data || data.length === 0) throw new Error('No rows updated');

    return { success: true, utterances: updatedUtterances };
  } catch (err) {
    console.error('updateSpeakerNames error:', err.message);
    return { success: false, error: err.message };
  }
};

// ─── Update folder ───
export const updateTranscriptFolder = async (transcriptId, folder) => {
  try {
    console.log('Updating folder:', transcriptId, '→', folder);

    const { error } = await supabase
      .from('transcripts')
      .update({ folder })
      .eq('id', transcriptId);

    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error('updateTranscriptFolder error:', err.message);
    return { success: false, error: err.message };
  }
};

// ─── NEW: Full-text search across all transcript fields ───
export const searchTranscripts = (transcripts, query) => {
  if (!query || !query.trim()) return transcripts.map(t => ({ ...t, matchContext: null }));

  const q = query.toLowerCase().trim();

  const results = [];

  for (const t of transcripts) {
    let matchContext = null;

    // 1. Title match
    if (t.title?.toLowerCase().includes(q)) {
      matchContext = { field: 'title', snippet: null };
    }

    // 2. English text match
    if (!matchContext && t.englishText?.toLowerCase().includes(q)) {
      matchContext = {
        field:   'transcript',
        snippet: getSnippet(t.englishText, q),
      };
    }

    // 3. Original text match (Hindi/Marathi)
    if (!matchContext && t.text?.toLowerCase().includes(q)) {
      matchContext = {
        field:   'transcript',
        snippet: getSnippet(t.text, q),
      };
    }

    // 4. AI Summary match
    if (!matchContext && t.autoSummary?.toLowerCase().includes(q)) {
      matchContext = {
        field:   'summary',
        snippet: getSnippet(t.autoSummary, q),
      };
    }

    // 5. Utterances match — find which speaker said it
    if (!matchContext && t.utterances?.length > 0) {
      for (const u of t.utterances) {
        const uText = (u.englishText || u.text || '').toLowerCase();
        if (uText.includes(q)) {
          matchContext = {
            field:   'speaker',
            speaker: u.speaker,
            snippet: getSnippet(u.englishText || u.text, q),
          };
          break;
        }
      }
    }

    // 6. Action items match
    if (!matchContext && t.actionItems?.length > 0) {
      for (const a of t.actionItems) {
        const aText = (a.task || '').toLowerCase();
        if (aText.includes(q)) {
          matchContext = {
            field:   'action',
            snippet: a.task,
          };
          break;
        }
      }
    }

    if (matchContext) {
      results.push({ ...t, matchContext });
    }
  }

  return results;
};

// ─── Helper: extract snippet around matched word ───
const getSnippet = (text, query) => {
  if (!text) return null;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;
  const start  = Math.max(0, idx - 40);
  const end    = Math.min(text.length, idx + query.length + 60);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return prefix + text.substring(start, end) + suffix;
};

export const createTranscriptObj = (
  title,
  text,
  duration,
  audioPath    = null,
  utterances   = null,
  words        = null,
  englishText  = null,
  originalText = null,
  autoSummary  = null,
  actionItems  = null,
  mode         = 'en',
  folder       = 'General'
) => ({
  id:           null,
  title:        title,
  text:         text,
  duration:     duration,
  audioPath:    audioPath,
  utterances:   utterances,
  words:        words,
  englishText:  englishText,
  originalText: originalText,
  autoSummary:  autoSummary,
  actionItems:  actionItems,
  folder:       folder,
  mode:         mode,
  createdAt:    new Date().toISOString(),
  wordCount:    text ? text.split(' ').length : 0,
});