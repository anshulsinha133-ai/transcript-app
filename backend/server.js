const express    = require('express');
const multer     = require('multer');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const OpenAI     = require('openai');
const { AssemblyAI } = require('assemblyai');
require('dotenv').config();

const app    = express();
const PORT   = process.env.PORT || 3000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const aai    = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_KEY });

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // ✅ 500MB — handles 1+ hour recordings
  fileFilter: (req, file, cb) => { cb(null, true); }
});

app.get('/', (req, res) => {
  res.send('VoxNote Server is LIVE 🎙');
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'VoxNote server is running', timestamp: new Date() });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password required' });
  return res.json({ success: true, message: 'Login successful', token: 'demo-token' });
});

app.post('/api/register', (req, res) => {
  return res.json({ success: true, message: 'User registered (demo)' });
});

// ─── Real-time streaming token ───
app.get('/realtime-token', async (req, res) => {
  try {
    console.log('Generating real-time token...');

    const response = await fetch(
      `https://streaming.assemblyai.com/v3/token?expires_in_seconds=480`,
      {
        method:  'GET',
        headers: { 'Authorization': process.env.ASSEMBLYAI_KEY },
      }
    );

    const responseText = await response.text();
    console.log('Token API response:', response.status, responseText);

    if (!response.ok) {
      throw new Error(`Token error: ${response.status} ${responseText}`);
    }

    const data  = JSON.parse(responseText);
    console.log('Token generated successfully');
    res.json({ success: true, token: data.token });

  } catch (err) {
    console.error('Real-time token error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Summarize route ───
app.post('/summarize', async (req, res) => {
  const { transcript } = req.body;
  if (!transcript) return res.status(400).json({ error: 'No transcript provided' });
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a meeting summarizer for Indian businesses.
The transcript may contain Roman script Hindi, Marathi or English.
Always respond in clear English only.
Extract:
1) One-line summary
2) Key points discussed
3) Action items (if any)
4) Decisions made (if any)
Be concise and professional.`
        },
        { role: 'user', content: 'Summarize this transcript:\n\n' + transcript }
      ],
      max_tokens: 600,
    });
    res.json({ success: true, summary: completion.choices[0].message.content });
  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: 'Summary failed: ' + err.message });
  }
});

// ─── Chat route ───
app.post('/chat', async (req, res) => {
  const { question, transcripts } = req.body;
  if (!question) return res.status(400).json({ success: false, error: 'No question provided' });
  if (!transcripts || transcripts.length === 0) return res.status(400).json({ success: false, error: 'No transcripts provided' });

  try {
    const transcriptContext = transcripts.map((t, i) => {
      const date     = new Date(t.createdAt).toLocaleDateString('en-IN');
      const speakers = t.utterances && t.utterances.length > 0
        ? t.utterances.map(u => `${u.speaker}: ${u.englishText || u.text}`).join('\n')
        : (t.englishText || t.text);
      return `--- Recording ${i + 1}: "${t.title}" (${date}) ---\n${speakers}`;
    }).join('\n\n');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are VoxNote AI, an intelligent assistant for Indian businesses.
You have access to the user's meeting transcripts and recordings.
Rules:
- Always answer in clear English
- Be specific — mention which recording the info came from
- If not in transcripts, say "I couldn't find that in your recordings"
- Keep answers concise and helpful`
        },
        {
          role: 'user',
          content: `Here are my meeting transcripts:\n\n${transcriptContext}\n\n---\n\nMy question: ${question}`
        }
      ],
      max_tokens: 800,
    });

    res.json({ success: true, answer: completion.choices[0].message.content, question });
  } catch (err) {
    console.error('/chat error:', err.message);
    res.status(500).json({ success: false, error: 'Chat failed: ' + err.message });
  }
});

// ─── HELPERS ───
const translateToEnglish = async (text) => {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a translator for Indian languages.
The text may contain Hindi, Marathi or a mix with English written in Roman script.
Rules:
1. Translate everything to clean natural English
2. Keep names, places, company names as-is
3. Keep technical terms as-is
4. If text is already in English — return it as-is
5. Return ONLY the translated text, nothing else`
        },
        { role: 'user', content: text }
      ],
      max_tokens: 2000,
    });
    return completion.choices[0].message.content;
  } catch (err) {
    console.error('Translation error:', err.message);
    return null;
  }
};

const generateSummary = async (text) => {
  try {
    // For long transcripts, use only first 8000 chars to avoid token limits
    const truncated = text.length > 8000 ? text.substring(0, 8000) + '...' : text;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a meeting summarizer for Indian businesses.
Always respond in clear English only.
Extract:
1) One-line summary
2) Key points discussed
3) Action items (if any)
4) Decisions made (if any)
Be concise and professional.`
        },
        { role: 'user', content: 'Summarize this:\n\n' + truncated }
      ],
      max_tokens: 800,
    });
    return completion.choices[0].message.content;
  } catch (err) {
    console.error('Summary generation error:', err.message);
    return null;
  }
};

