import { supabase } from '../supabase';

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
        utterances: transcriptObj.utterances || null,
        words:      transcriptObj.words      || null,
      });

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Save error:', err);
    return false;
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
      id:         t.id,
      title:      t.title,
      text:       t.text,
      duration:   t.duration,
      wordCount:  t.word_count,
      audioPath:  t.audio_path,
      utterances: t.utterances || null,
      words:      t.words      || null,
      createdAt:  t.created_at,
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

export const createTranscriptObj = (
  title,
  text,
  duration,
  audioPath  = null,
  utterances = null,
  words      = null
) => ({
  id:         Date.now().toString(),
  title:      title,
  text:       text,
  duration:   duration,
  audioPath:  audioPath,
  utterances: utterances,
  words:      words,
  createdAt:  new Date().toISOString(),
  wordCount:  text ? text.split(' ').length : 0,
});