const express    = require('express');
const multer     = require('multer');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const OpenAI     = require('openai');
const { AssemblyAI } = require('assemblyai');
const { SarvamAIClient } = require('sarvamai');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app    = express();
const PORT   = process.env.PORT || 3000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const aai    = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_KEY });
const sarvam = new SarvamAIClient({ apiSubscriptionKey: process.env.SARVAM_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use((req, res, next) => { res.setTimeout(300000); next(); });

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

// ─── MASTER PROMPT ────────────────────────────────────────────────────────────
function buildMasterPrompt(contextHint) {
  return `${contextHint}

I will provide a transcript of a lecture, discussion, meeting, or conversation.
Analyze it STRICTLY based only on the transcript content.

## Critical Rules
- Do NOT hallucinate.
- Do NOT add facts, assumptions, interpretations, names, timelines, or context not explicitly supported by the transcript.
- If something is unclear, state: "Not clearly stated in transcript."
- Preserve original meaning exactly.
- Do NOT inject external knowledge or recommendations unless explicitly requested.
- Be concise. Do NOT repeat the same information in multiple sections.
- Each section must contain ONLY new information not already covered in another section.
- Separate explicit facts from possible inference.
- If speakers are unclear, label them as: Speaker 1, Speaker 2, etc.
- The transcript may contain Roman-script Hindi, Marathi, or English. Always respond in clear English only.

## SKIP EMPTY SECTIONS — CRITICAL
- If a section has NO relevant data from the transcript, return an EMPTY ARRAY [] for that field.
- Do NOT add placeholder text like "None identified" or "Not mentioned" inside arrays.
- Only include items that are EXPLICITLY present in the transcript.
- Example: if no decisions were made, return "decisions_taken": []
- Example: if no risks were raised, return "risks_concerns": []
- Example: if no quotes are worth retaining, return "quotes_worth_retaining": []

## Required Output
Return ONLY a valid JSON object — no markdown, no explanation, no backticks.

{
  "executive_summary": {
    "main_purpose": "One sentence describing the core purpose of this recording",
    "core_themes": ["Theme 1", "Theme 2"],
    "major_conclusions": ["Conclusion 1", "Conclusion 2"],
    "key_outcomes": ["Outcome 1", "Outcome 2"]
  },
  "detailed_summary": [
    {
      "topic": "Topic heading",
      "what_was_said": "What was discussed — 2-3 sentences. Do not repeat what is already in executive_summary.",
      "speaker": "Speaker name or Not clearly stated in transcript"
    }
  ],
  "key_points": [
    { "number": 1, "key_point": "A unique insight not already listed in detailed_summary", "supporting_context": "Brief supporting context" }
  ],
  "decisions_taken": [
    { "decision": "Exact decision made", "owner": "Not specified", "context": "Context" }
  ],
  "action_items": [
    { "action": "Task starting with a verb", "owner": "Not specified", "deadline": "Not specified", "dependency": "Not specified" }
  ],
  "open_questions": [
    { "question": "Unanswered question or pending matter explicitly raised", "status": "Unresolved" }
  ],
  "risks_concerns": [
    { "risk": "Risk or concern explicitly raised", "mentioned_by": "Not clearly stated in transcript", "context": "Context" }
  ],
  "important_highlights": [
    "A unique impactful statement not already covered above"
  ],
  "quotes_worth_retaining": [
    { "quote": "Verbatim or near-verbatim quote", "speaker": "Not clearly stated in transcript" }
  ],
  "missing_information": [
    { "area": "Area with missing info", "issue": "What is missing" }
  ],
  "one_page_brief": {
    "purpose": "1-2 sentences on what this recording was about",
    "decisions": "Summary of decisions made, or None identified",
    "actions": "Summary of action items, or None identified",
    "risks": "Summary of risks/concerns, or None identified",
    "pending_items": "Summary of open questions and pending matters, or None identified"
  }
}

## Final Validation (apply before responding)
- No hallucinations — every point must trace to the transcript
- No repetition — each section adds unique information only
- Empty sections must use [] not placeholder strings
- Return ONLY the JSON object — nothing else`;
}

const TEMPLATE_PROMPTS = {
  meeting:   buildMasterPrompt(`Context: This is a BUSINESS MEETING transcript for an Indian business.\nFocus especially on: decisions taken, action owners, deadlines, blockers, and next steps.`),
  sales:     buildMasterPrompt(`Context: This is a SALES CALL transcript for an Indian business.\nFocus especially on: lead details, requirements, objections raised, deal stage, and agreed next steps.`),
  lecture:   buildMasterPrompt(`Context: This is a LECTURE or CLASS transcript.\nFocus especially on: concepts taught, definitions given, key examples, study-worthy points, and any assignments mentioned.`),
  doctor:    buildMasterPrompt(`Context: This is a DOCTOR-PATIENT consultation transcript.\nFocus especially on: patient complaint, symptoms, diagnosis, prescription details, tests ordered, follow-up date.`),
  legal:     buildMasterPrompt(`Context: This is a LEGAL DISCUSSION transcript for an Indian law practice.\nFocus especially on: case facts, legal arguments, documents needed, deadlines, next hearing date.`),
  interview: buildMasterPrompt(`Context: This is a JOB INTERVIEW transcript for an Indian business.\nFocus especially on: candidate background, key answers given, strengths observed, concerns raised, hiring recommendation.`),
  other:     buildMasterPrompt(`Context: This is a general conversation or discussion transcript.\nExtract all structured information as faithfully as possible from the transcript.`),
  auto:      buildMasterPrompt(`Context: This is a general conversation or discussion transcript.\nExtract all structured information as faithfully as possible from the transcript.`),
  default:   buildMasterPrompt(`Context: This is a general conversation or discussion transcript.\nExtract all structured information as faithfully as possible from the transcript.`),
};

// ─── Health routes ────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('VoxNote Server is LIVE 🎙'));
app.get('/health', (req, res) => res.json({ status: 'OK', message: 'VoxNote server is running', timestamp: new Date() }));
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password required' });
  return res.json({ success: true, message: 'Login successful', token: 'demo-token' });
});
app.post('/api/register', (req, res) => res.json({ success: true, message: 'User registered (demo)' }));

