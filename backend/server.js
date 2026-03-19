const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const OpenAI  = require('openai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors({
  origin: "*",
}));
app.use(express.json());

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/mpeg','audio/wav','audio/m4a','audio/mp4','audio/webm'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only audio files allowed'));
  }
});

// ✅ ROOT ROUTE (for testing)
app.get("/", (req, res) => {
  res.send("Server is LIVE");
});

// ✅ HEALTH ROUTE
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Transcript server is running',
    timestamp: new Date()
  });
});

// ✅ TRANSCRIBE
app.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file received' });

  const filePath = req.file.path;
  console.log('Received: ' + req.file.originalname);

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-1',
      response_format: 'verbose_json',
    });

    fs.unlinkSync(filePath);

    res.json({
      success: true,
      transcript: transcription.text,
      duration: transcription.duration,
      segments: transcription.segments,
      language: transcription.language,
    });

  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    console.error("Transcription error:", err);

    res.status(500).json({ error: 'Transcription failed: ' + err.message });
  }
});

// ✅ SUMMARIZE
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
          content: 'You are a meeting summarizer. Extract: 1) Key points 2) Action items 3) One-line summary'
        },
        {
          role: 'user',
          content: 'Summarize this transcript:\n\n' + transcript
        }
      ],
      max_tokens: 500,
    });

    res.json({
      success: true,
      summary: completion.choices[0].message.content
    });

  } catch (err) {
    console.error("Summary error:", err);
    res.status(500).json({ error: 'Summary failed: ' + err.message });
  }
});

// ✅ SINGLE LISTEN (ONLY ONE — VERY IMPORTANT)
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});