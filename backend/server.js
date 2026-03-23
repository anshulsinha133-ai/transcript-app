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
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/mpeg','audio/wav','audio/m4a','audio/mp4','audio/webm'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only audio files allowed'));
  }
});

app.get('/', (req, res) => {
  res.send('Server is LIVE');
});

app.get('/health', (req, res) => {
  res.json({
    status:    'OK',
    message:   'Transcript server is running',
    timestamp: new Date()
  });
});

app.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file received' });

  const filePath = req.file.path;
  console.log('Received: ' + req.file.originalname);

  try {
    const transcription = await openai.audio.transcriptions.create({
      file:            fs.createReadStream(filePath),
      model:           'whisper-1',
      response_format: 'verbose_json',
    });

    fs.unlinkSync(filePath);

    res.json({
      success:    true,
      transcript: transcription.text,
      duration:   transcription.duration,
      segments:   transcription.segments,
      language:   transcription.language,
    });

  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    console.error('Transcription error:', err);
    res.status(500).json({ error: 'Transcription failed: ' + err.message });
  }
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
          content: 'You are a meeting summarizer. Extract: 1) Key points 2) Action items 3) One-line summary'
        },
        {
          role:    'user',
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
    console.error('Summary error:', err);
    res.status(500).json({ error: 'Summary failed: ' + err.message });
  }
});

app.post('/transcribe-speakers', async (req, res) => {
  try {
    const { audioBase64, language } = req.body;

    if (!audioBase64) {
      return res.status(400).json({ success: false, error: 'No audio data received' });
    }

    console.log('Received audio base64, length:', audioBase64.length);

    // Convert base64 to Buffer — Node.js native, works perfectly
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    console.log('Audio buffer size:', audioBuffer.length, 'bytes');

    // Save temporarily to disk
    const tempPath = path.join(uploadsDir, `temp-${Date.now()}.m4a`);
    fs.writeFileSync(tempPath, audioBuffer);
    console.log('Saved temp file:', tempPath);

    // Upload to AssemblyAI using official SDK
    const uploadUrl = await aai.files.upload(fs.createReadStream(tempPath));
    console.log('Uploaded to AssemblyAI:', uploadUrl);

    // Delete temp file
    fs.unlinkSync(tempPath);

    // Transcribe with speaker detection
    const transcript = await aai.transcripts.transcribe({
      audio:             uploadUrl,
      speaker_labels:    true,
      speakers_expected: 2,
      language_code:     language || 'en',
      format_text:       true,
      punctuate:         true,
      speech_models:     ['universal-2'],
    });

    console.log('Transcript status:', transcript.status);
    console.log('Transcript text preview:', transcript.text?.substring(0, 100));

    if (transcript.status === 'error') {
      throw new Error('AssemblyAI error: ' + transcript.error);
    }

    res.json({
      success:    true,
      text:       transcript.text,
      utterances: transcript.utterances || [],
      words:      transcript.words      || [],
      duration:   transcript.audio_duration,
    });

  } catch (err) {
    console.error('/transcribe-speakers error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});