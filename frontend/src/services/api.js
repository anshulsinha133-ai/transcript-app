import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const RENDER_URL = 'https://transcript-app-lbpe.onrender.com';

const PENDING_JOB_KEY    = 'voxnote_pending_job';
const PENDING_UPLOAD_KEY = 'voxnote_pending_upload';

const savePendingJob = async (jobId, uri) => {
  try {
    await AsyncStorage.setItem(PENDING_JOB_KEY, JSON.stringify({
      jobId, uri, startedAt: new Date().toISOString(),
    }));
    console.log('Pending job saved:', jobId);
  } catch (err) { console.error('Failed to save pending job:', err.message); }
};

const savePendingUpload = async (uri) => {
  try {
    await AsyncStorage.setItem(PENDING_UPLOAD_KEY, JSON.stringify({
      uri, startedAt: new Date().toISOString(),
    }));
  } catch (err) { console.error('Failed to save pending upload:', err.message); }
};

const clearPendingJob = async () => {
  try {
    await AsyncStorage.removeItem(PENDING_JOB_KEY);
    await AsyncStorage.removeItem(PENDING_UPLOAD_KEY);
  } catch (err) { console.error('Failed to clear pending job:', err.message); }
};

export const getPendingJob = async () => {
  try {
    const raw = await AsyncStorage.getItem(PENDING_JOB_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) { console.error('Failed to get pending job:', err.message); return null; }
};

export const getPendingUpload = async () => {
  try {
    const raw = await AsyncStorage.getItem(PENDING_UPLOAD_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) { console.error('Failed to get pending upload:', err.message); return null; }
};

export const checkServerHealth = async () => {
  try {
    const response = await axios.get(`${RENDER_URL}/health`, { timeout: 60000 });
    return response.data;
  } catch (err) { throw new Error('Cannot reach server.'); }
};

export const summarizeTranscript = async (transcript, mode) => {
  try {
    const response = await axios.post(
      `${RENDER_URL}/summarize`,
      {
        transcript,
        mode: mode || 'default',
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000,
      }
    );
    return {
      success:    true,
      summary:    response.data.summary,
      structured: response.data.structured,
    };
  } catch (err) {
    console.error('Summary error:', err.message);
    throw new Error('Summary failed: ' + err.message);
  }
};

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
      { headers: { 'Content-Type': 'application/json' }, timeout: 60000 }
    );
    return { success: true, answer: response.data.answer, question: response.data.question };
  } catch (err) {
    console.error('Chat error:', err.message);
    return { success: false, error: err.message || 'Chat failed' };
  }
};

export const getRealtimeToken = async () => {
  try {
    const response = await axios.get(`${RENDER_URL}/realtime-token`, { timeout: 10000 });
    return { success: true, token: response.data.token };
  } catch (err) {
    console.error('Realtime token error:', err.message);
    return { success: false, error: err.message || 'Could not get real-time token' };
  }
};

// ─── CHANGE 1: startTranscription now accepts mode and languageHint ───────────
// mode       → template id ('meeting', 'sales', 'doctor' etc.) — used by server for AI summary
// languageHint → short lang code ('hi', 'mr', 'en' etc.) — tells server to route to Sarvam
// Both are optional — defaults to 'default' mode and 'auto' language (server auto-detects)

export const startTranscription = async (uri, onProgress = null, mode = 'default', languageHint = 'auto') => {
  const maxUploadAttempts = 3;
  await savePendingUpload(uri);

  for (let attempt = 1; attempt <= maxUploadAttempts; attempt++) {
    try {
      if (onProgress) {
        onProgress(attempt === 1 ? 'Uploading audio...' : `Upload retry ${attempt}/${maxUploadAttempts}...`, 10);
      }
      console.log(`Upload attempt ${attempt}/${maxUploadAttempts}`);

      const formData = new FormData();
      formData.append('audio', { uri, type: 'audio/m4a', name: 'recording.m4a' });

      // ── CHANGE: send mode and language_hint to backend ────────────────────
      formData.append('mode',          mode);          // e.g. 'meeting', 'sales'
      formData.append('language_hint', languageHint);  // e.g. 'hi', 'mr', 'auto'
      // ─────────────────────────────────────────────────────────────────────

      if (onProgress) onProgress('Submitting to server...', 20);

      const response = await axios.post(
        `${RENDER_URL}/transcribe-start`,
        formData,
        {
          headers:          { 'Content-Type': 'multipart/form-data' },
          timeout:          300000,
          transformRequest: (data) => data,
        }
      );

      if (!response.data.success) throw new Error(response.data.error || 'Failed to start transcription');

      const jobId = response.data.jobId;
      console.log('Job started, ID:', jobId, '| Provider:', response.data.provider);
      await savePendingJob(jobId, uri);
      await AsyncStorage.removeItem(PENDING_UPLOAD_KEY);
      return { success: true, jobId };

    } catch (err) {
      console.error(`Upload attempt ${attempt} failed:`, err.message);
      if (attempt < maxUploadAttempts) {
        const waitMs = attempt * 3000;
        if (onProgress) onProgress(`Upload failed — retrying in ${waitMs/1000}s...`, 10);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      } else {
        return {
          success: false,
          error: 'Upload failed after 3 attempts. Check your network and try again.',
          canRetryUpload: true,
          uri,
        };
      }
    }
  }
};

