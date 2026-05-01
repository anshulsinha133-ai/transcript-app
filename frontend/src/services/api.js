import axios from 'axios';

const OPENAI_API_KEY = '';
const RENDER_URL = 'https://transcript-app-lbpe.onrender.com';

export const checkServerHealth = async () => {
  try {
    const response = await axios.get(`${RENDER_URL}/health`, { timeout: 60000 });
    return response.data;
  } catch (err) {
    throw new Error('Cannot reach server.');
  }
};

export const summarizeTranscript = async (transcript) => {
  try {
    const response = await axios.post(
      `${RENDER_URL}/summarize`,
      { transcript },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000,
      }
    );
    return {
      success: true,
      summary: response.data.summary
    };
  } catch (err) {
    console.error('Summary error:', err);
    throw new Error('Summary failed: ' + err.message);
  }
};

// ─── ACTION 2: NEW chatWithTranscripts FUNCTION ───
// Sends user question + transcript(s) to backend /chat route
// Works for single transcript OR all transcripts
export const chatWithTranscripts = async (question, transcripts) => {
  try {
    const response = await axios.post(
      `${RENDER_URL}/chat`,
      {
        question,
        transcripts: transcripts.map(t => ({
          title:      t.title,
          createdAt:  t.createdAt,
          text:       t.text,
          englishText: t.englishText,
          utterances:  t.utterances || [],
        })),
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000,
      }
    );
    return {
      success:  true,
      answer:   response.data.answer,
      question: response.data.question,
    };
  } catch (err) {
    console.error('Chat error:', err.message);
    return {
      success: false,
      error:   err.message || 'Chat failed',
    };
  }
};

export const transcribeWithSpeakers = async (uri, onProgress = null) => {
  try {
    if (onProgress) onProgress('Preparing audio...', 10);

    const formData = new FormData();
    formData.append('audio', {
      uri:  uri,
      type: 'audio/m4a',
      name: 'recording.m4a',
    });

    if (onProgress) onProgress('Uploading audio...', 20);

    const response = await axios.post(
      `${RENDER_URL}/transcribe-speakers`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300000,
        transformRequest: (data) => data,
      }
    );

    if (onProgress) onProgress('Processing speakers...', 60);

    const data = response.data;

    if (!data.success) {
      throw new Error(data.error || 'Transcription failed');
    }

    if (onProgress) onProgress('Done!', 100);

    return {
      success:      true,
      text:         data.text,
      englishText:  data.englishText  || null,
      utterances:   data.utterances   || [],
      words:        data.words        || [],
      duration:     data.duration,
      autoSummary:  data.autoSummary  || null,
      actionItems:  data.actionItems  || [],
      detectedLang: data.detectedLang || 'en',
    };

  } catch (err) {
    console.error('transcribeWithSpeakers error:', err.message);
    return {
      success: false,
      error:   err.message || 'Transcription failed',
    };
  }
};