const express    = require('express');
const multer     = require('multer');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const OpenAI     = require('openai');
const { AssemblyAI } = require('assemblyai');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app    = express();
const PORT   = process.env.PORT || 3000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const aai    = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
  limits: { fileSize: 500 * 1024 * 1024 },
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
    const response = await fetch(
      `https://streaming.assemblyai.com/v3/token?expires_in_seconds=480`,
      { method: 'GET', headers: { 'Authorization': process.env.ASSEMBLYAI_KEY } }
    );
    const responseText = await response.text();
    if (!response.ok) throw new Error(`Token error: ${response.status} ${responseText}`);
    const data = JSON.parse(responseText);
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

// ─── SHARE: Generate share link ───
app.post('/share/generate', async (req, res) => {
  const { transcriptId } = req.body;
  if (!transcriptId) return res.status(400).json({ success: false, error: 'No transcriptId provided' });
  try {
    const token = crypto.randomBytes(20).toString('hex');
    const { error } = await supabase
      .from('transcripts')
      .update({ share_token: token })
      .eq('id', transcriptId);
    if (error) throw error;
    const shareUrl = `${process.env.RENDER_URL || 'https://transcript-app-lbpe.onrender.com'}/share/${token}`;
    res.json({ success: true, shareUrl, token });
  } catch (err) {
    console.error('/share/generate error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── SHARE: Revoke share link ───
app.post('/share/revoke', async (req, res) => {
  const { transcriptId } = req.body;
  if (!transcriptId) return res.status(400).json({ success: false, error: 'No transcriptId provided' });
  try {
    const { error } = await supabase
      .from('transcripts')
      .update({ share_token: null })
      .eq('id', transcriptId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('/share/revoke error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── SHARE: Public read-only page ───
app.get('/share/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { data, error } = await supabase
      .from('transcripts')
      .select('*')
      .eq('share_token', token)
      .single();

    if (error || !data) {
      return res.status(404).send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#F5F7FA;">
          <h2>🔗 Link not found</h2>
          <p style="color:#888;">This link may have expired or been revoked.</p>
        </body></html>
      `);
    }

    const date     = new Date(data.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const duration = data.duration ? Math.round(data.duration / 60) + ' min' : 'N/A';
    const words    = data.word_count || 0;

    let summaryHTML = '';
    if (data.auto_summary) {
      summaryHTML = `
        <div class="section">
          <div class="section-title" style="color:#1A7A4A;border-left-color:#1A7A4A;">🤖 AI Summary</div>
          <div style="background:#F0FAF4;padding:16px;border-radius:8px;font-size:14px;line-height:1.8;color:#333;white-space:pre-wrap;">${data.auto_summary}</div>
        </div>`;
    }

    let actionHTML = '';
    if (data.action_items?.length > 0) {
      const rows = data.action_items.map((item, i) => `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #FFE0B2;font-weight:600;color:#E65100;">${i + 1}</td>
          <td style="padding:10px;border-bottom:1px solid #FFE0B2;">${item.task}</td>
          <td style="padding:10px;border-bottom:1px solid #FFE0B2;color:#666;">${item.owner || '—'}</td>
          <td style="padding:10px;border-bottom:1px solid #FFE0B2;color:#666;">${item.deadline || '—'}</td>
        </tr>`).join('');
      actionHTML = `
        <div class="section">
          <div class="section-title" style="color:#E65100;border-left-color:#FF9800;">✅ Action Items</div>
          <table style="width:100%;border-collapse:collapse;background:#FFF8F0;border-radius:8px;">
            <thead><tr style="background:#FF9800;">
              <th style="padding:10px;color:#fff;text-align:left;width:40px;">#</th>
              <th style="padding:10px;color:#fff;text-align:left;">Task</th>
              <th style="padding:10px;color:#fff;text-align:left;width:120px;">Owner</th>
              <th style="padding:10px;color:#fff;text-align:left;width:120px;">Deadline</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }

    const speakerColors = ['#1A56A0','#1A7A4A','#C85A00','#8B1AAF','#C0392B','#0097A7','#795548','#E91E63'];
    const speakerBG     = ['#E8F0FC','#E8F5EE','#FEF3E8','#F3E8FE','#FDE8E8','#E0F7FA','#F3EDEB','#FCE4EC'];

    let transcriptHTML = '';
    if (data.utterances?.length > 0) {
      const getSpeakerIdx = (speaker) => {
        const code = speaker?.slice(-1)?.toUpperCase().charCodeAt(0) || 65;
        return (code >= 65 && code <= 72) ? code - 65 : Math.abs(code - 65) % 8;
      };
      const utterancesHTML = data.utterances.map(u => {
        const idx   = getSpeakerIdx(u.speaker);
        const start = u.start ? `${Math.floor(u.start/60000).toString().padStart(2,'0')}:${Math.floor((u.start%60000)/1000).toString().padStart(2,'0')}` : '';
        const end   = u.end   ? `${Math.floor(u.end/60000).toString().padStart(2,'0')}:${Math.floor((u.end%60000)/1000).toString().padStart(2,'0')}` : '';
        return `
          <div style="background:${speakerBG[idx]};border-radius:10px;padding:14px;margin-bottom:12px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
              <span style="background:${speakerColors[idx]};color:#fff;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:700;">${u.speaker}</span>
              <span style="font-size:11px;color:#888;">${start} — ${end}</span>
            </div>
            <div style="font-size:14px;color:#333;line-height:1.7;">${u.englishText || u.text}</div>
            ${u.englishText && u.englishText !== u.text ? `<div style="font-size:12px;color:#888;margin-top:6px;font-style:italic;">${u.text}</div>` : ''}
          </div>`;
      }).join('');
      transcriptHTML = `
        <div class="section">
          <div class="section-title">🎙 Speaker Transcript</div>
          ${utterancesHTML}
        </div>`;
    } else {
      transcriptHTML = `
        <div class="section">
          <div class="section-title">📝 Full Transcript</div>
          <div style="font-size:14px;color:#333;line-height:1.8;white-space:pre-wrap;">${data.english_text || data.text}</div>
        </div>`;
    }

    const html = `<!DOCTYPE html><html>
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>${data.title} — VoxNote</title>
        <style>
          * { margin:0; padding:0; box-sizing:border-box; }
          body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#F5F7FA; color:#333; }
          .header { background:linear-gradient(135deg,#0D3B7A,#1A56A0); color:white; padding:32px 24px; }
          .logo { font-size:12px; font-weight:700; letter-spacing:2px; color:#AACFEE; margin-bottom:12px; text-transform:uppercase; }
          .title { font-size:22px; font-weight:800; margin-bottom:16px; line-height:1.3; }
          .meta-grid { display:flex; gap:12px; flex-wrap:wrap; }
          .meta-item { background:rgba(255,255,255,0.15); padding:8px 14px; border-radius:8px; font-size:12px; }
          .meta-label { color:#AACFEE; font-size:10px; text-transform:uppercase; letter-spacing:1px; margin-bottom:2px; }
          .meta-value { color:#fff; font-weight:600; }
          .read-only-badge { display:inline-block; background:rgba(255,255,255,0.2); border:1px solid rgba(255,255,255,0.4); border-radius:20px; padding:6px 14px; font-size:11px; color:#fff; margin-top:16px; }
          .body { padding:24px; max-width:800px; margin:0 auto; }
          .section { margin-bottom:28px; }
          .section-title { font-size:15px; font-weight:700; color:#0D3B7A; margin-bottom:14px; padding-left:12px; border-left:4px solid #1A56A0; }
          .footer { text-align:center; padding:24px; font-size:11px; color:#AAA; border-top:1px solid #EEE; margin-top:20px; }
          .footer a { color:#1A56A0; text-decoration:none; font-weight:600; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo">VoxNote — AI Transcription</div>
          <div class="title">${data.title}</div>
          <div class="meta-grid">
            <div class="meta-item"><div class="meta-label">Date</div><div class="meta-value">${date}</div></div>
            <div class="meta-item"><div class="meta-label">Duration</div><div class="meta-value">${duration}</div></div>
            <div class="meta-item"><div class="meta-label">Words</div><div class="meta-value">${words}</div></div>
          </div>
          <div class="read-only-badge">🔗 Shared read-only view</div>
        </div>
        <div class="body">${summaryHTML}${actionHTML}${transcriptHTML}</div>
        <div class="footer">Shared via <a href="https://play.google.com/store/apps/details?id=com.voxnote.app">VoxNote AI Transcription</a> — Available on Google Play</div>
      </body></html>`;

    res.send(html);
  } catch (err) {
    console.error('/share/:token error:', err.message);
    res.status(500).send('<h2>Something went wrong</h2>');
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

const generateTitle = async (text, detectedLang) => {
  try {
    const truncated = text.length > 3000 ? text.substring(0, 3000) + '...' : text;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a title generator for meeting/conversation transcripts.
Rules:
1. Generate a SHORT, descriptive title in English only (even if transcript is Hindi/Marathi)
2. Format: "[Topic] — [Key Context]"
3. Examples: "Team Standup — Sprint Planning", "Client Call — Budget Discussion", "Interview — Frontend Developer"
4. Max 6 words total
5. Return ONLY the title, nothing else — no quotes, no punctuation at end`
        },
        { role: 'user', content: 'Generate a title for this transcript:\n\n' + truncated }
      ],
      max_tokens: 30,
    });
    return completion.choices[0].message.content.trim();
  } catch (err) {
    console.error('Title generation error:', err.message);
    return null;
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

  console.log('Generating smart title...');
  const smartTitle = summaryInput ? await generateTitle(summaryInput, detectedLang) : null;
  console.log('Smart title result:', smartTitle);

  return {
    success:      true,
    status:       'completed',
    text:         rawText,
    smartTitle:   smartTitle  || null,
    englishText:  englishText || null,
    utterances:   englishUtterances || utterances,
    words:        transcript.words  || [],
    duration:     transcript.audio_duration || null,
    detectedLang: detectedLang,
    autoSummary:  autoSummary  || null,
    actionItems:  actionItems  || [],
    speakers:     speakerList.length,
  };
};

// ─── ROUTE 1: Start transcription job ───
// ✅ Now submits with webhook URL so AssemblyAI calls us when done
app.post('/transcribe-start', upload.single('audio'), async (req, res) => {
  const tempPath = req.file ? req.file.path : null;
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No audio file received' });

    console.log('Starting async transcription...');
    console.log('File size:', req.file.size, 'bytes');

    console.log('Uploading to AssemblyAI...');
    const uploadUrl = await aai.files.upload(fs.createReadStream(tempPath));
    fs.unlinkSync(tempPath);
    console.log('Uploaded:', uploadUrl);

    const webhookUrl = `${process.env.RENDER_URL}/webhook/assemblyai`;

    const job = await aai.transcripts.submit({
      audio:              uploadUrl,
      speaker_labels:     true,
      speakers_expected:  5,
      language_detection: true,
      format_text:        true,
      punctuate:          true,
      speech_models:      ['universal-3-pro', 'universal-2'],
      webhook_url:        webhookUrl, // ✅ AssemblyAI will call this when done
    });

    console.log('Job submitted with webhook! ID:', job.id);

    // ✅ Save job as processing in Supabase immediately
    await supabase.from('transcription_jobs').insert({
      id:     job.id,
      status: 'processing',
    });

    res.json({ success: true, jobId: job.id });

  } catch (err) {
    console.error('/transcribe-start error:', err.message);
    try { if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── WEBHOOK: AssemblyAI calls this when transcription is done ───
// ✅ This is the key fix — no more duplicate processing!
// AssemblyAI calls this once → we process once → store result in Supabase
app.post('/webhook/assemblyai', async (req, res) => {
  try {
    const { transcript_id, status } = req.body;
    console.log('Webhook received! Job:', transcript_id, 'Status:', status);

    // Respond immediately so AssemblyAI doesn't retry
    res.json({ success: true });

    if (status !== 'completed') {
      console.log('Webhook status not completed:', status);
      await supabase.from('transcription_jobs')
        .update({ status })
        .eq('id', transcript_id);
      return;
    }

    // ✅ Check if already processed — prevents duplicate processing
    const { data: existingJob } = await supabase
      .from('transcription_jobs')
      .select('status, result')
      .eq('id', transcript_id)
      .single();

    if (existingJob?.status === 'done') {
      console.log('Job already processed, skipping:', transcript_id);
      return;
    }

    // ✅ Fetch full transcript from AssemblyAI
    console.log('Fetching transcript from AssemblyAI...');
    const transcript = await aai.transcripts.get(transcript_id);

    if (transcript.status !== 'completed') {
      console.log('Transcript not ready yet:', transcript.status);
      return;
    }

    // ✅ Process ONCE — translate, summarize, title
    console.log('Processing transcript (webhook)...');
    const result = await processTranscript(transcript);

    // ✅ Store result in Supabase — phone fetches this instead of reprocessing
    await supabase.from('transcription_jobs')
      .update({
        status:       'done',
        result:       result,
        completed_at: new Date().toISOString(),
      })
      .eq('id', transcript_id);

    console.log('Webhook processing complete! Job:', transcript_id);

  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

// ─── ROUTE 2: Poll job status ───
// ✅ Now checks Supabase cache first — no more reprocessing!
app.get('/transcribe-status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    console.log('Checking status for job:', jobId);

    // ✅ Check Supabase cache first
    const { data: cachedJob } = await supabase
      .from('transcription_jobs')
      .select('status, result')
      .eq('id', jobId)
      .single();

    if (cachedJob?.status === 'done' && cachedJob?.result) {
      console.log('Returning cached result for job:', jobId);
      return res.json(cachedJob.result);
    }

    // ✅ Not done yet — check AssemblyAI for current status
    const transcript = await aai.transcripts.get(jobId);
    console.log('AssemblyAI job status:', transcript.status);

    if (transcript.status === 'error') {
      await supabase.from('transcription_jobs')
        .update({ status: 'error' })
        .eq('id', jobId);
      return res.json({ success: false, status: 'error', error: transcript.error });
    }

    if (transcript.status === 'queued' || transcript.status === 'processing') {
      return res.json({ success: true, status: transcript.status });
    }

    // ✅ Completed but webhook hasn't fired yet — process now and cache
    if (transcript.status === 'completed') {
      // Check again if another request already processed it
      const { data: recheckJob } = await supabase
        .from('transcription_jobs')
        .select('status, result')
        .eq('id', jobId)
        .single();

      if (recheckJob?.status === 'done' && recheckJob?.result) {
        console.log('Returning cached result (recheck) for job:', jobId);
        return res.json(recheckJob.result);
      }

      console.log('Processing completed transcript (fallback)...');
      const result = await processTranscript(transcript);

      // ✅ Cache it so this never runs again for this job
      await supabase.from('transcription_jobs')
        .update({
          status:       'done',
          result:       result,
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId);

      return res.json(result);
    }

    res.json({ success: true, status: transcript.status });

  } catch (err) {
    console.error('/transcribe-status error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── ROUTE 3: Old sync route (kept for short recordings) ───
app.post('/transcribe-speakers', upload.single('audio'), async (req, res) => {
  const tempPath = req.file ? req.file.path : null;
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No audio file received' });

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
      speech_models:      ['universal-3-pro', 'universal-2'],
    });

    if (transcript.status === 'error') throw new Error('AssemblyAI error: ' + transcript.error);

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