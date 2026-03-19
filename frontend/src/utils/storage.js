import { supabase } from '../supabase';

// Save transcript to Supabase
export const saveTranscript = async (transcriptObj) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not logged in');

    const { error } = await supabase
      .from('transcripts')
      .insert({
        user_id:    user.id,
        title:      transcriptObj.title,
        text:       transcriptObj.text,
        duration:   transcriptObj.duration,
        word_count: transcriptObj.wordCount,
        audio_path: transcriptObj.audioPath,
      });

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Save error:', err);
    return false;
  }
};

// Get all transcripts for logged in user
export const getAllTranscripts = async () => {
  try {
    const { data, error } = await supabase
      .from('transcripts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return data.map(t => ({
      id:        t.id,
      title:     t.title,
      text:      t.text,
      duration:  t.duration,
      wordCount: t.word_count,
      audioPath: t.audio_path,
      createdAt: t.created_at,
    }));
  } catch (err) {
    console.error('Load error:', err);
    return [];
  }
};

// Delete a transcript by id
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

// Create transcript object
export const createTranscriptObj = (title, text, duration, audioPath = null) => ({
  id:        Date.now().toString(),
  title:     title,
  text:      text,
  duration:  duration,
  audioPath: audioPath,
  createdAt: new Date().toISOString(),
  wordCount: text.split(' ').length,
});