import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const RENDER_URL = 'https://transcript-app-lbpe.onrender.com';

// ─── Keys for AsyncStorage ───
const PENDING_JOB_KEY    = 'voxnote_pending_job';
const PENDING_UPLOAD_KEY = 'voxnote_pending_upload';

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

// ─── Save pending upload ───
const savePendingUpload = async (uri) => {
  try {
    await AsyncStorage.setItem(PENDING_UPLOAD_KEY, JSON.stringify({
      uri,
      startedAt: new Date().toISOString(),
    }));
    console.log('Pending upload saved to phone:', uri);
  } catch (err) {
    console.error('Failed to save pending upload:', err.message);
  }
};

// ─── Clear pending job ───
const clearPendingJob = async () => {
  try {
    await AsyncStorage.removeItem(PENDING_JOB_KEY);
    await AsyncStorage.removeItem(PENDING_UPLOAD_KEY);
    console.log('Pending job cleared');
  } catch (err) {
    console.error('Failed to clear pending job:', err.message);
  }
};

// ─── Get pending job ───
export const getPendingJob = async () => {
  try {
    const raw = await AsyncStorage.getItem(PENDING_JOB_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Failed to get pending job:', err.message);
    return null;
  }
};

// ─── Get pending upload ───
export const getPendingUpload = async () => {
  try {
    const raw = await AsyncStorage.getItem(PENDING_UPLOAD_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Failed to get pending upload:', err.message);
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

// ─── Step 1: Start transcription job with retry ───
export const startTranscription = async (uri, onProgress = null) => {
  const maxUploadAttempts = 3;
  await savePendingUpload(uri);

  for (let attempt = 1; attempt <= maxUploadAttempts; attempt++) {
    try {
      if (onProgress) {
        if (attempt === 1) {
          onProgress('Uploading audio...', 10);
        } else {
          onProgress(`Upload retry ${attempt}/${maxUploadAttempts}...`, 10);
        }
      }

      console.log(`Upload attempt ${attempt}/${maxUploadAttempts}`);

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
          timeout:          180000,
          transformRequest: (data) => data,
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to start transcription');
      }

      const jobId = response.data.jobId;
      console.log('Job started, ID:', jobId);
      await savePendingJob(jobId, uri);
      await AsyncStorage.removeItem(PENDING_UPLOAD_KEY);

      return { success: true, jobId };

    } catch (err) {
      console.error(`Upload attempt ${attempt} failed:`, err.message);

      if (attempt < maxUploadAttempts) {
        const waitMs = attempt * 5000;
        console.log(`Waiting ${waitMs/1000}s before retry...`);
        if (onProgress) onProgress(`Upload failed — retrying in ${waitMs/1000}s...`, 10);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      } else {
        return {
          success:        false,
          error:          'Upload failed after 3 attempts. Check your network and try again.',
          canRetryUpload: true,
          uri:            uri,
        };
      }
    }
  }
};

// ─── Step 2: Poll until job is complete ───
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

      const response = await axios.get(
        `${RENDER_URL}/transcribe-status/${jobId}`,
        { timeout: 60000 }
      );

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

      if (networkFailCount === 3) {
        if (onProgress) onProgress('Network issue — retrying...', null);
      }

      if (networkFailCount >= 10) {
        return {
          success:   false,
          error:     'Network lost. Your recording is safe — go to Home and tap "Resume" to try again.',
          canResume: true,
          jobId:     jobId,
        };
      }

      const backoffMs = Math.min(5000 * networkFailCount, 30000);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }

  return {
    success:   false,
    error:     'Transcription timed out. Go to Home and tap "Resume" to try again.',
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

// ─── Resume a pending job ───
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