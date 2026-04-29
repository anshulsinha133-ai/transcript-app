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

export const transcribeWithSpeakers = async (uri, onProgress = null) => {
  try {
    if (onProgress) onProgress('Preparing audio...', 10);

    // ✅ FormData streaming — no base64, no memory crash
    const formData = new FormData();
    formData.append('audio', {
      uri:  uri,
      type: 'audio/m4a',
      name: 'recording.m4a',
    });

    if (onProgress) onProgress('Uploading audio...', 20);

    // ✅ NO Content-Type header — React Native sets it automatically with boundary
    const response = await fetch(`${RENDER_URL}/transcribe-speakers`, {
      method: 'POST',
      body:   formData,
    });

    if (onProgress) onProgress('Processing speakers...', 60);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Server error ${response.status}: ${errText}`);
    }

    const data = await response.json();

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