app.get('/realtime-token', async (req, res) => {
  try {
    const response = await fetch(`https://streaming.assemblyai.com/v3/token?expires_in_seconds=480`, { method: 'GET', headers: { 'Authorization': process.env.ASSEMBLYAI_KEY } });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`Token error: ${response.status} ${responseText}`);
    const data = JSON.parse(responseText);
    res.json({ success: true, token: data.token });
  } catch (err) {
    console.error('Real-time token error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Summarize ────────────────────────────────────────────────────────────────
app.post('/summarize', async (req, res) => {
  const { transcript, mode } = req.body;
  if (!transcript) return res.status(400).json({ error: 'No transcript provided' });
  const systemPrompt = TEMPLATE_PROMPTS[mode] || TEMPLATE_PROMPTS.default;
  console.log('Summarizing with mode:', mode || 'default');
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: 'Extract structured notes from this transcript:\n\n' + transcript }],
      max_tokens: 4000,
      temperature: 0.1,
    });
    const raw   = completion.choices[0].message.content.trim();
    const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    let parsed = null;
    try { parsed = JSON.parse(clean); } catch { console.warn('/summarize: returning raw text (non-JSON response)'); }
    res.json({ success: true, summary: clean, structured: parsed });
  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: 'Summary failed: ' + err.message });
  }
});

// ─── Chat ─────────────────────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { question, transcripts } = req.body;
  if (!question) return res.status(400).json({ success: false, error: 'No question provided' });
  if (!transcripts || transcripts.length === 0) return res.status(400).json({ success: false, error: 'No transcripts provided' });
  try {
    const transcriptContext = transcripts.map((t, i) => {
      const date = new Date(t.createdAt).toLocaleDateString('en-IN');
      const speakers = t.utterances && t.utterances.length > 0
        ? t.utterances.map(u => `${u.speaker}: ${u.englishText || u.text}`).join('\n')
        : (t.englishText || t.text);
      return `--- Recording ${i + 1}: "${t.title}" (${date}) ---\n${speakers}`;
    }).join('\n\n');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `You are VoxNote AI, an intelligent assistant for Indian businesses. You have access to the user's meeting transcripts. Rules:\n- Always answer in clear English\n- Be specific — mention which recording the info came from\n- If not in transcripts, say "I couldn't find that in your recordings"\n- Keep answers concise and helpful` },
        { role: 'user', content: `Here are my meeting transcripts:\n\n${transcriptContext}\n\n---\n\nMy question: ${question}` }
      ],
      max_tokens: 800,
    });
    res.json({ success: true, answer: completion.choices[0].message.content, question });
  } catch (err) {
    console.error('/chat error:', err.message);
    res.status(500).json({ success: false, error: 'Chat failed: ' + err.message });
  }
});

