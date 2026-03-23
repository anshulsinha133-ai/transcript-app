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

// ─── HELPER: Translate mixed language transcript to English ───
const translateToEnglish = async (text, mode) => {
  try {
    let systemPrompt = '';

    if (mode === 'mumbai') {
      systemPrompt = `You are a translator specializing in Mumbai's mixed language communication.
People in Mumbai naturally mix Hindi, Marathi, and English in one sentence.
The transcript will contain Romanized Hindi/Marathi words mixed with English.
Your job is to:
1. Translate everything to clean, natural English
2. Keep names, places, and technical terms as-is
3. Keep the meaning and tone exactly the same
4. Do not add any extra words or explanations
Just return the translated text only.`;
    } else if (mode === 'delhi') {
      systemPrompt = `You are a translator specializing in Delhi's mixed language communication.
People in Delhi naturally mix Hindi, Punjabi, and English in one sentence.
Translate everything to clean, natural English.
Keep names, places, and technical terms as-is.
Just return the translated text only.`;
    } else if (mode === 'hindi') {
      systemPrompt = `You are a Hindi to English translator.
Translate the following Hindi text (written in Roman script) to clean English.
Keep names, places, and technical terms as-is.
Just return the translated text only.`;
    } else {
      return null;
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: text }
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
The transcript may contain mixed Hindi, Marathi, and English.
Always respond in clear English.
Extract:
1) One-line summary
2) Key points discussed
3) Action items with owners (if mentioned)
4) Decisions made
Be concise and professional.`
        },
        {
          role:    'user',
          content: 'Summarize this transcript:\n\n' + text
        }
      ],
      max_tokens: 600,
    });

    return completion.choices[0].message.content;
  } catch (err) {
    console.error('Summary error:', err.message);
    return null;
  }
};

// ─── MAIN ROUTE: Transcribe with speakers + language mode ───
app.post('/transcribe-speakers', async (req, res) => {
  try {
    const { audioBase64, language, mode } = req.body;

    if (!audioBase64) {
      return res.status(400).json({ success: false, error: 'No audio data received' });
    }

    console.log('Received audio, length:', audioBase64.length, 'mode:', mode);

    // Convert base64 to Buffer
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    console.log('Buffer size:', audioBuffer.length, 'bytes');

    // Save temp file
    const tempPath = path.join(uploadsDir, `temp-${Date.now()}.m4a`);
    fs.writeFileSync(tempPath, audioBuffer);

    // Upload to AssemblyAI
    const uploadUrl = await aai.files.upload(fs.createReadStream(tempPath));
    console.log('Uploaded to AssemblyAI:', uploadUrl);

    // Delete temp file
    fs.unlinkSync(tempPath);

    // Determine language code for AssemblyAI
    // For mixed language modes — use English as base
    // AssemblyAI handles Romanized Hindi/Marathi well with English model
    let languageCode = 'en';
    if (language === 'hi' && mode !== 'mumbai' && mode !== 'delhi') {
      languageCode = 'hi';
    }

    // Transcribe with AssemblyAI
    const transcript = await aai.transcripts.transcribe({
      audio:             uploadUrl,
      speaker_labels:    true,
      speakers_expected: 5,
      language_code:     languageCode,
      format_text:       true,
      punctuate:         true,
      speech_models:     ['universal-2'],
    });

    console.log('Transcript status:', transcript.status);
    console.log('Transcript preview:', transcript.text?.substring(0, 150));

    if (transcript.status === 'error') {
      throw new Error('AssemblyAI error: ' + transcript.error);
    }

    // Format utterances
    const utterances = transcript.utterances?.map(u => ({
      speaker: 'Speaker ' + u.speaker,
      text:    u.text,
      start:   u.start,
      end:     u.end,
      words:   u.words,
    })) || [];

    // Translate if mode requires it
    let englishText       = null;
    let englishUtterances = null;

    if (mode === 'mumbai' || mode === 'delhi' || mode === 'hindi') {
      console.log('Translating to English, mode:', mode);

      // Translate full text
      englishText = await translateToEnglish(transcript.text, mode);

      // Translate each utterance
      if (utterances.length > 0) {
        englishUtterances = await Promise.all(
          utterances.map(async (u) => ({
            ...u,
            englishText: await translateToEnglish(u.text, mode),
          }))
        );
      }
    }

    // Generate summary in English
    const summaryText = transcript.text
      ? await generateSummary(englishText || transcript.text)
      : null;

    res.json({
      success:           true,
      text:              transcript.text,
      englishText:       englishText,
      utterances:        englishUtterances || utterances,
      words:             transcript.words || [],
      duration:          transcript.audio_duration,
      autoSummary:       summaryText,
      mode:              mode || 'en',
    });

  } catch (err) {
    console.error('/transcribe-speakers error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`VoxNote server running on port ${PORT}`);
});