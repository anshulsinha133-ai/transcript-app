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

// ─── HELPER: Translate Romanized Hindi/Marathi to English ───
const translateToEnglish = async (text, mode) => {
  try {
    let systemPrompt = '';

    if (mode === 'mumbai') {
      systemPrompt = `You are a translator for Mumbai's mixed language speech.
People in Mumbai mix Hindi, Marathi and English naturally in one sentence.
The text is written in Roman script (English alphabet).
Examples:
- "Mujhe jana hai office" → "I need to go to office"
- "Aaj meeting acchi thi, client satisfied aahe" → "Today's meeting was good, client is satisfied"
- "Pudhe kaam karte hai, let's finalize by Friday" → "We will work ahead, let's finalize by Friday"
Rules:
1. Translate everything to clean natural English
2. Keep names, places, company names as-is
3. Keep technical terms as-is
4. Match the tone — casual stays casual, formal stays formal
5. Return ONLY the translated text, nothing else`;
    } else if (mode === 'hi') {
      systemPrompt = `You are a Hindi to English translator.
The Hindi text is written in Roman script (English alphabet).
Examples:
- "Mujhe jana hai tum chalogi" → "I need to go, will you come?"
- "Aaj bahut kaam tha office mein" → "There was a lot of work in office today"
- "Hum kal milenge" → "We will meet tomorrow"
Rules:
1. Translate to clean natural English
2. Keep names and places as-is
3. Return ONLY the translated text, nothing else`;
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
The transcript may contain Romanized Hindi, Marathi or English.
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

    console.log('Mode:', mode, '| Audio length:', audioBase64.length);

    // Convert base64 to Buffer
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    console.log('Buffer size:', audioBuffer.length, 'bytes');

    // Save temp file
    const tempPath = path.join(uploadsDir, `temp-${Date.now()}.m4a`);
    fs.writeFileSync(tempPath, audioBuffer);

    let rawText    = '';
    let utterances = [];

    if (mode === 'en') {
      // ── ENGLISH MODE → AssemblyAI (best speaker detection) ──
      console.log('Using AssemblyAI for English mode');

      const uploadUrl = await aai.files.upload(fs.createReadStream(tempPath));
      fs.unlinkSync(tempPath);
      console.log('Uploaded to AssemblyAI:', uploadUrl);

      const transcript = await aai.transcripts.transcribe({
        audio:              uploadUrl,
        speaker_labels:     true,
        speakers_expected:  5,
        language_detection: true,
        format_text:        true,
        punctuate:          true,
        speech_models:      ['universal-2'],
      });

      console.log('AssemblyAI status:', transcript.status);
      if (transcript.status === 'error') {
        throw new Error('AssemblyAI error: ' + transcript.error);
      }

      rawText    = transcript.text || '';
      utterances = transcript.utterances?.map(u => ({
        speaker: 'Speaker ' + u.speaker,
        text:    u.text,
        start:   u.start,
        end:     u.end,
        words:   u.words || [],
      })) || [];

    } else {
      // ── HINDI / MUMBAI MODE → Whisper (best for Indian languages) ──
      console.log('Using Whisper for mode:', mode);

      const whisperOptions = {
        file:            fs.createReadStream(tempPath),
        model:           'whisper-1',
        response_format: 'verbose_json',
      };

      // Set prompt to guide Whisper for romanization
      if (mode === 'hi') {
        whisperOptions.language = 'hi';
        whisperOptions.prompt   = 'Write in Roman script using English alphabet. Example: Mujhe jana hai tum chalogi';
      }

      if (mode === 'mumbai') {
        // No language lock — let Whisper auto detect mixed language
        whisperOptions.prompt = 'This is Mumbai speech mixing Hindi Marathi and English. Write in Roman script using English alphabet only. Example: Aaj meeting mein kya hua client satisfied tha pudhe kaam karte hai';
      }

      const whisperResult = await openai.audio.transcriptions.create(whisperOptions);
      fs.unlinkSync(tempPath);

      console.log('Whisper result:', whisperResult.text?.substring(0, 150));
      rawText = whisperResult.text || '';

      // Create utterances from Whisper segments
      if (whisperResult.segments && whisperResult.segments.length > 0) {
        // Group segments into speaker blocks (Whisper doesn't detect speakers)
        utterances = whisperResult.segments.map((seg, i) => ({
          speaker: 'Speaker A',
          text:    seg.text.trim(),
          start:   Math.round(seg.start * 1000),
          end:     Math.round(seg.end   * 1000),
          words:   [],
        }));
      } else {
        utterances = [{
          speaker: 'Speaker A',
          text:    rawText,
          start:   0,
          end:     0,
          words:   [],
        }];
      }
    }

    console.log('Raw text preview:', rawText.substring(0, 150));

    // ── TRANSLATE TO ENGLISH (Hindi/Mumbai modes) ──
    let englishText       = null;
    let englishUtterances = null;

    if (mode === 'hi' || mode === 'mumbai') {
      console.log('Translating to English...');

      // Translate full text
      englishText = await translateToEnglish(rawText, mode);
      console.log('English text:', englishText?.substring(0, 150));

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

    // ── GENERATE SUMMARY IN ENGLISH ──
    const summaryInput = englishText || rawText;
    const autoSummary  = summaryInput
      ? await generateSummary(summaryInput)
      : null;

    console.log('Summary generated:', autoSummary?.substring(0, 100));

    res.json({
      success:      true,
      text:         rawText,
      englishText:  englishText,
      utterances:   englishUtterances || utterances,
      words:        [],
      duration:     null,
      autoSummary:  autoSummary,
      mode:         mode || 'en',
    });

  } catch (err) {
    console.error('/transcribe-speakers error:', err.message);
    // Clean up temp file if exists
    try {
      const files = fs.readdirSync(uploadsDir);
      files.filter(f => f.startsWith('temp-')).forEach(f => {
        const fp = path.join(uploadsDir, f);
        if (Date.now() - fs.statSync(fp).mtimeMs > 60000) {
          fs.unlinkSync(fp);
        }
      });
    } catch (e) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`VoxNote server running on port ${PORT}`);
});