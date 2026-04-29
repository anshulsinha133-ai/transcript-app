const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const OpenAI  = require('openai');
const { AssemblyAI } = require('assemblyai');
require('dotenv').config();

const app    = express();
const PORT   = process.env.PORT || 3000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const aai    = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_KEY });

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ─── FILE STORAGE ───
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

// ✅ Accept all audio types including m4a — 200MB max for long recordings
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, true);
  }
});

// ─── BASIC ROUTES ───
app.get('/', (req, res) => {
  res.send('VoxNote Server is LIVE 🎙');
});

app.get('/health', (req, res) => {
  res.json({
    status:    'OK',
    message:   'VoxNote server is running',
    timestamp: new Date()
  });
});

// ─── LOGIN ROUTES ───
app.get('/api/login', (req, res) => {
  res.send('Login route working ✅');
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password required' });
  }
  return res.json({ success: true, message: 'Login successful', token: 'demo-token' });
});

app.post('/api/register', (req, res) => {
  return res.json({ success: true, message: 'User registered (demo)' });
});

// ─── SUMMARIZE ROUTE ───
app.post('/summarize', async (req, res) => {
  const { transcript } = req.body;
  if (!transcript) return res.status(400).json({ error: 'No transcript provided' });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role:    'system',
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
        {
          role:    'user',
          content: 'Summarize this transcript:\n\n' + transcript
        }
      ],
      max_tokens: 600,
    });

    res.json({
      success: true,
      summary: completion.choices[0].message.content
    });

  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: 'Summary failed: ' + err.message });
  }
});

// ─── HELPER: Translate text to English ───
// Keeps original language text intact — only creates an English copy
const translateToEnglish = async (text) => {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role:    'system',
          content: `You are a translator for Indian languages.
The text may contain Hindi, Marathi or a mix with English (Hinglish/Marathish).
Examples:
- "Mujhe jana hai office" → "I need to go to office"
- "Aaj meeting acchi thi, client satisfied aahe" → "Today's meeting was good, client is satisfied"
- "Yeh project important hai, deadline Friday hai" → "This project is important, deadline is Friday"
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

// ─── HELPER: Generate summary ───
const generateSummary = async (text) => {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role:    'system',
          content: `You are a meeting summarizer for Indian businesses.
Always respond in clear English only.
Extract:
1) One-line summary
2) Key points discussed
3) Action items (if any)
4) Decisions made (if any)
Be concise and professional.`
        },
        {
          role:    'user',
          content: 'Summarize this:\n\n' + text
        }
      ],
      max_tokens: 600,
    });

    return completion.choices[0].message.content;
  } catch (err) {
    console.error('Summary generation error:', err.message);
    return null;
  }
};

// ─── HELPER: Extract Action Items ───
const extractActionItems = async (text) => {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an assistant that extracts action items from meeting transcripts.
Rules:
1. Each action item must start with a verb (Call, Send, Review, Schedule, etc.)
2. Include who is responsible if mentioned
3. Include deadline if mentioned
4. Return ONLY a JSON array like this:
[
  {"task": "Send proposal to client", "owner": "Anshul", "deadline": "Friday"},
  {"task": "Review Q3 report", "owner": "Team", "deadline": null}
]
5. If no action items found, return empty array: []
6. Return ONLY the JSON array, nothing else`
        },
        {
          role: 'user',
          content: 'Extract action items:\n\n' + text
        }
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

