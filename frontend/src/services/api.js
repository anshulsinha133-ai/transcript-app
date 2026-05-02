import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const RENDER_URL = 'https://transcript-app-lbpe.onrender.com';

// ─── Keys for AsyncStorage ───
const PENDING_JOB_KEY = 'voxnote_pending_job';

// ─── Save pending job to phone storage ───
const savePendingJob = async (jobId, uri) => {
  try {
    await AsyncStorage.setItem(PENDING_JOB_KEY, JSON.stringify({
      jobId,
      uri,
      startedAt: new Date().toISOString(),
    }));
    console.log('Pending job saved to phone:', jobId);
  } catch (err) {
    console.error('Failed to save pending job:', err.message);
  }
};

// ─── Clear pending job from phone storage ───
const clearPendingJob = async () => {
  try {
    await AsyncStorage.removeItem(PENDING_JOB_KEY);
    console.log('Pending job cleared');
  } catch (err) {
    console.error('Failed to clear pending job:', err.message);
  }
};

// ─── Get pending job from phone storage ───
export const getPendingJob = async () => {
  try {
    const raw = await AsyncStorage.getItem(PENDING_JOB_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Failed to get pending job:', err.message);
    return null;
  }
};

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

// ─── Step 1: Start transcription job ───
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
        headers:          { 'Content-Type': 'multipart/form-data' },
        timeout:          180000, // ✅ 3 min for large file upload
        transformRequest: (data) => data,
      }
    );

    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to start transcription');
    }

    const jobId = response.data.jobId;
    console.log('Job started, ID:', jobId);

    // ✅ Save jobId to phone immediately — so we can recover if network drops
    await savePendingJob(jobId, uri);

    return { success: true, jobId };

  } catch (err) {
    console.error('startTranscription error:', err.message);
    return { success: false, error: err.message || 'Failed to start transcription' };
  }
};

// ─── Step 2: Poll until job is complete ───
// ✅ Fixes:
// - Longer timeout per request (60s)
// - Exponential backoff on network errors
// - Stops as soon as result received (no duplicate processing)
// - Updates progress more accurately
export const pollTranscription = async (jobId, onProgress = null) => {
  const maxAttempts    = 180; // ✅ Max 30 min polling (180 × 10 seconds)
  let attempts         = 0;
  let networkFailCount = 0;

  console.log('Polling job:', jobId);

  while (attempts < maxAttempts) {
    try {
      // ✅ Wait between polls — longer if network has been failing
      const waitMs = networkFailCount > 3 ? 15000 : 10000;
      await new Promise(resolve => setTimeout(resolve, waitMs));
      attempts++;

      const response = await axios.get(
        `${RENDER_URL}/transcribe-status/${jobId}`,
        { timeout: 60000 } // ✅ 60s timeout per request (was 30s)
      );

      // ✅ Reset network fail count on success
      networkFailCount = 0;

      const data = response.data;
      console.log('Poll attempt', attempts, '- status:', data.status);

      // ✅ Completed — return immediately and clear pending job
      if (data.status === 'completed') {
        if (onProgress) onProgress('Done!', 100);
        await clearPendingJob(); // ✅ Clear from phone storage
        return {
          success:      true,
          text:         data.text,
          smartTitle:   data.smartTitle   || null,
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
        await clearPendingJob();
        return { success: false, error: data.error || 'Transcription failed' };
      }

      // ✅ Still processing — update progress
      if (data.status === 'queued') {
        const pct = Math.min(25 + attempts, 35);
        if (onProgress) onProgress('Queued — waiting...', pct);
      } else if (data.status === 'processing') {
        const pct = Math.min(35 + attempts, 85);
        if (onProgress) onProgress('Transcribing...', pct);
      }

    } catch (err) {
      networkFailCount++;
      console.error('Poll attempt', attempts, 'error:', err.message);

      // ✅ Show user friendly message after 3 consecutive failures
      if (networkFailCount === 3) {
        if (onProgress) onProgress('Network issue — retrying...', null);
      }

      // ✅ After 10 consecutive network failures — stop and tell user to resume later
      if (networkFailCount >= 10) {
        console.log('Too many network failures — stopping poll');
        return {
          success:   false,
          error:     'Network lost. Your recording is safe — go to Home and tap "Resume Pending Recording" to try again.',
          canResume: true,
          jobId:     jobId,
        };
      }

      // ✅ Exponential backoff — wait longer after each failure
      const backoffMs = Math.min(5000 * networkFailCount, 30000);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }

  return {
    success:   false,
    error:     'Transcription timed out. Go to Home and tap "Resume Pending Recording" to try again.',
    canResume: true,
    jobId:     jobId,
  };
};

// ─── transcribeWithSpeakers ───
export const transcribeWithSpeakers = async (uri, onProgress = null) => {
  try {
    if (onProgress) onProgress('Uploading audio...', 10);

    const startResult = await startTranscription(uri, onProgress);

    if (!startResult.success) {
      return { success: false, error: startResult.error };
    }

    if (onProgress) onProgress('Processing... please wait', 25);

    const result = await pollTranscription(startResult.jobId, onProgress);

    return result;

  } catch (err) {
    console.error('transcribeWithSpeakers error:', err.message);
    return { success: false, error: err.message || 'Transcription failed' };
  }
};

// ─── Resume a pending job (called from HomeScreen) ───
export const resumePendingTranscription = async (onProgress = null) => {
  try {
    const pending = await getPendingJob();
    if (!pending) return { success: false, error: 'No pending job found' };

    console.log('Resuming pending job:', pending.jobId);
    if (onProgress) onProgress('Resuming transcription...', 30);

    const result = await pollTranscription(pending.jobId, onProgress);
    return result;

  } catch (err) {
    console.error('resumePendingTranscription error:', err.message);
    return { success: false, error: err.message };
  }
};