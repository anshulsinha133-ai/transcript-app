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
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/mpeg','audio/wav','audio/m4a','audio/mp4','audio/webm'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only audio files allowed'));
  }
});

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

// ─── HELPER: Translate Roman script Hindi/Marathi to English ───
const translateToEnglish = async (text) => {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role:    'system',
          content: `You are a translator for Indian languages.
The text may contain Hindi, Marathi or a mix with English written in Roman script.
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

// ─── HELPER: Generate English summary ───
const generateSummary = async (text) => {
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

// ─── MAIN ROUTE: Smart auto-detect with Universal-3 Pro ───
app.post('/transcribe-speakers', async (req, res) => {
  const tempPath = path.join(uploadsDir, `temp-${Date.now()}.m4a`);

  try {
    const { audioBase64 } = req.body;

    if (!audioBase64) {
      return res.status(400).json({ success: false, error: 'No audio data received' });
    }

    console.log('Audio received, length:', audioBase64.length);

    // Convert base64 to Buffer
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    console.log('Buffer size:', audioBuffer.length, 'bytes');

    // Save temp file
    fs.writeFileSync(tempPath, audioBuffer);

    // ── STEP 1: Upload to AssemblyAI ──
    console.log('Step 1: Uploading to AssemblyAI...');
    const uploadUrl = await aai.files.upload(fs.createReadStream(tempPath));
    fs.unlinkSync(tempPath);
    console.log('Uploaded:', uploadUrl);

    // ── STEP 2: Transcribe with Universal-3 Pro ──
    // Universal-3 Pro handles Hindi + Marathi + English automatically
    // Returns Roman script for Indian languages
    console.log('Step 2: Transcribing with Universal-3 Pro...');
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
    console.log('Detected language:', transcript.language_code);
    console.log('Text preview:', transcript.text?.substring(0, 150));

    if (transcript.status === 'error') {
      throw new Error('AssemblyAI error: ' + transcript.error);
    }

    const rawText       = transcript.text || '';
    const detectedLang  = transcript.language_code || 'en';
    const speakers      = [...new Set(
      (transcript.utterances || []).map(u => u.speaker)
    )];

    console.log('Speakers detected:', speakers);

    // Format utterances
    const utterances = transcript.utterances?.map(u => ({
      speaker: 'Speaker ' + u.speaker,
      text:    u.text,
      start:   u.start,
      end:     u.end,
      words:   u.words || [],
    })) || [];

    // ── STEP 3: Translate if Indian language detected ──
    let englishText       = null;
    let englishUtterances = null;

    const isIndianLang = detectedLang !== 'en' ||
      /\b(hai|hain|tha|thi|mein|ka|ki|ko|aaj|kal|kya|nahi|hum|aap|tum|mere|tera|yeh|woh|karo|karenge|chahiye|aahe|pudhe|amhi|nahin|matlab|theek|achha|bilkul)\b/i.test(rawText);

    if (isIndianLang) {
      console.log('Step 3: Indian language detected — translating...');

      englishText = await translateToEnglish(rawText);
      console.log('English text:', englishText?.substring(0, 150));

      if (utterances.length > 0) {
        englishUtterances = await Promise.all(
          utterances.map(async (u) => ({
            ...u,
            englishText: await translateToEnglish(u.text),
          }))
        );
      }
    }

    // ── STEP 4: Generate summary ──
    console.log('Step 4: Generating summary...');
    const summaryInput = englishText || rawText;
    const autoSummary  = summaryInput
      ? await generateSummary(summaryInput)
      : null;

    console.log('Summary:', autoSummary?.substring(0, 100));
    console.log('Processing complete!');

    res.json({
      success:      true,
      text:         rawText,
      englishText:  englishText  || null,
      utterances:   englishUtterances || utterances,
      words:        transcript.words  || [],
      duration:     transcript.audio_duration || null,
      detectedLang: detectedLang,
      autoSummary:  autoSummary  || null,
      speakers:     speakers.length,
    });

  } catch (err) {
    console.error('/transcribe-speakers error:', err.message);
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (e) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`VoxNote server running on port ${PORT}`);
});