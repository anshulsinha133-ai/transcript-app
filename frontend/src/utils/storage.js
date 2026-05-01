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
        folder:       transcriptObj.folder       || 'General', // ✅ NEW
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
      folder:       t.folder       || 'General', // ✅ NEW
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

// ─── NEW: Update folder for a transcript ───
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
  folder       = 'General' // ✅ NEW
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
  folder:       folder,       // ✅ NEW
  mode:         mode,
  createdAt:    new Date().toISOString(),
  wordCount:    text ? text.split(' ').length : 0,
});