const extractActionItems = async (text) => {
  try {
    const truncated = text.length > 6000 ? text.substring(0, 6000) + '...' : text;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an assistant that extracts action items from meeting transcripts.
Rules:
1. Each action item must start with a verb
2. Include who is responsible if mentioned
3. Include deadline if mentioned
4. Return ONLY a JSON array:
[{"task": "Send proposal", "owner": "Anshul", "deadline": "Friday"}]
5. If no action items, return: []
6. Return ONLY the JSON array, nothing else`
        },
        { role: 'user', content: 'Extract action items:\n\n' + truncated }
      ],
      max_tokens: 500,
    });
    const raw    = completion.choices[0].message.content.trim();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Action items error:', err.message);
    return [];
  }
};

// ─── Helper: Process completed transcript ───
const processTranscript = async (transcript) => {
  const rawText      = transcript.text || '';
  const detectedLang = transcript.language_code || 'en';
  const speakerList  = [...new Set((transcript.utterances || []).map(u => u.speaker))];

  console.log('Speakers detected:', speakerList);
  console.log('Detected language:', detectedLang);

  const utterances = transcript.utterances?.map(u => ({
    speaker: 'Speaker ' + u.speaker,
    text:    u.text,
    start:   u.start,
    end:     u.end,
    words:   u.words || [],
  })) || [];

  let englishText       = null;
  let englishUtterances = null;

  const isIndianLang = detectedLang !== 'en' ||
    /\b(hai|hain|tha|thi|mein|ka|ki|ko|aaj|kal|kya|nahi|hum|aap|tum|mere|tera|yeh|woh|karo|karenge|chahiye|aahe|pudhe|amhi|nahin|matlab|theek|achha|bilkul)\b/i.test(rawText);

  if (isIndianLang) {
    console.log('Translating to English...');
    englishText = await translateToEnglish(rawText);
    if (utterances.length > 0) {
      englishUtterances = await Promise.all(
        utterances.map(async (u) => ({
          ...u,
          englishText: await translateToEnglish(u.text),
        }))
      );
    }
  } else {
    englishText       = rawText;
    englishUtterances = utterances.map(u => ({ ...u, englishText: u.text }));
  }

  console.log('Generating summary...');
  const summaryInput = englishText || rawText;
  const autoSummary  = summaryInput ? await generateSummary(summaryInput) : null;

  console.log('Extracting action items...');
  const actionItems = summaryInput ? await extractActionItems(summaryInput) : [];

  return {
    success:      true,
    status:       'completed',
    text:         rawText,
    englishText:  englishText  || null,
    utterances:   englishUtterances || utterances,
    words:        transcript.words  || [],
    duration:     transcript.audio_duration || null,
    detectedLang: detectedLang,
    autoSummary:  autoSummary  || null,
    actionItems:  actionItems  || [],
    speakers:     speakerList.length,
  };
};

// ─── ROUTE 1: Start transcription job (returns immediately) ───
// ✅ This fixes timeout for long recordings (10 min, 1 hour, etc.)
// Returns a jobId immediately — no waiting for transcription to complete
app.post('/transcribe-start', upload.single('audio'), async (req, res) => {
  const tempPath = req.file ? req.file.path : null;
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No audio file received' });
    }

    console.log('Starting async transcription...');
    console.log('File size:', req.file.size, 'bytes');
    console.log('Duration estimate:', Math.round(req.file.size / 16000), 'seconds');

    // Upload to AssemblyAI
    console.log('Uploading to AssemblyAI...');
    const uploadUrl = await aai.files.upload(fs.createReadStream(tempPath));
    fs.unlinkSync(tempPath);
    console.log('Uploaded:', uploadUrl);

    // Submit job — returns immediately without waiting
    const job = await aai.transcripts.submit({
      audio:              uploadUrl,
      speaker_labels:     true,
      speakers_expected:  5,
      language_detection: true,
      format_text:        true,
      punctuate:          true,
      speech_models:      ['universal-3-pro'],
    });

    console.log('Job submitted! ID:', job.id);

    // Return job ID to client — client will poll for status
    res.json({ success: true, jobId: job.id });

  } catch (err) {
    console.error('/transcribe-start error:', err.message);
    try { if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── ROUTE 2: Poll job status ───
// Client calls this every 5 seconds to check if transcription is done
app.get('/transcribe-status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    console.log('Checking status for job:', jobId);

    const transcript = await aai.transcripts.get(jobId);
    console.log('Job status:', transcript.status);

    if (transcript.status === 'error') {
      return res.json({ success: false, status: 'error', error: transcript.error });
    }

    if (transcript.status === 'queued' || transcript.status === 'processing') {
      // Still working — tell client to keep polling
      return res.json({ success: true, status: transcript.status });
    }

    if (transcript.status === 'completed') {
      // Process and return full result
      console.log('Transcription completed! Processing...');
      const result = await processTranscript(transcript);
      return res.json(result);
    }

    res.json({ success: true, status: transcript.status });

  } catch (err) {
    console.error('/transcribe-status error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── ROUTE 3: Old sync route (kept for short recordings < 2 min) ───
app.post('/transcribe-speakers', upload.single('audio'), async (req, res) => {
  const tempPath = req.file ? req.file.path : null;
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No audio file received' });
    }

    console.log('Audio file received:', req.file.originalname);
    console.log('File size:', req.file.size, 'bytes');

    console.log('Step 1: Uploading to AssemblyAI...');
    const uploadUrl = await aai.files.upload(fs.createReadStream(tempPath));
    fs.unlinkSync(tempPath);
    console.log('Uploaded:', uploadUrl);

    console.log('Step 2: Transcribing...');
    const transcript = await aai.transcripts.transcribe({
      audio:              uploadUrl,
      speaker_labels:     true,
      speakers_expected:  5,
      language_detection: true,
      format_text:        true,
      punctuate:          true,
      speech_models:      ['universal-3-pro'],
    });

    console.log('Transcript status:', transcript.status);

    if (transcript.status === 'error') {
      throw new Error('AssemblyAI error: ' + transcript.error);
    }

    const result = await processTranscript(transcript);
    console.log('Processing complete!');
    res.json(result);

  } catch (err) {
    console.error('/transcribe-speakers error:', err.message);
    try { if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`VoxNote server running on port ${PORT}`);
});