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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));


// Increase server timeout for large file uploads
app.use((req, res, next) => {
  res.setTimeout(300000); // 5 min
  next();
});

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

// ─── Template-aware system prompts (Structured JSON output) ──────────────────
const TEMPLATE_PROMPTS = {

  meeting: `You are a professional meeting notes assistant for Indian businesses.
The transcript may contain Roman-script Hindi, Marathi, or English.
Always respond in clear English only.
Return ONLY a valid JSON object — no markdown, no explanation, no backticks.

Required format:
{
  "summary": "One-line summary of the meeting purpose and outcome",
  "key_points": ["Important point discussed 1", "Important point 2", "Important point 3"],
  "key_decisions": ["Decision made 1", "Decision made 2"],
  "action_items": [
    { "task": "Task description starting with a verb", "owner": "Person name or Unassigned", "deadline": "Date or Not mentioned" }
  ],
  "next_meeting_date": "Date and time or Not mentioned"
}

Rules:
- summary: one clear sentence capturing the meeting topic and main outcome
- key_points: 3-6 most important things discussed, each as a complete sentence
- key_decisions: every resolved outcome, agreement, or choice made. If none, return []
- action_items: every task assigned. If no owner spoken, use "Unassigned". Start each task with a verb
- next_meeting_date: any follow-up meeting reference. If none, return "Not mentioned"
- Be thorough — extract ALL points, decisions and tasks from the transcript
- Return ONLY the JSON object — nothing else`,

  sales: `You are a sales call analyst for Indian businesses.
The transcript may contain Roman-script Hindi, Marathi, or English.
Always respond in clear English only.
Return ONLY a valid JSON object — no markdown, no explanation, no backticks.

Required format:
{
  "summary": "One-line summary of the call outcome",
  "lead_name": "Full name and company of the prospect, or Not mentioned",
  "requirements": ["Requirement or pain point 1", "Requirement 2", "Requirement 3"],
  "objections": ["Objection 1", "Objection 2"],
  "next_steps": ["Next step 1", "Next step 2"],
  "deal_stage": "Stage: Discovery / Demo Scheduled / Proposal Sent / Negotiation / Closed / Not clear"
}

Rules:
- lead_name: extract from introduction or how they are addressed
- requirements: all pain points, needs, goals expressed by the prospect — be thorough
- objections: pricing concerns, competitor mentions, timing issues, hesitations, doubts
- next_steps: every agreed follow-up action — demo, proposal, callback date, email to send
- deal_stage: assess from context which stage this deal is at
- If a field has no data, return []
- Return ONLY the JSON object — nothing else`,

  lecture: `You are a thorough academic notes assistant.
The transcript may contain Roman-script Hindi, Marathi, or English.
Always respond in clear English only.
Return ONLY a valid JSON object — no markdown, no explanation, no backticks.

Required format:
{
  "summary": "One-line overview of the lecture topic and scope",
  "key_concepts": ["Concept 1 with brief explanation", "Concept 2 with brief explanation"],
  "definitions": [
    { "term": "Term", "definition": "Definition as explained in the lecture" }
  ],
  "important_points": ["Important fact or point 1", "Important fact 2"],
  "study_questions": ["Question 1?", "Question 2?", "Question 3?", "Question 4?", "Question 5?"],
  "assignments": ["Assignment or deadline mentioned, or return empty array if none"]
}

Rules:
- key_concepts: 4-8 core ideas, each with a short explanation based on the lecture
- definitions: only terms explicitly defined during the lecture — be thorough
- important_points: facts, statistics, examples mentioned that students should remember
- study_questions: generate 5 strong revision questions covering the main topics
- assignments: any homework, reading, or deadline mentioned by the lecturer
- If a field has no data, return []
- Return ONLY the JSON object — nothing else`,

  doctor: `You are a medical consultation notes assistant.
The transcript may contain Roman-script Hindi, Marathi, or English.
Always respond in clear English only.
Return ONLY a valid JSON object — no markdown, no explanation, no backticks.

Required format:
{
  "summary": "One-line summary of the consultation",
  "patient_complaint": "Chief complaint, all symptoms described, severity, and duration if mentioned",
  "diagnosis": "Condition identified or suspected by the doctor, or Not mentioned",
  "prescription": [
    { "medicine": "Medicine name", "dosage": "Dosage amount", "frequency": "How often", "duration": "How long" }
  ],
  "tests_ordered": ["Test 1", "Test 2"],
  "advice": ["Lifestyle advice or instruction 1", "Advice 2"],
  "followup_date": "Next appointment or re-visit instruction, or Not mentioned"
}

Rules:
- patient_complaint: capture ALL symptoms, their severity, and duration
- diagnosis: exact condition named by doctor, or "Under investigation" if tests ordered
- prescription: each medicine as separate object; use "Not specified" for missing fields
- tests_ordered: blood tests, scans, X-rays etc. mentioned. Return [] if none
- advice: diet, rest, exercise, lifestyle changes, restrictions mentioned
- followup_date: next checkup, test result review, or re-visit date
- Return ONLY the JSON object — nothing else`,

  legal: `You are a legal consultation notes assistant for Indian law practices.
The transcript may contain Roman-script Hindi, Marathi, or English.
Always respond in clear English only.
Return ONLY a valid JSON object — no markdown, no explanation, no backticks.

Required format:
{
  "summary": "One-line summary of the legal matter discussed",
  "client_details": "Client name, case reference, matter type — or Not mentioned",
  "case_summary": "Core legal matter, current status, and key facts — 2-3 sentences",
  "key_points": ["Key legal point or fact discussed 1", "Key point 2", "Key point 3"],
  "action_items": [
    { "task": "Task description", "owner": "Lawyer or Client", "deadline": "Date or Not mentioned" }
  ],
  "next_hearing_date": "Scheduled hearing, court date, or filing deadline — or Not mentioned"
}

Rules:
- client_details: extract name from how they are addressed or introduced
- case_summary: 2-3 sentences covering the legal issue, jurisdiction if mentioned, current stage
- key_points: important legal arguments, facts, evidence, or strategy discussed
- action_items: documents to gather, filings due, calls to make, research needed
- next_hearing_date: any court date, deadline, or scheduled appointment
- Return ONLY the JSON object — nothing else`,

  interview: `You are a detailed interview assessment assistant for Indian businesses.
The transcript may contain Roman-script Hindi, Marathi, or English.
Always respond in clear English only.
Return ONLY a valid JSON object — no markdown, no explanation, no backticks.

Required format:
{
  "summary": "One-line summary of the interview",
  "candidate_name": "Candidate's full name, or Not mentioned",
  "role": "Role being interviewed for, or Not mentioned",
  "key_answers": ["Notable answer or example given by candidate 1", "Notable answer 2", "Notable answer 3"],
  "evaluation": {
    "strengths": ["Strength 1", "Strength 2", "Strength 3"],
    "concerns": ["Concern or red flag 1", "Concern 2"]
  },
  "cultural_fit": "Assessment of cultural fit and communication style based on the interview",
  "decision": "Recommended outcome: Shortlist / Reject / Hold / Move to next round — with one-line reason"
}

Rules:
- candidate_name: from introduction or how interviewer addresses them
- role: the position being interviewed for
- key_answers: 3-5 specific examples, stories, or responses that stand out (positive or negative)
- evaluation.strengths: demonstrated skills, experiences, cultural fit signals, strong moments
- evaluation.concerns: hesitations, gaps, inconsistencies, red flags observed
- cultural_fit: communication style, attitude, energy, team fit signals
- decision: clear recommendation with brief reasoning
- If a field has no data, return []
- Return ONLY the JSON object — nothing else`,

  other: `You are a detailed notes assistant for Indian businesses.
The transcript may contain Roman-script Hindi, Marathi, or English.
Always respond in clear English only.
Return ONLY a valid JSON object — no markdown, no explanation, no backticks.

Required format:
{
  "summary": "One-line summary of the recording",
  "key_points": ["Key point discussed 1", "Key point 2", "Key point 3", "Key point 4"],
  "action_items": [
    { "task": "Task description", "owner": "Person or Unassigned", "deadline": "Date or Not mentioned" }
  ],
  "decisions": ["Decision or conclusion 1", "Decision 2"],
  "follow_up": ["Follow-up item 1", "Follow-up item 2"]
}

Rules:
- key_points: 4-8 most important things discussed, each as a complete sentence
- action_items: any tasks or follow-ups mentioned; return [] if none
- decisions: any outcomes, agreements, or conclusions reached; return [] if none
- follow_up: things to check, verify, or revisit later
- Return ONLY the JSON object — nothing else`,

  auto: `You are a detailed notes assistant for Indian businesses.
The transcript may contain Roman-script Hindi, Marathi, or English.
Always respond in clear English only.
Return ONLY a valid JSON object — no markdown, no explanation, no backticks.

Required format:
{
  "summary": "One-line summary of the recording",
  "key_points": ["Key point discussed 1", "Key point 2", "Key point 3", "Key point 4"],
  "action_items": [
    { "task": "Task description", "owner": "Person or Unassigned", "deadline": "Date or Not mentioned" }
  ],
  "decisions": ["Decision or conclusion 1", "Decision 2"],
  "follow_up": ["Follow-up item 1", "Follow-up item 2"]
}

Rules:
- key_points: 4-8 most important things discussed, each as a complete sentence
- action_items: any tasks or follow-ups mentioned; return [] if none
- decisions: any outcomes, agreements, or conclusions reached; return [] if none
- follow_up: things to check, verify, or revisit later
- Return ONLY the JSON object — nothing else`,

  default: `You are a detailed notes assistant for Indian businesses.
The transcript may contain Roman-script Hindi, Marathi, or English.
Always respond in clear English only.
Return ONLY a valid JSON object — no markdown, no explanation, no backticks.

Required format:
{
  "summary": "One-line summary of the recording",
  "key_points": ["Key point discussed 1", "Key point 2", "Key point 3", "Key point 4"],
  "action_items": [
    { "task": "Task description", "owner": "Person or Unassigned", "deadline": "Date or Not mentioned" }
  ],
  "decisions": ["Decision or conclusion 1", "Decision 2"],
  "follow_up": ["Follow-up item 1", "Follow-up item 2"]
}

Rules:
- key_points: 4-8 most important things discussed, each as a complete sentence
- action_items: any tasks or follow-ups mentioned; return [] if none
- decisions: any outcomes, agreements, or conclusions reached; return [] if none
- follow_up: things to check, verify, or revisit later
- Return ONLY the JSON object — nothing else`,
};
// ─────────────────────────────────────────────────────────────────────────────

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