// ─── MAIN TRANSCRIPTION ROUTE ───
// ✅ Uses multipart/form-data (no base64) — fixes OOM and 502 errors
// ✅ Keeps transcript in ORIGINAL language (Hindi/Marathi/English)
// ✅ Speaker labels as User 1, User 2, User 3 etc.
// ✅ Provides English translation separately
// ✅ Extracts action items automatically
app.post('/transcribe-speakers', upload.single('audio'), async (req, res) => {
  const tempPath = req.file ? req.file.path : null;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No audio file received' });
    }

    console.log('Audio file received:', req.file.originalname);
    console.log('File size:', req.file.size, 'bytes');

    // ── STEP 1: Upload audio to AssemblyAI ──
    console.log('Step 1: Uploading to AssemblyAI...');
    const uploadUrl = await aai.files.upload(fs.createReadStream(tempPath));
    fs.unlinkSync(tempPath); // Clean up temp file
    console.log('Uploaded successfully');

    // ── STEP 2: Transcribe with speaker detection ──
    // ✅ language_detection: true → auto detects Hindi, Marathi, English
    // ✅ speaker_labels: true → separates User 1, User 2, User 3 etc.
    console.log('Step 2: Transcribing with speaker detection...');
    const transcript = await aai.transcripts.transcribe({
      audio:              uploadUrl,
      speaker_labels:     true,       // ✅ Detect different speakers
      speakers_expected:  5,          // Max 5 speakers
      language_detection: true,       // ✅ Auto detect Hindi/Marathi/English
      format_text:        true,
      punctuate:          true,
      speech_models:      ['universal-3-pro', 'universal-2'],
    });

    console.log('Transcript status:', transcript.status);
    console.log('Detected language:', transcript.language_code);
    console.log('Text preview:', transcript.text?.substring(0, 150));

    if (transcript.status === 'error') {
      throw new Error('AssemblyAI error: ' + transcript.error);
    }

    // ✅ rawText = transcript in ORIGINAL language (Hindi/Marathi/English as spoken)
    const rawText      = transcript.text || '';
    const detectedLang = transcript.language_code || 'en';

    // ✅ Get unique speakers
    const speakerList = [...new Set(
      (transcript.utterances || []).map(u => u.speaker)
    )];
    console.log('Speakers detected:', speakerList);

    // ✅ Format utterances with User 1, User 2, User 3 labels
    // Text is kept in ORIGINAL language as spoken
    const utterances = transcript.utterances?.map(u => ({
      speaker: 'User ' + u.speaker,   // ✅ User 1, User 2, User 3 etc.
      text:    u.text,                 // ✅ Original language text
      start:   u.start,
      end:     u.end,
      words:   u.words || [],
    })) || [];

    // ── STEP 3: Translate to English (only if Indian language detected) ──
    let englishText       = null;
    let englishUtterances = null;

    // ✅ Detect if Hindi/Marathi words are present
    const isIndianLang = detectedLang !== 'en' ||
      /\b(hai|hain|tha|thi|mein|ka|ki|ko|aaj|kal|kya|nahi|hum|aap|tum|mere|tera|yeh|woh|karo|karenge|chahiye|aahe|pudhe|amhi|nahin|matlab|theek|achha|bilkul|nahin|kaise|kyun|abhi)\b/i.test(rawText);

    if (isIndianLang) {
      console.log('Step 3: Indian language detected — creating English translation...');

      // ✅ Translate full text to English
      englishText = await translateToEnglish(rawText);
      console.log('English translation done');

      // ✅ Translate each speaker utterance to English separately
      if (utterances.length > 0) {
        englishUtterances = await Promise.all(
          utterances.map(async (u) => ({
            ...u,
            englishText: await translateToEnglish(u.text),
            // originalText stays in u.text (Hindi/Marathi as spoken)
          }))
        );
      }
    } else {
      // ✅ Pure English — no translation needed
      // Set englishText same as rawText for consistency
      englishText = rawText;
      englishUtterances = utterances.map(u => ({
        ...u,
        englishText: u.text,
      }));
    }

    // ── STEP 4: Generate AI Summary ──
    console.log('Step 4: Generating summary...');
    const summaryInput = englishText || rawText;
    const autoSummary  = summaryInput
      ? await generateSummary(summaryInput)
      : null;
    console.log('Summary done');

    // ── STEP 5: Extract Action Items ──
    console.log('Step 5: Extracting action items...');
    const actionItems = summaryInput
      ? await extractActionItems(summaryInput)
      : [];
    console.log('Action items found:', actionItems.length);
    console.log('✅ Processing complete!');

    // ✅ Final response
    res.json({
      success:      true,

      // ✅ Original transcript in language spoken (Hindi/Marathi/English)
      text:         rawText,

      // ✅ English translation (same as text if already English)
      englishText:  englishText || null,

      // ✅ Speaker utterances with User 1, User 2, User 3 labels
      // Each utterance has: speaker, text (original), englishText (translated)
      utterances:   englishUtterances || utterances,

      words:        transcript.words || [],
      duration:     transcript.audio_duration || null,

      // ✅ Detected language code: 'en', 'hi', 'mr' etc.
      detectedLang: detectedLang,

      autoSummary:  autoSummary  || null,
      actionItems:  actionItems  || [],
      speakers:     speakerList.length,
    });

  } catch (err) {
    console.error('/transcribe-speakers error:', err.message);
    try {
      if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (e) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── START SERVER ───
app.listen(PORT, '0.0.0.0', () => {
  console.log(`VoxNote server running on port ${PORT}`);
});