export const pollTranscription = async (jobId, onProgress = null) => {
  const maxAttempts    = 180;
  let attempts         = 0;
  let networkFailCount = 0;

  console.log('Polling job:', jobId);

  while (attempts < maxAttempts) {
    try {
      const waitMs = networkFailCount > 3 ? 15000 : 10000;
      await new Promise(resolve => setTimeout(resolve, waitMs));
      attempts++;

      const response = await axios.get(`${RENDER_URL}/transcribe-status/${jobId}`, { timeout: 60000 });
      networkFailCount = 0;
      const data = response.data;
      console.log('Poll attempt', attempts, '- status:', data.status);

      if (data.status === 'completed' || (data.success === true && data.text)) {
        if (onProgress) onProgress('Done!', 100);
        await clearPendingJob();
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

      if (data.status === 'queued')      { if (onProgress) onProgress('Queued — waiting...', Math.min(25 + attempts, 35)); }
      else if (data.status === 'processing') { if (onProgress) onProgress('Transcribing...', Math.min(35 + attempts, 85)); }

    } catch (err) {
      networkFailCount++;
      console.error('Poll attempt', attempts, 'error:', err.message);
      if (networkFailCount === 3 && onProgress) onProgress('Network issue — retrying...', null);
      if (networkFailCount >= 10) {
        return {
          success: false,
          error: 'Network lost. Your recording is safe — go to Home and tap "Resume" to try again.',
          canResume: true,
          jobId,
        };
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(5000 * networkFailCount, 30000)));
    }
  }

  return {
    success: false,
    error: 'Transcription timed out. Go to Home and tap "Resume" to try again.',
    canResume: true,
    jobId,
  };
};

// ─── CHANGE 2: transcribeWithSpeakers now accepts mode and languageHint ───────
// These are passed straight through to startTranscription → server

export const transcribeWithSpeakers = async (uri, onProgress = null, mode = 'default', languageHint = 'auto') => {
  try {
    if (onProgress) onProgress('Uploading audio...', 10);
    const startResult = await startTranscription(uri, onProgress, mode, languageHint);
    if (!startResult.success) {
      return {
        success:        false,
        error:          startResult.error,
        canRetryUpload: startResult.canRetryUpload || false,
        uri:            startResult.uri || uri,
      };
    }
    if (onProgress) onProgress('Processing... please wait', 25);
    return await pollTranscription(startResult.jobId, onProgress);
  } catch (err) {
    console.error('transcribeWithSpeakers error:', err.message);
    return { success: false, error: err.message || 'Transcription failed' };
  }
};

export const resumePendingTranscription = async (onProgress = null) => {
  try {
    const pendingUpload = await getPendingUpload();
    if (pendingUpload) {
      console.log('Resuming pending upload:', pendingUpload.uri);
      if (onProgress) onProgress('Retrying upload...', 10);
      const startResult = await startTranscription(pendingUpload.uri, onProgress);
      if (!startResult.success) return { success: false, error: startResult.error };
      if (onProgress) onProgress('Processing... please wait', 25);
      return await pollTranscription(startResult.jobId, onProgress);
    }
    const pending = await getPendingJob();
    if (!pending) return { success: false, error: 'No pending recording found' };
    console.log('Resuming pending job:', pending.jobId);
    if (onProgress) onProgress('Resuming transcription...', 30);
    return await pollTranscription(pending.jobId, onProgress);
  } catch (err) {
    console.error('resumePendingTranscription error:', err.message);
    return { success: false, error: err.message };
  }
};