// ─── Summarize route (template-aware, structured JSON) ───────────────────────
app.post('/summarize', async (req, res) => {
  const { transcript, mode } = req.body;
  if (!transcript) return res.status(400).json({ error: 'No transcript provided' });

  const systemPrompt = TEMPLATE_PROMPTS[mode] || TEMPLATE_PROMPTS.default;
  console.log('Summarizing with mode:', mode || 'default');

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: 'Extract structured notes from this transcript:\n\n' + transcript }
      ],
      max_tokens: 1000,
    });

    const raw   = completion.choices[0].message.content.trim();
    const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

    let parsed = null;
    try {
      parsed = JSON.parse(clean);
    } catch {
      console.warn('/summarize: returning raw text (non-JSON response)');
    }

    res.json({
      success:    true,
      summary:    clean,   // store this string in Supabase
      structured: parsed,  // parsed object for frontend direct use
    });

  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: 'Summary failed: ' + err.message });
  }
});
// ─────────────────────────────────────────────────────────────────────────────

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

// ─── Generate Follow-up Email ───
app.post('/generate-email', async (req, res) => {
  const { transcript, summary, actionItems, title, date } = req.body;
  if (!transcript) return res.status(400).json({ success: false, error: 'No transcript provided' });

  try {
    let actionItemsText = '';
    if (actionItems && actionItems.length > 0) {
      actionItemsText = actionItems.map((item, i) => {
        let line = `${i + 1}. ${item.task}`;
        if (item.owner)    line += ` (Owner: ${item.owner})`;
        if (item.deadline) line += ` (Due: ${item.deadline})`;
        return line;
      }).join('\n');
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a professional email writer for Indian businesses.
Generate a polished follow-up email after a meeting.
Rules:
1. Write in clear professional English
2. Subject line should be: "Follow-up: [Meeting Title]"
3. Include: brief greeting, meeting summary, action items with owners, next steps, professional closing
4. Keep it concise — max 250 words
5. Format: Subject on first line, then blank line, then email body
6. Use Indian business context — formal but friendly tone
7. Return ONLY the email — no extra commentary`
        },
        {
          role: 'user',
          content: `Generate a follow-up email for this meeting:

Title: ${title || 'Meeting'}
Date: ${date || new Date().toLocaleDateString('en-IN')}

Summary:
${summary || transcript.substring(0, 1000)}

Action Items:
${actionItemsText || 'None identified'}

Write the complete follow-up email now.`
        }
      ],
      max_tokens: 600,
    });

    const emailContent = completion.choices[0].message.content.trim();
    const lines        = emailContent.split('\n');
    const subjectLine  = lines[0].replace(/^Subject:\s*/i, '').trim();
    const body         = lines.slice(2).join('\n').trim();

    res.json({ success: true, subject: subjectLine, body, full: emailContent });

  } catch (err) {
    console.error('/generate-email error:', err.message);
    res.status(500).json({ success: false, error: err.message });
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

    // ─── Parse structured summary if JSON ───
    let summaryHTML = '';
    if (data.auto_summary) {
      let structuredSummary = null;
      try {
        const clean = data.auto_summary.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
        structuredSummary = JSON.parse(clean);
      } catch { /* plain text summary */ }

      if (structuredSummary) {
        const mode = data.mode || 'default';
        const TEMPLATE_LABELS = {
          meeting:   '🤝 Meeting Notes',
          sales:     '📞 Sales Call',
          lecture:   '🎓 Lecture Notes',
          doctor:    '🏥 Doctor Notes',
          legal:     '⚖️ Legal Notes',
          interview: '👤 Interview Notes',
          default:   '📝 Notes',
        };
        let fieldsHTML = '';

        if (structuredSummary.summary) {
          fieldsHTML += `<div style="font-style:italic;color:#555;margin-bottom:12px;font-size:14px;">${structuredSummary.summary}</div>`;
        }
        // Meeting
        if (structuredSummary.key_decisions?.length > 0) {
          fieldsHTML += `<div style="font-weight:700;color:#1A56A0;margin:10px 0 6px;">✅ Key Decisions</div>`;
          fieldsHTML += structuredSummary.key_decisions.map(d => `<div style="padding:4px 0 4px 12px;border-left:3px solid #1A56A0;margin-bottom:4px;font-size:13px;">${d}</div>`).join('');
        }
        if (structuredSummary.next_meeting_date && structuredSummary.next_meeting_date !== 'Not mentioned') {
          fieldsHTML += `<div style="margin-top:10px;padding:8px 12px;background:#EFF6FF;border-radius:8px;font-size:13px;"><strong>📅 Next Meeting:</strong> ${structuredSummary.next_meeting_date}</div>`;
        }
        // Sales
        if (structuredSummary.lead_name && structuredSummary.lead_name !== 'Not mentioned') {
          fieldsHTML += `<div style="margin-bottom:8px;padding:8px 12px;background:#ECFDF5;border-radius:8px;font-size:13px;"><strong>🏢 Lead:</strong> ${structuredSummary.lead_name}</div>`;
        }
        if (structuredSummary.requirements?.length > 0) {
          fieldsHTML += `<div style="font-weight:700;color:#059669;margin:10px 0 6px;">🎯 Requirements</div>`;
          fieldsHTML += structuredSummary.requirements.map(r => `<div style="padding:4px 0 4px 12px;border-left:3px solid #059669;margin-bottom:4px;font-size:13px;">${r}</div>`).join('');
        }
        if (structuredSummary.objections?.length > 0) {
          fieldsHTML += `<div style="font-weight:700;color:#D97706;margin:10px 0 6px;">⚠️ Objections</div>`;
          fieldsHTML += structuredSummary.objections.map(o => `<div style="padding:4px 0 4px 12px;border-left:3px solid #D97706;margin-bottom:4px;font-size:13px;">${o}</div>`).join('');
        }
        if (structuredSummary.next_steps?.length > 0) {
          fieldsHTML += `<div style="font-weight:700;color:#059669;margin:10px 0 6px;">🚀 Next Steps</div>`;
          fieldsHTML += structuredSummary.next_steps.map(s => `<div style="padding:4px 0 4px 12px;border-left:3px solid #059669;margin-bottom:4px;font-size:13px;">${s}</div>`).join('');
        }
        // Lecture
        if (structuredSummary.key_concepts?.length > 0) {
          fieldsHTML += `<div style="font-weight:700;color:#7C3AED;margin:10px 0 6px;">💡 Key Concepts</div>`;
          fieldsHTML += structuredSummary.key_concepts.map(c => `<div style="padding:4px 0 4px 12px;border-left:3px solid #7C3AED;margin-bottom:4px;font-size:13px;">${c}</div>`).join('');
        }
        if (structuredSummary.definitions?.length > 0) {
          fieldsHTML += `<div style="font-weight:700;color:#7C3AED;margin:10px 0 6px;">📖 Definitions</div>`;
          fieldsHTML += structuredSummary.definitions.map(d => `<div style="padding:8px 12px;background:#F5F3FF;border-radius:6px;margin-bottom:6px;font-size:13px;"><strong>${d.term}:</strong> ${d.definition}</div>`).join('');
        }
        if (structuredSummary.study_questions?.length > 0) {
          fieldsHTML += `<div style="font-weight:700;color:#7C3AED;margin:10px 0 6px;">❓ Study Questions</div>`;
          fieldsHTML += structuredSummary.study_questions.map((q, i) => `<div style="padding:6px 12px;margin-bottom:4px;font-size:13px;"><strong>Q${i+1}:</strong> ${q}</div>`).join('');
        }
        // Doctor
        if (structuredSummary.patient_complaint) {
          fieldsHTML += `<div style="margin-bottom:8px;padding:10px 12px;background:#FEF2F2;border-radius:8px;font-size:13px;"><strong>🩺 Complaint:</strong> ${structuredSummary.patient_complaint}</div>`;
        }
        if (structuredSummary.diagnosis && structuredSummary.diagnosis !== 'Not mentioned') {
          fieldsHTML += `<div style="margin-bottom:8px;padding:10px 12px;background:#FEF2F2;border-radius:8px;font-size:13px;"><strong>🔬 Diagnosis:</strong> ${structuredSummary.diagnosis}</div>`;
        }
        if (structuredSummary.prescription?.length > 0) {
          fieldsHTML += `<div style="font-weight:700;color:#DC2626;margin:10px 0 6px;">💊 Prescription</div>`;
          fieldsHTML += structuredSummary.prescription.map(p => `<div style="padding:8px 12px;background:#FFF5F5;border-radius:6px;margin-bottom:6px;font-size:13px;"><strong>${p.medicine}</strong> — ${p.dosage}, ${p.frequency}, ${p.duration}</div>`).join('');
        }
        if (structuredSummary.followup_date && structuredSummary.followup_date !== 'Not mentioned') {
          fieldsHTML += `<div style="margin-top:10px;padding:8px 12px;background:#FEF2F2;border-radius:8px;font-size:13px;"><strong>📅 Follow-up:</strong> ${structuredSummary.followup_date}</div>`;
        }
        // Legal
        if (structuredSummary.client_details && structuredSummary.client_details !== 'Not mentioned') {
          fieldsHTML += `<div style="margin-bottom:8px;padding:10px 12px;background:#FFFBEB;border-radius:8px;font-size:13px;"><strong>👤 Client:</strong> ${structuredSummary.client_details}</div>`;
        }
        if (structuredSummary.case_summary) {
          fieldsHTML += `<div style="margin-bottom:8px;padding:10px 12px;background:#FFFBEB;border-radius:8px;font-size:13px;"><strong>📄 Case:</strong> ${structuredSummary.case_summary}</div>`;
        }
        if (structuredSummary.next_hearing_date && structuredSummary.next_hearing_date !== 'Not mentioned') {
          fieldsHTML += `<div style="margin-top:10px;padding:8px 12px;background:#FFFBEB;border-radius:8px;font-size:13px;"><strong>⚖️ Next Hearing:</strong> ${structuredSummary.next_hearing_date}</div>`;
        }
        // Interview
        if (structuredSummary.candidate_name && structuredSummary.candidate_name !== 'Not mentioned') {
          fieldsHTML += `<div style="margin-bottom:8px;padding:10px 12px;background:#F0F9FF;border-radius:8px;font-size:13px;"><strong>👤 Candidate:</strong> ${structuredSummary.candidate_name}</div>`;
        }
        if (structuredSummary.key_answers?.length > 0) {
          fieldsHTML += `<div style="font-weight:700;color:#0369A1;margin:10px 0 6px;">💬 Key Answers</div>`;
          fieldsHTML += structuredSummary.key_answers.map(a => `<div style="padding:4px 0 4px 12px;border-left:3px solid #0369A1;margin-bottom:4px;font-size:13px;">${a}</div>`).join('');
        }
        if (structuredSummary.evaluation?.strengths?.length > 0) {
          fieldsHTML += `<div style="font-weight:700;color:#059669;margin:10px 0 6px;">✅ Strengths</div>`;
          fieldsHTML += structuredSummary.evaluation.strengths.map(s => `<div style="padding:4px 0 4px 12px;border-left:3px solid #059669;margin-bottom:4px;font-size:13px;">${s}</div>`).join('');
        }
        if (structuredSummary.evaluation?.concerns?.length > 0) {
          fieldsHTML += `<div style="font-weight:700;color:#DC2626;margin:10px 0 6px;">⚠️ Concerns</div>`;
          fieldsHTML += structuredSummary.evaluation.concerns.map(c => `<div style="padding:4px 0 4px 12px;border-left:3px solid #DC2626;margin-bottom:4px;font-size:13px;">${c}</div>`).join('');
        }
        if (structuredSummary.decision) {
          fieldsHTML += `<div style="margin-top:10px;padding:10px 12px;background:#F0F9FF;border-radius:8px;font-size:13px;"><strong>🎯 Decision:</strong> ${structuredSummary.decision}</div>`;
        }
        // Default
        if (structuredSummary.key_points?.length > 0) {
          fieldsHTML += `<div style="font-weight:700;color:#374151;margin:10px 0 6px;">💡 Key Points</div>`;
          fieldsHTML += structuredSummary.key_points.map(p => `<div style="padding:4px 0 4px 12px;border-left:3px solid #374151;margin-bottom:4px;font-size:13px;">${p}</div>`).join('');
        }
        if (structuredSummary.decisions?.length > 0) {
          fieldsHTML += `<div style="font-weight:700;color:#374151;margin:10px 0 6px;">✅ Decisions</div>`;
          fieldsHTML += structuredSummary.decisions.map(d => `<div style="padding:4px 0 4px 12px;border-left:3px solid #374151;margin-bottom:4px;font-size:13px;">${d}</div>`).join('');
        }

        summaryHTML = `
          <div class="section">
            <div class="section-title" style="color:#1A7A4A;border-left-color:#1A7A4A;">🤖 ${TEMPLATE_LABELS[mode] || 'AI Notes'}</div>
            <div style="background:#F0FAF4;padding:16px;border-radius:8px;">${fieldsHTML}</div>
          </div>`;
      } else {
        // Plain text fallback
        summaryHTML = `
          <div class="section">
            <div class="section-title" style="color:#1A7A4A;border-left-color:#1A7A4A;">🤖 AI Summary</div>
            <div style="background:#F0FAF4;padding:16px;border-radius:8px;font-size:14px;line-height:1.8;color:#333;white-space:pre-wrap;">${data.auto_summary}</div>
          </div>`;
      }
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
        const start = u.start ? `${Math.floor(u.start/60000).toString().padStart(2,'0')}:${Math.floor((u.start%60000)/1000).toString().padStart(2,'00')}` : '';
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

// ─── HELPERS ─────────────────────────────────────────────────────────────────

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

const generateSummary = async (text, mode) => {
  try {
    const truncated    = text.length > 8000 ? text.substring(0, 8000) + '...' : text;
    const systemPrompt = TEMPLATE_PROMPTS[mode] || TEMPLATE_PROMPTS.default;
    const completion   = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: 'Extract structured notes from this transcript:\n\n' + truncated }
      ],
      max_tokens: 1000,
    });

    const raw   = completion.choices[0].message.content.trim();
    const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

    try {
      JSON.parse(clean);
      return clean; // valid JSON string — store in Supabase
    } catch {
      console.warn('generateSummary: GPT returned non-JSON, storing as plain text');
      return raw;
    }
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

const detectSpeakerNames = async (utterances) => {
  try {
    if (!utterances || utterances.length === 0) return {};

    const dialogue = utterances.slice(0, 30).map(u =>
      `${u.speaker}: ${u.englishText || u.text}`
    ).join('\n');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an expert at detecting when people introduce themselves in conversations.
Analyze the transcript and find speaker introductions in English, Hindi or Marathi.
Look for patterns like:
- "I am [name]", "I'm [name]", "My name is [name]"
- "Main [name] hoon", "Mera naam [name] hai"
- "This is [name]", "Hello I'm [name]", "Hi [name] here"
- "[name] speaking", "It's [name]"
- Someone else addressing them: "Hello [name]", "Thank you [name]"

Rules:
1. Only return names you are VERY confident about
2. Names should be real person names — not generic words
3. Return ONLY a JSON object mapping speaker labels to real names
4. Example: {"Speaker A": "Anshul", "Speaker B": "Priya"}
5. If no introductions found, return: {}
6. Return ONLY the JSON, nothing else`
        },
        {
          role: 'user',
          content: `Detect speaker names from this transcript:\n\n${dialogue}`
        }
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

// ─── Helper: Process completed transcript ────────────────────────────────────
const processTranscript = async (transcript, mode) => {
  const rawText      = transcript.text || '';
  const detectedLang = transcript.language_code || 'en';
  const speakerList  = [...new Set((transcript.utterances || []).map(u => u.speaker))];

  console.log('Speakers detected:', speakerList);
  console.log('Detected language:', detectedLang);
  console.log('Template mode:', mode || 'default');

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
  const autoSummary  = summaryInput ? await generateSummary(summaryInput, mode) : null;

  console.log('Extracting action items...');
  const actionItems = summaryInput ? await extractActionItems(summaryInput) : [];

  console.log('Generating smart title...');
  const smartTitle = summaryInput ? await generateTitle(summaryInput, detectedLang) : null;
  console.log('Smart title result:', smartTitle);

  console.log('Detecting speaker names...');
  const speakerNameMap = await detectSpeakerNames(englishUtterances || utterances);

  let finalUtterances = englishUtterances || utterances;
  if (Object.keys(speakerNameMap).length > 0) {
    finalUtterances = finalUtterances.map(u => ({
      ...u,
      speaker: speakerNameMap[u.speaker] || u.speaker,
    }));
    console.log('Speaker names applied:', speakerNameMap);
  }

  return {
    success:      true,
    status:       'completed',
    text:         rawText,
    smartTitle:   smartTitle     || null,
    englishText:  englishText    || null,
    utterances:   finalUtterances,
    words:        transcript.words || [],
    duration:     transcript.audio_duration || null,
    detectedLang: detectedLang,
    autoSummary:  autoSummary    || null,
    actionItems:  actionItems    || [],
    speakers:     speakerList.length,
    speakerNames: speakerNameMap,
  };
};

// ─── ROUTE 1: Start transcription job ────────────────────────────────────────
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
      speech_models:      ['universal-3-pro'],
      webhook_url:        webhookUrl,
    });

    console.log('Job submitted with webhook! ID:', job.id);

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

// ─── WEBHOOK: AssemblyAI calls this when done ────────────────────────────────
app.post('/webhook/assemblyai', async (req, res) => {
  try {
    const { transcript_id, status } = req.body;
    console.log('Webhook received! Job:', transcript_id, 'Status:', status);

    res.json({ success: true });

    if (status !== 'completed') {
      await supabase.from('transcription_jobs')
        .update({ status })
        .eq('id', transcript_id);
      return;
    }

    const { data: existingJob } = await supabase
      .from('transcription_jobs')
      .select('status, result')
      .eq('id', transcript_id)
      .single();

    if (existingJob?.status === 'done') {
      console.log('Job already processed, skipping:', transcript_id);
      return;
    }

    console.log('Fetching transcript from AssemblyAI...');
    const transcript = await aai.transcripts.get(transcript_id);

    if (transcript.status !== 'completed') return;

    console.log('Processing transcript (webhook)...');
    const result = await processTranscript(transcript); // webhook has no mode — uses default

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

// ─── ROUTE 2: Poll job status ─────────────────────────────────────────────────
app.get('/transcribe-status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    console.log('Checking status for job:', jobId);

    const { data: cachedJob } = await supabase
      .from('transcription_jobs')
      .select('status, result')
      .eq('id', jobId)
      .single();

    if (cachedJob?.status === 'done' && cachedJob?.result) {
      console.log('Returning cached result for job:', jobId);
      return res.json(cachedJob.result);
    }

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

    if (transcript.status === 'completed') {
      const { data: recheckJob } = await supabase
        .from('transcription_jobs')
        .select('status, result')
        .eq('id', jobId)
        .single();

      if (recheckJob?.status === 'done' && recheckJob?.result) {
        return res.json(recheckJob.result);
      }

      console.log('Processing completed transcript (fallback)...');
      const result = await processTranscript(transcript);

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

// ─── ROUTE 3: Old sync route ──────────────────────────────────────────────────
app.post('/transcribe-speakers', upload.single('audio'), async (req, res) => {
  const tempPath = req.file ? req.file.path : null;
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No audio file received' });

    console.log('Audio file received:', req.file.originalname);
    const uploadUrl = await aai.files.upload(fs.createReadStream(tempPath));
    fs.unlinkSync(tempPath);

    const transcript = await aai.transcripts.transcribe({
      audio:              uploadUrl,
      speaker_labels:     true,
      speakers_expected:  5,
      language_detection: true,
      format_text:        true,
      punctuate:          true,
      speech_models:      ['universal-3-pro'],
    });

    if (transcript.status === 'error') throw new Error('AssemblyAI error: ' + transcript.error);

    const result = await processTranscript(transcript);
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