// ─── Generate Follow-up Email ─────────────────────────────────────────────────
app.post('/generate-email', async (req, res) => {
  const { transcript, summary, actionItems, title, date } = req.body;
  if (!transcript) return res.status(400).json({ success: false, error: 'No transcript provided' });
  try {
    let actionItemsText = '';
    if (actionItems && actionItems.length > 0) {
      actionItemsText = actionItems.map((item, i) => {
        let line = `${i + 1}. ${item.task || item.action}`;
        if (item.owner)    line += ` (Owner: ${item.owner})`;
        if (item.deadline) line += ` (Due: ${item.deadline})`;
        return line;
      }).join('\n');
    }
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `You are a professional email writer for Indian businesses. Generate a polished follow-up email after a meeting. Rules:\n1. Write in clear professional English\n2. Subject line should be: "Follow-up: [Meeting Title]"\n3. Include: brief greeting, meeting summary, action items with owners, next steps, professional closing\n4. Keep it concise — max 250 words\n5. Format: Subject on first line, then blank line, then email body\n6. Use Indian business context — formal but friendly tone\n7. Return ONLY the email — no extra commentary` },
        { role: 'user', content: `Generate a follow-up email for this meeting:\n\nTitle: ${title || 'Meeting'}\nDate: ${date || new Date().toLocaleDateString('en-IN')}\n\nSummary:\n${summary || transcript.substring(0, 1000)}\n\nAction Items:\n${actionItemsText || 'None identified'}\n\nWrite the complete follow-up email now.` }
      ],
      max_tokens: 600,
    });
    const emailContent = completion.choices[0].message.content.trim();
    const lines = emailContent.split('\n');
    const subjectLine = lines[0].replace(/^Subject:\s*/i, '').trim();
    const body = lines.slice(2).join('\n').trim();
    res.json({ success: true, subject: subjectLine, body, full: emailContent });
  } catch (err) {
    console.error('/generate-email error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Share routes ─────────────────────────────────────────────────────────────
app.post('/share/generate', async (req, res) => {
  const { transcriptId } = req.body;
  if (!transcriptId) return res.status(400).json({ success: false, error: 'No transcriptId provided' });
  try {
    const token = crypto.randomBytes(20).toString('hex');
    const { error } = await supabase.from('transcripts').update({ share_token: token }).eq('id', transcriptId);
    if (error) throw error;
    const shareUrl = `${process.env.RENDER_URL || 'https://transcript-app-lbpe.onrender.com'}/share/${token}`;
    res.json({ success: true, shareUrl, token });
  } catch (err) {
    console.error('/share/generate error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/share/revoke', async (req, res) => {
  const { transcriptId } = req.body;
  if (!transcriptId) return res.status(400).json({ success: false, error: 'No transcriptId provided' });
  try {
    await supabase.from('transcripts').update({ share_token: null }).eq('id', transcriptId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/share/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { data, error } = await supabase.from('transcripts').select('*').eq('share_token', token).single();
    if (error || !data) return res.status(404).send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#F5F7FA;"><h2>🔗 Link not found</h2><p style="color:#888;">This link may have expired or been revoked.</p></body></html>`);

    const date     = new Date(data.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const duration = data.duration ? Math.round(data.duration / 60) + ' min' : 'N/A';
    const words    = data.word_count || 0;

    let summaryHTML = '';
    if (data.auto_summary) {
      let s = null;
      try { const clean = data.auto_summary.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim(); s = JSON.parse(clean); } catch {}
      if (s && s.executive_summary) {
        const arr = (a) => Array.isArray(a) && a.length > 0;
        const val = (v) => v && v !== 'Not specified' && v !== 'None identified.' && v !== 'None identified';
        const row = (label, value) => val(value) ? `<div style="margin-bottom:10px;"><span style="font-weight:700;color:#555;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">${label}</span><div style="margin-top:4px;font-size:14px;color:#333;line-height:1.6;">${value}</div></div>` : '';
        const list = (items) => arr(items) ? `<ul style="margin:4px 0 0 0;padding-left:18px;">${items.map(i=>`<li style="margin-bottom:4px;font-size:13px;color:#333;line-height:1.5;">${i}</li>`).join('')}</ul>` : '';
        const makeTable = (headers, rows) => {
          if (!arr(rows)) return '';
          const th = headers.map(h=>`<th style="padding:8px 10px;background:#1A56A0;color:#fff;text-align:left;font-size:12px;">${h}</th>`).join('');
          const tr = rows.map((r,i)=>`<tr style="background:${i%2===0?'#fff':'#F5F8FC'};">${Object.values(r).map(v=>`<td style="padding:8px 10px;border-bottom:1px solid #E8EEF5;font-size:13px;color:#333;">${v||'Not specified'}</td>`).join('')}</tr>`).join('');
          return `<table style="width:100%;border-collapse:collapse;"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
        };
        const section = (title, content) => content ? `<div style="margin-bottom:20px;"><div style="font-size:14px;font-weight:700;color:#0D3B7A;padding:8px 0 6px;border-bottom:2px solid #1A56A0;margin-bottom:12px;">${title}</div>${content}</div>` : '';
        let html11 = '';
        const es = s.executive_summary;
        html11 += section('1. Executive Summary', row('Main Purpose', es?.main_purpose) + row('Core Themes', arr(es?.core_themes) ? es.core_themes.join(' &bull; ') : '') + (arr(es?.major_conclusions)?`<div style="margin-bottom:10px;"><span style="font-weight:700;color:#555;font-size:11px;text-transform:uppercase;">Major Conclusions</span>${list(es.major_conclusions)}</div>`:'') + (arr(es?.key_outcomes)?`<div><span style="font-weight:700;color:#555;font-size:11px;text-transform:uppercase;">Key Outcomes</span>${list(es.key_outcomes)}</div>`:''));
        if (arr(s.detailed_summary)) html11 += section('2. Detailed Summary', s.detailed_summary.map(item=>`<div style="border-left:3px solid #1A56A0;padding-left:12px;margin-bottom:14px;"><div style="font-weight:700;color:#1A56A0;font-size:13px;margin-bottom:2px;">${item.topic||''}</div>${val(item.speaker)?`<div style="font-size:11px;color:#7B1FA2;margin-bottom:4px;">${item.speaker}</div>`:''}<div style="font-size:13px;color:#333;line-height:1.6;">${item.what_was_said||''}</div></div>`).join(''));
        if (arr(s.key_points)) html11 += section('3. Key Points', makeTable(['#','Key Point','Context'], s.key_points.map(k=>({'#':k.number,'Key Point':k.key_point,'Context':k.supporting_context}))));
        if (arr(s.decisions_taken)) html11 += section('4. Decisions Taken', makeTable(['Decision','Owner','Context'], s.decisions_taken.map(d=>({Decision:d.decision,Owner:d.owner,Context:d.context}))));
        if (arr(s.action_items)) html11 += section('5. Action Items', makeTable(['Action','Owner','Deadline'], s.action_items.map(a=>({Action:a.action,Owner:a.owner,Deadline:a.deadline}))));
        if (arr(s.open_questions)) html11 += section('6. Open Questions', `<ul style="padding-left:18px;">${s.open_questions.map(q=>`<li style="margin-bottom:6px;font-size:13px;">${q.question} <span style="color:#aaa;font-size:11px;">(${q.status})</span></li>`).join('')}</ul>`);
        if (arr(s.risks_concerns)) html11 += section('7. Risks & Concerns', makeTable(['Risk','Mentioned By','Context'], s.risks_concerns.map(r=>({'Risk':r.risk,'Mentioned By':r.mentioned_by,'Context':r.context}))));
        if (arr(s.important_highlights)) html11 += section('8. Important Highlights', list(s.important_highlights));
        if (arr(s.quotes_worth_retaining)) html11 += section('9. Quotes', s.quotes_worth_retaining.map(q=>`<div style="border-left:4px solid #7B1FA2;background:#F3E5F5;padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:10px;"><div style="font-size:13px;color:#4A148C;font-style:italic;">"${q.quote}"</div><div style="font-size:11px;color:#7B1FA2;margin-top:4px;">— ${q.speaker}</div></div>`).join(''));
        if (s.one_page_brief) { const b = s.one_page_brief; html11 += section('10. One-Page Brief', `<div style="background:#EFF6FF;border-radius:8px;padding:14px;border:1px solid #BFDBFE;"><table style="width:100%;border-collapse:collapse;">${[['Purpose',b.purpose],['Decisions',b.decisions],['Actions',b.actions],['Risks',b.risks],['Pending Items',b.pending_items]].filter(([,v])=>val(v)&&v!=='None identified').map(([k,v])=>`<tr><th style="padding:8px 10px;text-align:left;font-size:12px;color:#1A56A0;width:22%;">${k}</th><td style="padding:8px 10px;font-size:13px;color:#333;border-bottom:1px solid #DBEAFE;">${v}</td></tr>`).join('')}</table></div>`); }
        summaryHTML = `<div class="section"><div class="section-title" style="color:#1A7A4A;border-left-color:#1A7A4A;">🤖 AI Notes</div><div style="background:#FAFAFA;border:1px solid #E8EEF5;border-radius:10px;padding:20px;">${html11}</div></div>`;
      } else if (s) {
        let fieldsHTML = '';
        if (s.summary) fieldsHTML += `<div style="font-style:italic;color:#555;margin-bottom:12px;font-size:14px;">${s.summary}</div>`;
        summaryHTML = `<div class="section"><div class="section-title" style="color:#1A7A4A;border-left-color:#1A7A4A;">🤖 AI Notes</div><div style="background:#F0FAF4;padding:16px;border-radius:8px;">${fieldsHTML}</div></div>`;
      } else {
        summaryHTML = `<div class="section"><div class="section-title" style="color:#1A7A4A;border-left-color:#1A7A4A;">🤖 AI Summary</div><div style="background:#F0FAF4;padding:16px;border-radius:8px;font-size:14px;line-height:1.8;color:#333;white-space:pre-wrap;">${data.auto_summary}</div></div>`;
      }
    }

    const speakerColors = ['#1A56A0','#1A7A4A','#C85A00','#8B1AAF','#C0392B','#0097A7','#795548','#E91E63'];
    const speakerBG     = ['#E8F0FC','#E8F5EE','#FEF3E8','#F3E8FE','#FDE8E8','#E0F7FA','#F3EDEB','#FCE4EC'];
    let transcriptHTML = '';
    if (data.utterances?.length > 0) {
      const getSpeakerIdx = (speaker) => { const code = speaker?.slice(-1)?.toUpperCase().charCodeAt(0) || 65; return (code >= 65 && code <= 72) ? code - 65 : Math.abs(code - 65) % 8; };
      const utterancesHTML = data.utterances.map(u => { const idx = getSpeakerIdx(u.speaker); const start = u.start ? `${Math.floor(u.start/60000).toString().padStart(2,'0')}:${Math.floor((u.start%60000)/1000).toString().padStart(2,'0')}` : ''; const end = u.end ? `${Math.floor(u.end/60000).toString().padStart(2,'0')}:${Math.floor((u.end%60000)/1000).toString().padStart(2,'0')}` : ''; return `<div style="background:${speakerBG[idx]};border-radius:10px;padding:14px;margin-bottom:12px;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><span style="background:${speakerColors[idx]};color:#fff;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:700;">${u.speaker}</span><span style="font-size:11px;color:#888;">${start} — ${end}</span></div><div style="font-size:14px;color:#333;line-height:1.7;">${u.englishText || u.text}</div>${u.englishText && u.englishText !== u.text ? `<div style="font-size:12px;color:#888;margin-top:6px;font-style:italic;">${u.text}</div>` : ''}</div>`; }).join('');
      transcriptHTML = `<div class="section"><div class="section-title">🎙 Speaker Transcript</div>${utterancesHTML}</div>`;
    } else {
      transcriptHTML = `<div class="section"><div class="section-title">📝 Full Transcript</div><div style="font-size:14px;color:#333;line-height:1.8;white-space:pre-wrap;">${data.english_text || data.text}</div></div>`;
    }

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>${data.title} — VoxNote</title><style>* { margin:0; padding:0; box-sizing:border-box; } body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#F5F7FA; color:#333; } .header { background:linear-gradient(135deg,#0D3B7A,#1A56A0); color:white; padding:32px 24px; } .logo { font-size:12px; font-weight:700; letter-spacing:2px; color:#AACFEE; margin-bottom:12px; text-transform:uppercase; } .title { font-size:22px; font-weight:800; margin-bottom:16px; line-height:1.3; } .meta-grid { display:flex; gap:12px; flex-wrap:wrap; } .meta-item { background:rgba(255,255,255,0.15); padding:8px 14px; border-radius:8px; font-size:12px; } .meta-label { color:#AACFEE; font-size:10px; text-transform:uppercase; letter-spacing:1px; margin-bottom:2px; } .meta-value { color:#fff; font-weight:600; } .read-only-badge { display:inline-block; background:rgba(255,255,255,0.2); border:1px solid rgba(255,255,255,0.4); border-radius:20px; padding:6px 14px; font-size:11px; color:#fff; margin-top:16px; } .body { padding:24px; max-width:800px; margin:0 auto; } .section { margin-bottom:28px; } .section-title { font-size:15px; font-weight:700; color:#0D3B7A; margin-bottom:14px; padding-left:12px; border-left:4px solid #1A56A0; } .footer { text-align:center; padding:24px; font-size:11px; color:#AAA; border-top:1px solid #EEE; margin-top:20px; } .footer a { color:#1A56A0; text-decoration:none; font-weight:600; }</style></head><body><div class="header"><div class="logo">VoxNote — AI Transcription</div><div class="title">${data.title}</div><div class="meta-grid"><div class="meta-item"><div class="meta-label">Date</div><div class="meta-value">${date}</div></div><div class="meta-item"><div class="meta-label">Duration</div><div class="meta-value">${duration}</div></div><div class="meta-item"><div class="meta-label">Words</div><div class="meta-value">${words}</div></div></div><div class="read-only-badge">🔗 Shared read-only view</div></div><div class="body">${summaryHTML}${transcriptHTML}</div><div class="footer">Shared via <a href="https://play.google.com/store/apps/details?id=com.voxnote.app">VoxNote AI Transcription</a></div></body></html>`;
    res.send(html);
  } catch (err) {
    console.error('/share/:token error:', err.message);
    res.status(500).send('<h2>Something went wrong</h2>');
  }
});

// ─── Sarvam language map ──────────────────────────────────────────────────────
const SARVAM_LANG_MAP = {
  'hi': 'hi-IN', 'mr': 'mr-IN', 'ta': 'ta-IN', 'te': 'te-IN',
  'kn': 'kn-IN', 'ml': 'ml-IN', 'bn': 'bn-IN', 'gu': 'gu-IN',
  'pa': 'pa-IN', 'ur': 'ur-IN', 'or': 'or-IN',
};

const transcribeWithSarvam = async (audioFilePath, langCode) => {
  console.log('[Sarvam] Transcribing with language:', langCode);
  try {
    const response = await sarvam.speechToText.transcribe({
      file_path:        audioFilePath,
      language_code:    langCode,
      model:            'saaras:v3',
      mode:             'translate',
      with_diarization: true,
    });
    console.log('[Sarvam] Done. Turns:', response.turns?.length || 0);
    const utterances = (response.turns || []).map((turn, i) => ({
      speaker:     turn.speaker || `Speaker ${String.fromCharCode(65 + i)}`,
      text:        turn.text || '',
      englishText: turn.text || '',
      start:       (turn.start_time_ms || 0),
      end:         (turn.end_time_ms   || 0),
      words:       [],
    }));
    return { success: true, provider: 'sarvam', rawText: response.transcript || '', englishText: response.transcript || '', utterances, skipTranslation: true, language_code: langCode };
  } catch (err) {
    console.error('[Sarvam] Error — falling back to AssemblyAI:', err.message);
    return null;
  }
};

const translateToEnglish = async (text) => {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `You are a translator for Indian languages. The text may contain Hindi, Marathi or a mix with English written in Roman script. Rules:\n1. Translate everything to clean natural English\n2. Keep names, places, company names as-is\n3. Keep technical terms as-is\n4. If text is already in English — return it as-is\n5. Return ONLY the translated text, nothing else` },
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

const generateSummary = async (text, mode) => {
  try {
    const truncated    = text.length > 12000 ? text.substring(0, 12000) + '...' : text;
    const systemPrompt = TEMPLATE_PROMPTS[mode] || TEMPLATE_PROMPTS.default;
    const completion   = await openai.chat.completions.create({
      model:       'gpt-4o-mini',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: 'Extract structured notes from this transcript:\n\n' + truncated }],
      max_tokens:  4000,
      temperature: 0.1,
    });
    const raw   = completion.choices[0].message.content.trim();
    const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    try { JSON.parse(clean); return clean; } catch { console.warn('generateSummary: GPT returned non-JSON'); return raw; }
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
        { role: 'system', content: `You are an assistant that extracts action items from meeting transcripts. Rules:\n1. Each action item must start with a verb\n2. Include who is responsible if mentioned\n3. Include deadline if mentioned\n4. Return ONLY a JSON array:\n[{"task": "Send proposal", "owner": "Anshul", "deadline": "Friday"}]\n5. If no action items, return: []\n6. Return ONLY the JSON array, nothing else` },
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
        { role: 'system', content: `You are a title generator for meeting/conversation transcripts. Rules:\n1. Generate a SHORT, descriptive title in English only (even if transcript is Hindi/Marathi)\n2. Format: "[Topic] — [Key Context]"\n3. Examples: "Team Standup — Sprint Planning", "Client Call — Budget Discussion"\n4. Max 6 words total\n5. Return ONLY the title, nothing else — no quotes, no punctuation at end` },
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

const detectSpeakerNames = async (utterances) => {
  try {
    if (!utterances || utterances.length === 0) return {};
    const dialogue = utterances.slice(0, 30).map(u => `${u.speaker}: ${u.englishText || u.text}`).join('\n');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `You are an expert at detecting when people introduce themselves in conversations. Look for patterns like:\n- "I am [name]", "I'm [name]", "My name is [name]"\n- "Main [name] hoon", "Mera naam [name] hai"\n- "This is [name]", "Hello I'm [name]"\n- Someone else addressing them: "Hello [name]", "Thank you [name]"\n\nRules:\n1. Only return names you are VERY confident about\n2. Names should be real person names — not generic words\n3. Return ONLY a JSON object mapping speaker labels to real names\n4. Example: {"Speaker A": "Anshul", "Speaker B": "Priya"}\n5. If no introductions found, return: {}\n6. Return ONLY the JSON, nothing else` },
        { role: 'user', content: `Detect speaker names from this transcript:\n\n${dialogue}` }
      ],
      max_tokens: 200,
    });
    const raw    = completion.choices[0].message.content.trim();
    const parsed = JSON.parse(raw);
    console.log('Detected speaker names:', parsed);
    return typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    console.error('Speaker name detection error:', err.message);
    return {};
  }
};

// ─── processTranscript ────────────────────────────────────────────────────────
const processTranscript = async (transcript, mode, sarvamResult = null) => {
  const resolvedMode = mode || 'default';

  if (sarvamResult && sarvamResult.success) {
    console.log('[processTranscript] Using Sarvam result — skipping translation loop');
    const summaryInput = sarvamResult.englishText;
    console.log('Generating summary...');
    const autoSummary = summaryInput ? await generateSummary(summaryInput, resolvedMode) : null;
    console.log('Extracting action items...');
    const actionItems = summaryInput ? await extractActionItems(summaryInput) : [];
    console.log('Generating smart title...');
    const smartTitle = summaryInput ? await generateTitle(summaryInput, sarvamResult.language_code) : null;
    console.log('Smart title result:', smartTitle);
    console.log('Detecting speaker names...');
    const speakerNameMap = await detectSpeakerNames(sarvamResult.utterances);
    let finalUtterances = sarvamResult.utterances;
    if (Object.keys(speakerNameMap).length > 0) {
      finalUtterances = finalUtterances.map(u => ({ ...u, speaker: speakerNameMap[u.speaker] || u.speaker }));
      console.log('Speaker names applied:', speakerNameMap);
    }
    return { success: true, status: 'completed', text: sarvamResult.rawText, smartTitle: smartTitle || null, englishText: sarvamResult.englishText || null, utterances: finalUtterances, words: [], duration: null, detectedLang: sarvamResult.language_code, autoSummary: autoSummary || null, actionItems: actionItems || [], speakers: sarvamResult.utterances.length, speakerNames: speakerNameMap, provider: 'sarvam' };
  }

  const rawText      = transcript.text || '';
  const detectedLang = transcript.language_code || 'en';
  const speakerList  = [...new Set((transcript.utterances || []).map(u => u.speaker))];
  console.log('Speakers detected:', speakerList);
  console.log('Detected language:', detectedLang);
  console.log('Template mode:', resolvedMode);

  const utterances = transcript.utterances?.map(u => ({ speaker: 'Speaker ' + u.speaker, text: u.text, start: u.start, end: u.end, words: u.words || [] })) || [];
  let englishText = null, englishUtterances = null;

  const isIndianLang = detectedLang !== 'en' || /\b(hai|hain|tha|thi|mein|ka|ki|ko|aaj|kal|kya|nahi|hum|aap|tum|mere|tera|yeh|woh|karo|karenge|chahiye|aahe|pudhe|amhi|nahin|matlab|theek|achha|bilkul)\b/i.test(rawText);

  if (isIndianLang) {
    console.log('Translating to English (AssemblyAI fallback path)...');
    englishText = await translateToEnglish(rawText);
    if (utterances.length > 0) {
      englishUtterances = await Promise.all(utterances.map(async (u) => ({ ...u, englishText: await translateToEnglish(u.text) })));
    }
  } else {
    englishText = rawText;
    englishUtterances = utterances.map(u => ({ ...u, englishText: u.text }));
  }

  console.log('Generating summary...');
  const summaryInput = englishText || rawText;
  const autoSummary  = summaryInput ? await generateSummary(summaryInput, resolvedMode) : null;
  console.log('Extracting action items...');
  const actionItems = summaryInput ? await extractActionItems(summaryInput) : [];
  console.log('Generating smart title...');
  const smartTitle = summaryInput ? await generateTitle(summaryInput, detectedLang) : null;
  console.log('Smart title result:', smartTitle);
  console.log('Detecting speaker names...');
  const speakerNameMap = await detectSpeakerNames(englishUtterances || utterances);

  let finalUtterances = englishUtterances || utterances;
  if (Object.keys(speakerNameMap).length > 0) {
    finalUtterances = finalUtterances.map(u => ({ ...u, speaker: speakerNameMap[u.speaker] || u.speaker }));
    console.log('Speaker names applied:', speakerNameMap);
  }

  return { success: true, status: 'completed', text: rawText, smartTitle: smartTitle || null, englishText: englishText || null, utterances: finalUtterances, words: transcript.words || [], duration: transcript.audio_duration || null, detectedLang, autoSummary: autoSummary || null, actionItems: actionItems || [], speakers: speakerList.length, speakerNames: speakerNameMap, provider: 'assemblyai' };
};

// ─── ROUTE 1: Start transcription ─────────────────────────────────────────────
app.post('/transcribe-start', upload.single('audio'), async (req, res) => {
  const tempPath = req.file ? req.file.path : null;
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No audio file received' });
    console.log('File received:', req.file.size, 'bytes');

    const langHint   = req.body.language_hint || 'en';
    const mode       = req.body.mode          || 'default';
    const sarvamLang = SARVAM_LANG_MAP[langHint];
    const useSarvam  = !!sarvamLang && !!process.env.SARVAM_API_KEY;

    console.log('Language hint:', langHint, '| Use Sarvam:', useSarvam);

    if (useSarvam) {
      console.log('[Sarvam] Processing with Saaras V3...');
      const sarvamResult = await transcribeWithSarvam(tempPath, sarvamLang);
      try { if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) {}

      if (sarvamResult) {
        const result = await processTranscript(null, mode, sarvamResult);
        const jobId  = 'sarvam_' + Date.now();
        await supabase.from('transcription_jobs').insert({ id: jobId, status: 'done', mode, result, completed_at: new Date().toISOString() });
        return res.json({ success: true, jobId, provider: 'sarvam' });
      }
      console.warn('[Sarvam] Failed — falling through to AssemblyAI');
    }

    console.log('[AssemblyAI] Uploading...');
    const uploadUrl  = await aai.files.upload(fs.createReadStream(tempPath));
    try { if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) {}
    console.log('Uploaded to AssemblyAI:', uploadUrl);

    const webhookUrl = `${process.env.RENDER_URL}/webhook/assemblyai`;
    const job = await aai.transcripts.submit({
      audio:              uploadUrl,
      speaker_labels:     true,
      language_detection: true,
      format_text:        true,
      punctuate:          true,
      speech_models:      ['universal-3-pro', 'universal-2'],
      webhook_url:        webhookUrl,
    });

    console.log('AssemblyAI job submitted. ID:', job.id);

    // ✅ FIX 1: Store mode so webhook can use the correct template
    await supabase.from('transcription_jobs').insert({ id: job.id, status: 'processing', mode });

    res.json({ success: true, jobId: job.id, provider: 'assemblyai' });

  } catch (err) {
    console.error('/transcribe-start error:', err.message);
    try { if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── WEBHOOK: AssemblyAI callback ─────────────────────────────────────────────
app.post('/webhook/assemblyai', async (req, res) => {
  try {
    const { transcript_id, status } = req.body;
    console.log('Webhook received! Job:', transcript_id, 'Status:', status);

    res.json({ success: true }); // ACK immediately

    if (status !== 'completed') {
      console.error('AssemblyAI job failed. Status:', status, '| Job:', transcript_id);
      await supabase.from('transcription_jobs').update({ status }).eq('id', transcript_id);
      return;
    }

    const { data: existingJob } = await supabase
      .from('transcription_jobs')
      .select('status, result, mode')
      .eq('id', transcript_id)
      .single();

    // ✅ FIX 2: Back off if poll already has the lock or job is done
    if (existingJob?.status === 'done' || existingJob?.status === 'processing_lock') {
      console.log('Job already processed or locked — webhook backing off:', transcript_id);
      return;
    }

    // Set lock immediately
    await supabase.from('transcription_jobs')
      .update({ status: 'processing_lock' })
      .eq('id', transcript_id);

    // ✅ FIX 3: Use stored mode so correct template is applied
    const mode = existingJob?.mode || 'default';
    console.log('Fetching transcript from AssemblyAI... Mode:', mode);

    const transcript = await aai.transcripts.get(transcript_id);
    if (transcript.status !== 'completed') {
      console.error('AssemblyAI transcript not completed:', transcript.error || 'unknown');
      await supabase.from('transcription_jobs').update({ status: 'error' }).eq('id', transcript_id);
      return;
    }

    console.log('Processing transcript (webhook)...');
    const result = await processTranscript(transcript, mode);

    await supabase.from('transcription_jobs').update({ status: 'done', result, completed_at: new Date().toISOString() }).eq('id', transcript_id);
    console.log('Webhook processing complete! Job:', transcript_id);

  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

// ─── ROUTE 2: Poll job status ─────────────────────────────────────────────────
app.get('/transcribe-status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    console.log('Checking status for job:', jobId);

    // Check Supabase cache first
    const { data: cachedJob } = await supabase
      .from('transcription_jobs')
      .select('status, result, mode')
      .eq('id', jobId)
      .single();

    if (cachedJob?.status === 'done' && cachedJob?.result) {
      console.log('Returning cached result for job:', jobId);
      return res.json(cachedJob.result);
    }

    // ✅ FIX 4: If webhook has the lock, wait for it (up to 60s) — don't process in parallel
    if (cachedJob?.status === 'processing_lock') {
      console.log('Webhook has processing lock — waiting for it to finish:', jobId);
      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // check every 2s
        const { data: lockCheck } = await supabase
          .from('transcription_jobs')
          .select('status, result')
          .eq('id', jobId)
          .single();
        if (lockCheck?.status === 'done' && lockCheck?.result) {
          console.log('Webhook finished — returning result:', jobId);
          return res.json(lockCheck.result);
        }
      }
      // After 60s still locked — something went wrong, fall through to check AAI
      console.warn('Lock wait timed out for job:', jobId);
    }

    // Sarvam jobs are done immediately — if we get here with a sarvam_ prefix, something is wrong
    if (jobId.startsWith('sarvam_')) {
      return res.json({ success: false, status: 'error', error: 'Sarvam job result not found in cache' });
    }

    const transcript = await aai.transcripts.get(jobId);
    console.log('AssemblyAI job status:', transcript.status);

    if (transcript.status === 'error') {
      console.error('AssemblyAI job error for', jobId, ':', transcript.error);
      await supabase.from('transcription_jobs').update({ status: 'error' }).eq('id', jobId);
      return res.json({ success: false, status: 'error', error: transcript.error });
    }

    if (transcript.status === 'queued' || transcript.status === 'processing') {
      return res.json({ success: true, status: transcript.status });
    }

    if (transcript.status === 'completed') {
      // Check one more time — webhook may have just finished
      const { data: recheckJob } = await supabase
        .from('transcription_jobs')
        .select('status, result, mode')
        .eq('id', jobId)
        .single();

      if (recheckJob?.status === 'done' && recheckJob?.result) {
        console.log('Webhook already completed — returning result:', jobId);
        return res.json(recheckJob.result);
      }

      // ✅ FIX 5: If webhook has lock now, wait (it started processing AFTER our first check)
      if (recheckJob?.status === 'processing_lock') {
        console.log('Webhook just acquired lock — waiting up to 60s:', jobId);
        for (let i = 0; i < 30; i++) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const { data: lockWait } = await supabase
            .from('transcription_jobs')
            .select('status, result')
            .eq('id', jobId)
            .single();
          if (lockWait?.status === 'done' && lockWait?.result) {
            console.log('Webhook finished — returning its result:', jobId);
            return res.json(lockWait.result);
          }
        }
        console.warn('Webhook lock timed out — poll taking over:', jobId);
      }

      // ✅ FIX 6: Try to atomically grab lock — only process if status is still 'processing'
      // This prevents multiple poll requests from all running processTranscript simultaneously
      const { data: lockAttempt } = await supabase
        .from('transcription_jobs')
        .update({ status: 'processing_lock' })
        .eq('id', jobId)
        .eq('status', 'processing')  // only succeeds if NOT already locked
        .select('id');

      if (!lockAttempt || lockAttempt.length === 0) {
        // Another poll got the lock first — wait for it
        console.log('Another poll has lock — waiting:', jobId);
        for (let i = 0; i < 20; i++) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const { data: pollWait } = await supabase
            .from('transcription_jobs')
            .select('status, result')
            .eq('id', jobId)
            .single();
          if (pollWait?.status === 'done' && pollWait?.result) {
            return res.json(pollWait.result);
          }
        }
        return res.json({ success: true, status: 'processing' });
      }

      // We have the lock — run fallback processing
      const mode = recheckJob?.mode || 'default';
      console.log('Processing completed transcript (fallback). Mode:', mode);
      const result = await processTranscript(transcript, mode);

      await supabase.from('transcription_jobs').update({ status: 'done', result, completed_at: new Date().toISOString() }).eq('id', jobId);
      return res.json(result);
    }

    res.json({ success: true, status: transcript.status });

  } catch (err) {
    console.error('/transcribe-status error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── ROUTE 3: Old sync route ──────────────────────────────────────────────────
app.post('/transcribe-speakers', upload.single('audio'), async (req, res) => {
  const tempPath = req.file ? req.file.path : null;
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No audio file received' });
    console.log('Audio file received:', req.file.originalname);
    const uploadUrl = await aai.files.upload(fs.createReadStream(tempPath));
    fs.unlinkSync(tempPath);
    const transcript = await aai.transcripts.transcribe({ audio: uploadUrl, speaker_labels: true, language_detection: true, format_text: true, punctuate: true, speech_models: ['universal-3-pro', 'universal-2'] });
    if (transcript.status === 'error') throw new Error('AssemblyAI error: ' + transcript.error);
    const result = await processTranscript(transcript, 'default');
    res.json(result);
  } catch (err) {
    console.error('/transcribe-speakers error:', err.message);
    try { if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Razorpay routes ──────────────────────────────────────────────────────────
app.post('/create-order', async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount) return res.status(400).json({ success: false, error: 'Amount required' });
    const orderId = 'order_' + crypto.randomBytes(12).toString('hex');
    await supabase.from('orders').insert([{ order_id: orderId, amount, status: 'created', created_at: new Date().toISOString() }]).select().single().catch(e => console.warn('Orders insert:', e.message));
    console.log('Order created:', orderId, 'Amount:', amount);
    res.json({ success: true, orderId, amount });
  } catch (err) {
    console.error('/create-order error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/verify-payment', async (req, res) => {
  try {
    const { orderId, paymentId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, error: 'Order ID required' });
    console.log('Verifying payment for order:', orderId, 'payment:', paymentId);
    await supabase.from('orders').update({ status: 'paid', payment_id: paymentId, paid_at: new Date().toISOString() }).eq('order_id', orderId).catch(() => {});
    res.json({ success: true, orderId, message: 'Payment verified' });
  } catch (err) {
    console.error('/verify-payment error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`VoxNote server running on port ${PORT}`);
});