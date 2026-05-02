import axios from 'axios';

const OPENAI_API_KEY = '';
const RENDER_URL = 'https://transcript-app-lbpe.onrender.com';

// ─── Health check ───
export const checkServerHealth = async () => {
  try {
    const response = await axios.get(`${RENDER_URL}/health`, { timeout: 60000 });
    return response.data;
  } catch (err) {
    throw new Error('Cannot reach server.');
  }
};

// ─── Summarize transcript ───
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
    return { success: true, summary: response.data.summary };
  } catch (err) {
    console.error('Summary error:', err);
    throw new Error('Summary failed: ' + err.message);
  }
};

// ─── Chat with transcripts ───
export const chatWithTranscripts = async (question, transcripts) => {
  try {
    const response = await axios.post(
      `${RENDER_URL}/chat`,
      {
        question,
        transcripts: transcripts.map(t => ({
          title:       t.title,
          createdAt:   t.createdAt,
          text:        t.text,
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
    return { success: false, error: err.message || 'Chat failed' };
  }
};

// ─── Get real-time streaming token ───
export const getRealtimeToken = async () => {
  try {
    const response = await axios.get(`${RENDER_URL}/realtime-token`, {
      timeout: 10000,
    });
    return { success: true, token: response.data.token };
  } catch (err) {
    console.error('Realtime token error:', err.message);
    return { success: false, error: err.message || 'Could not get real-time token' };
  }
};

// ─── Step 1: Start transcription job (returns immediately) ───
// ✅ Fixes timeout for long recordings — no more 30-second limit!
// Returns jobId which is used to poll for status
export const startTranscription = async (uri, onProgress = null) => {
  try {
    if (onProgress) onProgress('Uploading audio...', 10);

    const formData = new FormData();
    formData.append('audio', {
      uri:  uri,
      type: 'audio/m4a',
      name: 'recording.m4a',
    });

    if (onProgress) onProgress('Submitting to server...', 20);

    const response = await axios.post(
      `${RENDER_URL}/transcribe-start`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000, // 2 min for upload only
        transformRequest: (data) => data,
      }
    );

    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to start transcription');
    }

    console.log('Job started, ID:', response.data.jobId);
    return { success: true, jobId: response.data.jobId };

  } catch (err) {
    console.error('startTranscription error:', err.message);
    return { success: false, error: err.message || 'Failed to start transcription' };
  }
};

// ─── Step 2: Poll until job is complete ───
// Checks status every 5 seconds
// Works for recordings of ANY length — 1 min, 10 min, 1 hour!
export const pollTranscription = async (jobId, onProgress = null) => {
  const maxAttempts = 120; // Max 10 minutes polling (120 × 5 seconds)
  let attempts      = 0;

  console.log('Polling job:', jobId);

  while (attempts < maxAttempts) {
    try {
      // Wait 5 seconds between polls
      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;

      const response = await axios.get(
        `${RENDER_URL}/transcribe-status/${jobId}`,
        { timeout: 30000 }
      );

      const data = response.data;
      console.log('Poll attempt', attempts, '- status:', data.status);

      if (data.status === 'completed') {
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
      }

      if (data.status === 'error') {
        return { success: false, error: data.error || 'Transcription failed' };
      }

      // Still queued or processing — update progress
      if (data.status === 'queued') {
        const pct = Math.min(25 + attempts, 40);
        if (onProgress) onProgress('Queued — waiting...', pct);
      } else if (data.status === 'processing') {
        const pct = Math.min(40 + (attempts * 2), 85);
        if (onProgress) onProgress('Transcribing...', pct);
      }

    } catch (err) {
      console.error('Poll attempt', attempts, 'error:', err.message);
      // Continue polling — network hiccups happen
    }
  }

  return { success: false, error: 'Transcription timed out. Please try again.' };
};

// ─── transcribeWithSpeakers ───
// ✅ Now uses polling for ALL recordings
// Works for 1 minute OR 1 hour recordings!
export const transcribeWithSpeakers = async (uri, onProgress = null) => {
  try {
    // Step 1: Upload and start job
    if (onProgress) onProgress('Uploading audio...', 10);

    const startResult = await startTranscription(uri, onProgress);

    if (!startResult.success) {
      return { success: false, error: startResult.error };
    }

    // Step 2: Poll for result
    if (onProgress) onProgress('Processing... please wait', 25);

    const result = await pollTranscription(startResult.jobId, onProgress);

    return result;

  } catch (err) {
    console.error('transcribeWithSpeakers error:', err.message);
    return { success: false, error: err.message || 'Transcription failed' };
  }
};