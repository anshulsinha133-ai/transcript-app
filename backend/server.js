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

// ─── FILE STORAGE ───
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

// ─── BASIC ROUTES ───
app.get('/', (req, res) => {
  res.send('VoxNote Server is LIVE 🎙');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'VoxNote server is running',
    timestamp: new Date()
  });
});

// ─── LOGIN ROUTES ───
app.get('/api/login', (req, res) => {
  res.send("Login route working ✅");
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password required"
    });
  }

  return res.json({
    success: true,
    message: "Login successful",
    token: "demo-token"
  });
});

app.post('/api/register', (req, res) => {
  return res.json({
    success: true,
    message: "User registered (demo)"
  });
});

// ─── SUMMARIZE ───
app.post('/summarize', async (req, res) => {
  const { transcript } = req.body;

  if (!transcript) {
    return res.status(400).json({ error: 'No transcript provided' });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a meeting summarizer. Give:
1) Summary
2) Key points
3) Action items`
        },
        {
          role: 'user',
          content: transcript
        }
      ],
      max_tokens: 600,
    });

    res.json({
      success: true,
      summary: completion.choices[0].message.content
    });

  } catch (err) {
    console.error("SUMMARY ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── TRANSLATE ───
const translateToEnglish = async (text) => {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Translate to English' },
        { role: 'user', content: text }
      ]
    });

    return completion.choices[0].message.content;

  } catch (err) {
    console.error("TRANSLATION ERROR:", err.message);
    return null;
  }
};

// ─── SUMMARY HELPER ───
const generateSummary = async (text) => {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Summarize clearly' },
        { role: 'user', content: text }
      ]
    });

    return completion.choices[0].message.content;

  } catch (err) {
    console.error("SUMMARY HELPER ERROR:", err.message);
    return null;
  }
};

// ─── TRANSCRIBE (UPGRADED WITH SPEAKERS) ───
app.post('/transcribe-speakers', async (req, res) => {
  const tempPath = path.join(uploadsDir, `temp-${Date.now()}.m4a`);

  try {
    const { audioBase64 } = req.body;

    if (!audioBase64) {
      return res.status(400).json({ success: false, error: 'No audio data' });
    }

    const buffer = Buffer.from(audioBase64, 'base64');
    fs.writeFileSync(tempPath, buffer);

    const uploadUrl = await aai.files.upload(fs.createReadStream(tempPath));
    fs.unlinkSync(tempPath);

    // ✅ FINAL TRANSCRIPTION CONFIG
    const transcript = await aai.transcripts.transcribe({
      audio: uploadUrl,
      speaker_labels: true,
      speech_models: ['universal']
    });

    if (transcript.status === 'error') {
      throw new Error(transcript.error);
    }

    const text = transcript.text || '';

    // ✅ NEW: SPEAKER-WISE DATA
    const utterances = transcript.utterances || [];

    const speakers = utterances.map((u) => ({
      speaker: `Speaker ${u.speaker}`,
      text: u.text,
      start: u.start,
      end: u.end
    }));

    const englishText = await translateToEnglish(text);
    const summary     = await generateSummary(englishText || text);

    res.json({
      success: true,
      fullTranscript: text,
      englishText,
      summary,
      speakers   // ✅ NEW OUTPUT
    });

  } catch (err) {
    console.error("TRANSCRIPTION ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── START SERVER ───
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});