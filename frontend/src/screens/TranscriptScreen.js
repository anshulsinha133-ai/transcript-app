import React, { useState, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView, Alert,
  ActivityIndicator, Share, TextInput,
  KeyboardAvoidingView, Platform, FlatList,
  StatusBar, Modal, Keyboard, Linking
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { summarizeTranscript, chatWithTranscripts } from '../services/api';
import { updateSpeakerNames, updateTranscriptFolder } from '../utils/storage';

const FOLDERS = ['General', 'Work', 'Personal', 'Meetings', 'Lectures'];
const FOLDER_ICONS = {
  General:  '🗂️',
  Work:     '💼',
  Personal: '👤',
  Meetings: '👥',
  Lectures: '🎓',
};

// ─── Template config ──────────────────────────────────────────────────────────
const TEMPLATE_MAP = {
  meeting:   { icon: '🤝', label: 'Meeting Notes', color: '#1A56A0', bg: '#E8F0FC' },
  sales:     { icon: '📞', label: 'Sales Call',    color: '#059669', bg: '#ECFDF5' },
  lecture:   { icon: '🎓', label: 'Lecture Notes', color: '#7C3AED', bg: '#F5F3FF' },
  doctor:    { icon: '🏥', label: 'Doctor Notes',  color: '#DC2626', bg: '#FEF2F2' },
  legal:     { icon: '⚖️', label: 'Legal Notes',   color: '#92400E', bg: '#FFFBEB' },
  interview: { icon: '👤', label: 'Interview',     color: '#0369A1', bg: '#F0F9FF' },
};

// ─── Helper: parse JSON summary string ───────────────────────────────────────
const parseStructuredSummary = (summary) => {
  if (!summary) return null;
  if (typeof summary === 'object') return summary;
  try {
    const clean = summary
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    return JSON.parse(clean);
  } catch {
    return null;
  }
};

// ─── Structured summary renderer ─────────────────────────────────────────────
const StructuredSummary = ({ summary, mode }) => {
  const data = useMemo(() => parseStructuredSummary(summary), [summary]);
  if (!data) return null;

  const cfg = TEMPLATE_MAP[mode] || { color: '#374151', bg: '#F9FAFB' };

  const SectionLabel = ({ icon, text, color }) => (
    <View style={[ss.sectionLabel, { borderLeftColor: color || cfg.color }]}>
      <Text style={[ss.sectionLabelText, { color: color || cfg.color }]}>{icon}  {text}</Text>
    </View>
  );

  const BulletItem = ({ text, color }) => (
    <View style={ss.bulletRow}>
      <View style={[ss.bullet, { backgroundColor: color || cfg.color }]} />
      <Text style={ss.bulletText}>{text}</Text>
    </View>
  );

  const ActionRow = ({ item, index }) => (
    <View style={[ss.actionRow, index % 2 === 0 ? ss.actionEven : ss.actionOdd]}>
      <View style={[ss.actionNum, { backgroundColor: cfg.color }]}>
        <Text style={ss.actionNumText}>{index + 1}</Text>
      </View>
      <View style={ss.actionContent}>
        <Text style={ss.actionTask}>{item.task}</Text>
        <View style={ss.actionMeta}>
          {item.owner && item.owner !== 'Unassigned' && (
            <Text style={ss.actionMetaText}>👤 {item.owner}</Text>
          )}
          {item.deadline && item.deadline !== 'Not mentioned' && (
            <Text style={ss.actionMetaText}>📅 {item.deadline}</Text>
          )}
        </View>
      </View>
    </View>
  );

  const HighlightBox = ({ icon, label, value, bg, color }) => {
    if (!value || value === 'Not mentioned') return null;
    return (
      <View style={[ss.highlightBox, { backgroundColor: bg || cfg.bg, borderColor: color || cfg.color }]}>
        <Text style={[ss.highlightLabel, { color: color || cfg.color }]}>{icon} {label}</Text>
        <Text style={ss.highlightValue}>{value}</Text>
      </View>
    );
  };

  return (
    <View>
      {/* One-line summary */}
      {data.summary && (
        <View style={[ss.summaryLine, { borderLeftColor: cfg.color }]}>
          <Text style={ss.summaryLineText}>{data.summary}</Text>
        </View>
      )}

      {/* ── MEETING ── */}
      {mode === 'meeting' && <>
        {data.key_decisions?.length > 0 && (
          <View style={ss.block}>
            <SectionLabel icon="✅" text="Key Decisions" />
            {data.key_decisions.map((d, i) => <BulletItem key={i} text={d} />)}
          </View>
        )}
        {data.action_items?.length > 0 && (
          <View style={ss.block}>
            <SectionLabel icon="📋" text="Action Items" />
            {data.action_items.map((item, i) => <ActionRow key={i} item={item} index={i} />)}
          </View>
        )}
        <HighlightBox icon="📅" label="Next Meeting" value={data.next_meeting_date} />
      </>}

      {/* ── SALES ── */}
      {mode === 'sales' && <>
        <HighlightBox icon="🏢" label="Lead" value={data.lead_name} bg="#ECFDF5" color="#059669" />
        {data.requirements?.length > 0 && (
          <View style={ss.block}>
            <SectionLabel icon="🎯" text="Requirements" color="#059669" />
            {data.requirements.map((r, i) => <BulletItem key={i} text={r} color="#059669" />)}
          </View>
        )}
        {data.objections?.length > 0 && (
          <View style={ss.block}>
            <SectionLabel icon="⚠️" text="Objections" color="#D97706" />
            {data.objections.map((o, i) => <BulletItem key={i} text={o} color="#D97706" />)}
          </View>
        )}
        {data.next_steps?.length > 0 && (
          <View style={ss.block}>
            <SectionLabel icon="🚀" text="Next Steps" color="#059669" />
            {data.next_steps.map((s, i) => <BulletItem key={i} text={s} color="#059669" />)}
          </View>
        )}
      </>}

      {/* ── LECTURE ── */}
      {mode === 'lecture' && <>
        {data.key_concepts?.length > 0 && (
          <View style={ss.block}>
            <SectionLabel icon="💡" text="Key Concepts" color="#7C3AED" />
            {data.key_concepts.map((c, i) => <BulletItem key={i} text={c} color="#7C3AED" />)}
          </View>
        )}
        {data.definitions?.length > 0 && (
          <View style={ss.block}>
            <SectionLabel icon="📖" text="Definitions" color="#7C3AED" />
            {data.definitions.map((d, i) => (
              <View key={i} style={[ss.defBox, { borderLeftColor: '#7C3AED' }]}>
                <Text style={[ss.defTerm, { color: '#7C3AED' }]}>{d.term}</Text>
                <Text style={ss.defMeaning}>{d.definition}</Text>
              </View>
            ))}
          </View>
        )}
        {data.study_questions?.length > 0 && (
          <View style={ss.block}>
            <SectionLabel icon="❓" text="Study Questions" color="#7C3AED" />
            {data.study_questions.map((q, i) => (
              <View key={i} style={ss.questionRow}>
                <Text style={[ss.questionNum, { color: '#7C3AED' }]}>Q{i + 1}</Text>
                <Text style={ss.questionText}>{q}</Text>
              </View>
            ))}
          </View>
        )}
      </>}

      {/* ── DOCTOR ── */}
      {mode === 'doctor' && <>
        {data.patient_complaint && (
          <View style={[ss.plainBox, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}>
            <Text style={[ss.plainBoxLabel, { color: '#DC2626' }]}>🩺 Patient Complaint</Text>
            <Text style={ss.plainBoxText}>{data.patient_complaint}</Text>
          </View>
        )}
        <HighlightBox icon="🔬" label="Diagnosis" value={data.diagnosis} bg="#FEF2F2" color="#DC2626" />
        {data.prescription?.length > 0 && (
          <View style={ss.block}>
            <SectionLabel icon="💊" text="Prescription" color="#DC2626" />
            {data.prescription.map((p, i) => (
              <View key={i} style={[ss.actionRow, i % 2 === 0 ? ss.actionEven : ss.actionOdd]}>
                <Text style={[ss.medicineName, { color: '#DC2626' }]}>{p.medicine}</Text>
                <View style={ss.actionMeta}>
                  {p.dosage    !== 'Not specified' && <Text style={ss.actionMetaText}>💊 {p.dosage}</Text>}
                  {p.frequency !== 'Not specified' && <Text style={ss.actionMetaText}>🔁 {p.frequency}</Text>}
                  {p.duration  !== 'Not specified' && <Text style={ss.actionMetaText}>⏱ {p.duration}</Text>}
                </View>
              </View>
            ))}
          </View>
        )}
        <HighlightBox icon="📅" label="Follow-up" value={data.followup_date} bg="#FEF2F2" color="#DC2626" />
      </>}

      {/* ── LEGAL ── */}
      {mode === 'legal' && <>
        <HighlightBox icon="👤" label="Client" value={data.client_details} bg="#FFFBEB" color="#92400E" />
        {data.case_summary && (
          <View style={[ss.plainBox, { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }]}>
            <Text style={[ss.plainBoxLabel, { color: '#92400E' }]}>📄 Case Summary</Text>
            <Text style={ss.plainBoxText}>{data.case_summary}</Text>
          </View>
        )}
        {data.action_items?.length > 0 && (
          <View style={ss.block}>
            <SectionLabel icon="📋" text="Action Items" color="#92400E" />
            {data.action_items.map((item, i) => <ActionRow key={i} item={item} index={i} />)}
          </View>
        )}
        <HighlightBox icon="⚖️" label="Next Hearing" value={data.next_hearing_date} bg="#FFFBEB" color="#92400E" />
      </>}

      {/* ── INTERVIEW ── */}
      {mode === 'interview' && <>
        <HighlightBox icon="👤" label="Candidate" value={data.candidate_name} bg="#F0F9FF" color="#0369A1" />
        {data.key_answers?.length > 0 && (
          <View style={ss.block}>
            <SectionLabel icon="💬" text="Key Answers" color="#0369A1" />
            {data.key_answers.map((a, i) => <BulletItem key={i} text={a} color="#0369A1" />)}
          </View>
        )}
        {(data.evaluation?.strengths?.length > 0 || data.evaluation?.concerns?.length > 0) && (
          <View style={ss.block}>
            <SectionLabel icon="📊" text="Evaluation" color="#0369A1" />
            {data.evaluation?.strengths?.length > 0 && (
              <View style={ss.evalBlock}>
                <Text style={ss.evalSubLabel}>✅ Strengths</Text>
                {data.evaluation.strengths.map((s, i) => <BulletItem key={i} text={s} color="#059669" />)}
              </View>
            )}
            {data.evaluation?.concerns?.length > 0 && (
              <View style={[ss.evalBlock, { marginTop: 8 }]}>
                <Text style={ss.evalSubLabel}>⚠️ Concerns</Text>
                {data.evaluation.concerns.map((c, i) => <BulletItem key={i} text={c} color="#DC2626" />)}
              </View>
            )}
          </View>
        )}
        <HighlightBox icon="🎯" label="Decision" value={data.decision} bg="#F0F9FF" color="#0369A1" />
      </>}

      {/* ── MEETING — add key_points ── */}
      {mode === 'meeting' && data.key_points?.length > 0 && (
        <View style={ss.block}>
          <SectionLabel icon="💬" text="Key Points Discussed" />
          {data.key_points.map((p, i) => <BulletItem key={i} text={p} />)}
        </View>
      )}

      {/* ── SALES — add deal_stage ── */}
      {mode === 'sales' && data.deal_stage && (
        <View style={[ss.highlightBox, { backgroundColor: '#ECFDF5', borderColor: '#059669' }]}>
          <Text style={[ss.highlightLabel, { color: '#059669' }]}>📊 Deal Stage</Text>
          <Text style={ss.highlightValue}>{data.deal_stage}</Text>
        </View>
      )}

      {/* ── DOCTOR — add tests_ordered and advice ── */}
      {mode === 'doctor' && data.tests_ordered?.length > 0 && (
        <View style={ss.block}>
          <SectionLabel icon="🧪" text="Tests Ordered" color="#DC2626" />
          {data.tests_ordered.map((t, i) => <BulletItem key={i} text={t} color="#DC2626" />)}
        </View>
      )}
      {mode === 'doctor' && data.advice?.length > 0 && (
        <View style={ss.block}>
          <SectionLabel icon="💬" text="Doctor's Advice" color="#DC2626" />
          {data.advice.map((a, i) => <BulletItem key={i} text={a} color="#DC2626" />)}
        </View>
      )}

      {/* ── LEGAL — add key_points ── */}
      {mode === 'legal' && data.key_points?.length > 0 && (
        <View style={ss.block}>
          <SectionLabel icon="📌" text="Key Legal Points" color="#92400E" />
          {data.key_points.map((p, i) => <BulletItem key={i} text={p} color="#92400E" />)}
        </View>
      )}

      {/* ── INTERVIEW — add role and cultural_fit ── */}
      {mode === 'interview' && data.role && data.role !== 'Not mentioned' && (
        <View style={[ss.highlightBox, { backgroundColor: '#F0F9FF', borderColor: '#0369A1' }]}>
          <Text style={[ss.highlightLabel, { color: '#0369A1' }]}>💼 Role</Text>
          <Text style={ss.highlightValue}>{data.role}</Text>
        </View>
      )}
      {mode === 'interview' && data.cultural_fit && (
        <View style={[ss.plainBox, { backgroundColor: '#F0F9FF', borderColor: '#BAE6FD' }]}>
          <Text style={[ss.plainBoxLabel, { color: '#0369A1' }]}>🤝 Cultural Fit</Text>
          <Text style={ss.plainBoxText}>{data.cultural_fit}</Text>
        </View>
      )}

      {/* ── LECTURE — add important_points and assignments ── */}
      {mode === 'lecture' && data.important_points?.length > 0 && (
        <View style={ss.block}>
          <SectionLabel icon="📌" text="Important Points" color="#7C3AED" />
          {data.important_points.map((p, i) => <BulletItem key={i} text={p} color="#7C3AED" />)}
        </View>
      )}
      {mode === 'lecture' && data.assignments?.length > 0 && (
        <View style={ss.block}>
          <SectionLabel icon="📝" text="Assignments / Deadlines" color="#7C3AED" />
          {data.assignments.map((a, i) => <BulletItem key={i} text={a} color="#7C3AED" />)}
        </View>
      )}

      {/* ── DEFAULT / OTHER / AUTO ── */}
      {(!mode || !TEMPLATE_MAP[mode] || mode === 'other' || mode === 'auto') && <>
        {data.key_points?.length > 0 && (
          <View style={ss.block}>
            <SectionLabel icon="💡" text="Key Points" />
            {data.key_points.map((p, i) => <BulletItem key={i} text={p} />)}
          </View>
        )}
        {data.action_items?.length > 0 && (
          <View style={ss.block}>
            <SectionLabel icon="📋" text="Action Items" />
            {data.action_items.map((item, i) => <ActionRow key={i} item={item} index={i} />)}
          </View>
        )}
        {data.decisions?.length > 0 && (
          <View style={ss.block}>
            <SectionLabel icon="✅" text="Decisions" />
            {data.decisions.map((d, i) => <BulletItem key={i} text={d} />)}
          </View>
        )}
        {data.follow_up?.length > 0 && (
          <View style={ss.block}>
            <SectionLabel icon="🔄" text="Follow Up" />
            {data.follow_up.map((f, i) => <BulletItem key={i} text={f} />)}
          </View>
        )}
      </>}
    </View>
  );
};

// Structured summary styles
const ss = StyleSheet.create({
  summaryLine:      { borderLeftWidth: 3, paddingLeft: 12, paddingVertical: 8,
                      marginBottom: 14, backgroundColor: '#FAFAFA', borderRadius: 4 },
  summaryLineText:  { fontSize: 14, color: '#374151', lineHeight: 22, fontStyle: 'italic' },
  block:            { marginBottom: 16 },
  sectionLabel:     { borderLeftWidth: 3, paddingLeft: 10, marginBottom: 8 },
  sectionLabelText: { fontSize: 13, fontWeight: '700' },
  bulletRow:        { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6, paddingLeft: 4 },
  bullet:           { width: 6, height: 6, borderRadius: 3, marginTop: 7, marginRight: 8 },
  bulletText:       { flex: 1, fontSize: 13, color: '#374151', lineHeight: 20 },
  actionRow:        { flexDirection: 'row', alignItems: 'flex-start',
                      paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, marginBottom: 4 },
  actionEven:       { backgroundColor: '#F8FAFC' },
  actionOdd:        { backgroundColor: '#F1F5F9' },
  actionNum:        { width: 20, height: 20, borderRadius: 10, alignItems: 'center',
                      justifyContent: 'center', marginRight: 8, marginTop: 1 },
  actionNumText:    { color: '#fff', fontSize: 10, fontWeight: '700' },
  actionContent:    { flex: 1 },
  actionTask:       { fontSize: 13, color: '#1E293B', fontWeight: '600', marginBottom: 3 },
  actionMeta:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionMetaText:   { fontSize: 11, color: '#64748B' },
  highlightBox:     { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 10 },
  highlightLabel:   { fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
                      letterSpacing: 0.5, marginBottom: 3 },
  highlightValue:   { fontSize: 14, color: '#1E293B', fontWeight: '500' },
  plainBox:         { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 10 },
  plainBoxLabel:    { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  plainBoxText:     { fontSize: 13, color: '#374151', lineHeight: 20 },
  defBox:           { borderLeftWidth: 3, paddingLeft: 10, paddingVertical: 6,
                      backgroundColor: '#F8FAFC', borderRadius: 4, marginBottom: 8 },
  defTerm:          { fontSize: 13, fontWeight: '700', marginBottom: 2 },
  defMeaning:       { fontSize: 12, color: '#4B5563', lineHeight: 18 },
  questionRow:      { flexDirection: 'row', marginBottom: 8 },
  questionNum:      { fontSize: 12, fontWeight: '700', width: 26, marginTop: 1 },
  questionText:     { flex: 1, fontSize: 13, color: '#374151', lineHeight: 20 },
  medicineName:     { fontSize: 13, fontWeight: '700', marginBottom: 3, flex: 1 },
  evalBlock:        { backgroundColor: '#F8FAFC', borderRadius: 8, padding: 8 },
  evalSubLabel:     { fontSize: 11, fontWeight: '700', color: '#64748B',
                      marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 },
});
// ─────────────────────────────────────────────────────────────────────────────

const SPEAKER_COLORS = [
  '#1A56A0', '#1A7A4A', '#C85A00', '#8B1AAF',
  '#C0392B', '#0097A7', '#795548', '#E91E63'
];
const SPEAKER_BG = [
  '#E8F0FC', '#E8F5EE', '#FEF3E8', '#F3E8FE',
  '#FDE8E8', '#E0F7FA', '#F3EDEB', '#FCE4EC'
];
const getSpeakerIndex = (speaker) => {
  const lastChar  = speaker?.slice(-1)?.toUpperCase() || 'A';
  const code      = lastChar.charCodeAt(0);
  if (code >= 65 && code <= 72) return code - 65;
  const firstChar = speaker?.charAt(0)?.toUpperCase() || 'A';
  return Math.abs(firstChar.charCodeAt(0) - 65) % SPEAKER_COLORS.length;
};

export default function TranscriptScreen({ route }) {
  const { transcript } = route.params;

  const [summary,          setSummary]          = useState(transcript.autoSummary || null);
  const [loadingSummary,   setLoadingSummary]   = useState(false);
  const [showOriginal,     setShowOriginal]     = useState(false);
  const [showChat,         setShowChat]         = useState(false);
  const [chatMessages,     setChatMessages]     = useState([]);
  const [chatInput,        setChatInput]        = useState('');
  const [chatLoading,      setChatLoading]      = useState(false);
  const [exportingPDF,     setExportingPDF]     = useState(false);
  const [sharingLink,      setSharingLink]      = useState(false);
  const [generatingEmail,  setGeneratingEmail]  = useState(false);
  const [sharingWhatsApp,  setSharingWhatsApp]  = useState(false);

  const [utterances,      setUtterances]      = useState(transcript.utterances || []);
  const [renamingModal,   setRenamingModal]   = useState(false);
  const [renamingSpeaker, setRenamingSpeaker] = useState('');
  const [newSpeakerName,  setNewSpeakerName]  = useState('');
  const [savingName,      setSavingName]      = useState(false);

  const [currentFolder, setCurrentFolder] = useState(transcript.folder || 'General');
  const [folderModal,   setFolderModal]   = useState(false);
  const [savingFolder,  setSavingFolder]  = useState(false);

  const flatListRef = useRef(null);
  const inputRef    = useRef(null);

  const hasTranslation = transcript.englishText &&
    transcript.englishText !== transcript.text;

  const templateInfo = TEMPLATE_MAP[transcript.mode] || null;

  // Determine if current summary is structured JSON or plain text
  const isStructuredSummary = useMemo(() => {
    return parseStructuredSummary(summary) !== null;
  }, [summary]);

  const handleSpeakerTap = (speaker) => {
    setRenamingSpeaker(speaker);
    setNewSpeakerName('');
    setRenamingModal(true);
  };

  const saveSpeakerName = async () => {
    const trimmedName = newSpeakerName.trim();
    if (!trimmedName) { Alert.alert('Please enter a name'); return; }
    setSavingName(true);
    const result = await updateSpeakerNames(transcript.id, utterances, { [renamingSpeaker]: trimmedName });
    if (result.success) {
      setUtterances(result.utterances);
      setRenamingModal(false);
      Alert.alert('✅ Renamed!', `"${renamingSpeaker}" is now "${trimmedName}"`);
    } else {
      Alert.alert('Error', result.error || 'Could not save name.');
    }
    setSavingName(false);
  };

  const saveFolder = async (folder) => {
    setSavingFolder(true);
    const result = await updateTranscriptFolder(transcript.id, folder);
    if (result.success) {
      setCurrentFolder(folder);
      setFolderModal(false);
      Alert.alert('✅ Moved!', `Recording moved to "${folder}"`);
    } else {
      Alert.alert('Error', 'Could not move recording. Please try again.');
    }
    setSavingFolder(false);
  };

  const copyToClipboard = async () => {
    await Clipboard.setStringAsync(transcript.englishText || transcript.text);
    Alert.alert('Copied!', 'Transcript copied to clipboard');
  };

  const shareTranscript = async () => {
    try {
      let shareText = transcript.title + '\n\n';
      if (utterances.length > 0) {
        shareText += utterances.map(u => `${u.speaker}:\n${u.englishText || u.text}`).join('\n\n');
      } else {
        shareText += transcript.englishText || transcript.text;
      }
      if (summary) shareText += '\n\n--- AI Summary ---\n' + summary;
      await Share.share({ message: shareText, title: transcript.title });
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  };

  const exportAsText = async () => {
    try {
      let exportText = `${transcript.title}\n${'='.repeat(50)}\n`;
      exportText += `Date: ${formatDate(transcript.createdAt)}\n`;
      exportText += `Folder: ${currentFolder}\n`;
      exportText += `Duration: ${transcript.duration ? Math.round(transcript.duration / 60) + ' min' : 'N/A'}\n\n`;
      if (summary) exportText += `AI SUMMARY\n${'-'.repeat(30)}\n${summary}\n\n`;
      if (transcript.actionItems?.length > 0) {
        exportText += `ACTION ITEMS\n${'-'.repeat(30)}\n`;
        transcript.actionItems.forEach((item, i) => {
          exportText += `${i + 1}. ${item.task}`;
          if (item.owner)    exportText += ` | Owner: ${item.owner}`;
          if (item.deadline) exportText += ` | Due: ${item.deadline}`;
          exportText += '\n';
        });
        exportText += '\n';
      }
      exportText += `TRANSCRIPT\n${'-'.repeat(30)}\n`;
      if (utterances.length > 0) {
        utterances.forEach(u => { exportText += `[${u.speaker}]: ${u.englishText || u.text}\n\n`; });
      } else {
        exportText += transcript.englishText || transcript.text;
      }
      await Clipboard.setStringAsync(exportText);
      Alert.alert('✅ Exported!', 'Full transcript copied to clipboard!');
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  };

  const generateShareLink = async () => {
    try {
      setSharingLink(true);
      const response = await fetch(
        'https://transcript-app-lbpe.onrender.com/share/generate',
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ transcriptId: transcript.id }),
        }
      );
      const data = await response.json();
      if (data.success) {
        await Share.share({
          message: `📝 ${transcript.title}\n\nView transcript: ${data.shareUrl}`,
          title:   transcript.title,
        });
      } else {
        Alert.alert('Error', 'Could not generate share link');
      }
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setSharingLink(false);
    }
  };

  const generateFollowUpEmail = async () => {
    try {
      setGeneratingEmail(true);
      const response = await fetch(
        'https://transcript-app-lbpe.onrender.com/generate-email',
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript:  transcript.englishText || transcript.text,
            summary:     summary || transcript.autoSummary,
            actionItems: transcript.actionItems || [],
            title:       transcript.title,
            date:        formatDate(transcript.createdAt),
          }),
        }
      );
      const data = await response.json();
      if (data.success) {
        const subject = encodeURIComponent(data.subject);
        const body    = encodeURIComponent(data.body);
        const mailUrl = `mailto:?subject=${subject}&body=${body}`;
        const canOpen = await Linking.canOpenURL(mailUrl);
        if (canOpen) {
          await Linking.openURL(mailUrl);
        } else {
          await Clipboard.setStringAsync(`Subject: ${data.subject}\n\n${data.body}`);
          Alert.alert('✅ Email Copied!', 'Email content copied to clipboard. Paste it in your email app.');
        }
      } else {
        Alert.alert('Error', 'Could not generate email. Try again.');
      }
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setGeneratingEmail(false);
    }
  };

  const shareToWhatsApp = async () => {
    try {
      setSharingWhatsApp(true);

      const activeSummary = summary || transcript.autoSummary;
      let message = `📝 *${transcript.title}*\n`;
      message += `🗓️ ${formatDate(transcript.createdAt)}\n`;

      if (activeSummary) {
        // If structured JSON, extract just the summary line for WhatsApp
        const parsed = parseStructuredSummary(activeSummary);
        message += `\n🤖 *Summary:*\n${parsed ? parsed.summary : activeSummary}\n`;
      }

      if (transcript.actionItems?.length > 0) {
        message += `\n✅ *Action Items:*\n`;
        transcript.actionItems.forEach((item, i) => {
          message += `${i + 1}. ${item.task}`;
          if (item.owner)    message += ` — ${item.owner}`;
          if (item.deadline) message += ` (${item.deadline})`;
          message += '\n';
        });
      }

      if (transcript.shareToken) {
        message += `\n🔗 https://transcript-app-lbpe.onrender.com/share/${transcript.shareToken}\n`;
      }

      message += `\n_Shared via VoxNote AI_`;

      const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(message)}`;
      const canOpen = await Linking.canOpenURL(whatsappUrl);

      if (canOpen) {
        await Linking.openURL(whatsappUrl);
      } else {
        await Share.share({ message, title: transcript.title });
      }
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setSharingWhatsApp(false);
    }
  };

  const exportAsPDF = async () => {
    try {
      setExportingPDF(true);
      const date     = formatDate(transcript.createdAt);
      const duration = transcript.duration ? Math.round(transcript.duration / 60) + ' min' : 'N/A';
      const words    = transcript.wordCount || 0;
      const lang     = getLangBadge();

      let actionItemsHTML = '';
      if (transcript.actionItems?.length > 0) {
        const rows = transcript.actionItems.map((item, i) => `
          <tr>
            <td style="padding:10px;border-bottom:1px solid #FFE0B2;font-weight:600;color:#E65100;">${i + 1}</td>
            <td style="padding:10px;border-bottom:1px solid #FFE0B2;color:#333;">${item.task}</td>
            <td style="padding:10px;border-bottom:1px solid #FFE0B2;color:#666;">${item.owner || '—'}</td>
            <td style="padding:10px;border-bottom:1px solid #FFE0B2;color:#666;">${item.deadline || '—'}</td>
          </tr>`).join('');
        actionItemsHTML = `
          <div class="section">
            <div class="section-title" style="color:#E65100;border-left-color:#FF9800;">✅ Action Items</div>
            <table style="width:100%;border-collapse:collapse;background:#FFF8F0;border-radius:8px;overflow:hidden;">
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

      const summaryContent = summary || transcript.autoSummary;
      let summaryHTML = '';
      if (summaryContent) {
        summaryHTML = `
          <div class="section">
            <div class="section-title" style="color:#1A7A4A;border-left-color:#1A7A4A;">🤖 AI Summary</div>
            <div style="background:#F0FAF4;padding:16px;border-radius:8px;font-size:14px;line-height:1.8;color:#333;white-space:pre-wrap;">${summaryContent}</div>
          </div>`;
      }

      let transcriptHTML = '';
      if (utterances.length > 0) {
        const speakerColors = ['#1A56A0','#1A7A4A','#C85A00','#8B1AAF','#C0392B','#0097A7','#795548','#E91E63'];
        const speakerBG     = ['#E8F0FC','#E8F5EE','#FEF3E8','#F3E8FE','#FDE8E8','#E0F7FA','#F3EDEB','#FCE4EC'];
        const utterancesHTML = utterances.map((u) => {
          const idx   = getSpeakerIndex(u.speaker);
          const start = formatTime(u.start);
          const end   = formatTime(u.end);
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
            <div style="font-size:14px;color:#333;line-height:1.8;white-space:pre-wrap;">${transcript.englishText || transcript.text}</div>
          </div>`;
      }

      const html = `<!DOCTYPE html><html>
        <head>
          <meta charset="utf-8"/>
          <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
          <style>
            * { margin:0; padding:0; box-sizing:border-box; }
            body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#fff; color:#333; }
            .header { background:linear-gradient(135deg,#0D3B7A,#1A56A0); color:white; padding:32px 40px; }
            .logo { font-size:13px; font-weight:700; letter-spacing:2px; color:#AACFEE; margin-bottom:12px; text-transform:uppercase; }
            .title { font-size:24px; font-weight:800; margin-bottom:16px; line-height:1.3; }
            .meta-grid { display:flex; gap:24px; flex-wrap:wrap; }
            .meta-item { background:rgba(255,255,255,0.15); padding:8px 14px; border-radius:8px; font-size:12px; }
            .meta-label { color:#AACFEE; font-size:10px; text-transform:uppercase; letter-spacing:1px; margin-bottom:2px; }
            .meta-value { color:#fff; font-weight:600; }
            .body { padding:32px 40px; }
            .section { margin-bottom:32px; }
            .section-title { font-size:16px; font-weight:700; color:#0D3B7A; margin-bottom:16px; padding-left:12px; border-left:4px solid #1A56A0; }
            .footer { margin-top:40px; padding:20px 40px; border-top:1px solid #EEE; text-align:center; font-size:11px; color:#AAA; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="logo">VoxNote — AI Transcription</div>
            <div class="title">${transcript.title}</div>
            <div class="meta-grid">
              <div class="meta-item"><div class="meta-label">Date</div><div class="meta-value">${date}</div></div>
              <div class="meta-item"><div class="meta-label">Duration</div><div class="meta-value">${duration}</div></div>
              <div class="meta-item"><div class="meta-label">Words</div><div class="meta-value">${words}</div></div>
              <div class="meta-item"><div class="meta-label">Language</div><div class="meta-value">${lang}</div></div>
              <div class="meta-item"><div class="meta-label">Folder</div><div class="meta-value">${currentFolder}</div></div>
            </div>
          </div>
          <div class="body">${summaryHTML}${actionItemsHTML}${transcriptHTML}</div>
          <div class="footer">Generated by VoxNote AI Transcription App • ${new Date().toLocaleDateString('en-IN')}</div>
        </body></html>`;

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share or Save PDF', UTI: 'com.adobe.pdf' });
      } else {
        Alert.alert('PDF Created', 'Saved to: ' + uri);
      }
    } catch (err) {
      console.error('PDF export error:', err);
      Alert.alert('Error', 'Could not generate PDF: ' + err.message);
    } finally {
      setExportingPDF(false);
    }
  };

  // ─── Summary — pass mode so server uses right prompt ─────────────────────
  const getSummary = async () => {
    setLoadingSummary(true);
    setSummary(null);
    try {
      const result = await summarizeTranscript(
        transcript.englishText || transcript.text,
        transcript.mode
      );
      if (result.success) setSummary(result.summary);
      else Alert.alert('Error', 'Could not generate summary.');
    } catch (err) { Alert.alert('Error', err.message); }
    setLoadingSummary(false);
  };

  const sendChatMessage = async () => {
    const question = chatInput.trim();
    if (!question || chatLoading) return;
    Keyboard.dismiss();
    const userMsg = { role: 'user', text: question, id: Date.now().toString() };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setChatLoading(true);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    try {
      const result = await chatWithTranscripts(question, [transcript]);
      setChatMessages(prev => [...prev, {
        role: 'ai',
        text: result.success ? result.answer : 'Sorry, could not answer that.',
        id:   (Date.now() + 1).toString(),
      }]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err) {
      setChatMessages(prev => [...prev, {
        role: 'ai', text: 'Something went wrong.', id: (Date.now() + 1).toString()
      }]);
    }
    setChatLoading(false);
  };

  const formatDate = (iso) => new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const formatTime = (ms) => {
    if (!ms) return '0:00';
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  };

  const getLangBadge = () => {
    const lang = transcript.detectedLang || 'en';
    const LANG_NAMES = {
      en: 'English', hi: 'Hindi',     mr: 'Marathi',
      te: 'Telugu',  ta: 'Tamil',     kn: 'Kannada',
      ml: 'Malayalam', bn: 'Bengali', gu: 'Gujarati',
      pa: 'Punjabi', ur: 'Urdu',
    };
    return LANG_NAMES[lang] || 'Auto';
  };

  const renderFolderModal = () => (
    <Modal visible={folderModal} transparent animationType="slide" onRequestClose={() => setFolderModal(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalBox}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>📁 Move to Folder</Text>
            <TouchableOpacity onPress={() => setFolderModal(false)}>
              <Text style={styles.modalCloseX}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.modalSubtitle}>
            Currently in: <Text style={{ fontWeight: 'bold' }}>{FOLDER_ICONS[currentFolder]} {currentFolder}</Text>
          </Text>
          {FOLDERS.map(folder => (
            <TouchableOpacity
              key={folder}
              style={[styles.folderOption, currentFolder === folder && styles.folderOptionActive]}
              onPress={() => saveFolder(folder)}
              disabled={savingFolder}>
              <Text style={styles.folderOptionIcon}>{FOLDER_ICONS[folder]}</Text>
              <Text style={[styles.folderOptionText, currentFolder === folder && styles.folderOptionTextActive]}>{folder}</Text>
              {currentFolder === folder && <Text style={styles.folderOptionCheck}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </Modal>
  );

  const renderRenameModal = () => (
    <Modal visible={renamingModal} transparent animationType="slide" onRequestClose={() => setRenamingModal(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalBox}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>✏️ Rename Speaker</Text>
            <TouchableOpacity onPress={() => setRenamingModal(false)}>
              <Text style={styles.modalCloseX}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.modalCurrentRow}>
            <Text style={styles.modalCurrentLabel}>Current name:</Text>
            <View style={[styles.modalCurrentBadge, { backgroundColor: SPEAKER_COLORS[getSpeakerIndex(renamingSpeaker)] }]}>
              <Text style={styles.modalCurrentBadgeText}>{renamingSpeaker}</Text>
            </View>
          </View>
          <Text style={styles.modalInputLabel}>New name:</Text>
          <TextInput
            style={styles.modalInput}
            value={newSpeakerName}
            onChangeText={setNewSpeakerName}
            placeholder="e.g. Anshul, Rahul, Priya..."
            placeholderTextColor="#AAA"
            autoFocus maxLength={30}
            returnKeyType="done"
            onSubmitEditing={saveSpeakerName}
          />
          <Text style={styles.modalHint}>💡 All "{renamingSpeaker}" labels in this recording will be renamed</Text>
          <View style={styles.modalButtons}>
            <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setRenamingModal(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modalSaveBtn, savingName && { opacity: 0.6 }]} onPress={saveSpeakerName} disabled={savingName}>
              {savingName ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.modalSaveText}>✅ Save Name</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  const renderChatPanel = () => (
    <KeyboardAvoidingView style={styles.chatOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
      <StatusBar barStyle="light-content" backgroundColor="#6C3FA0" />
      <View style={styles.chatHeader}>
        <TouchableOpacity onPress={() => { Keyboard.dismiss(); setShowChat(false); }} style={styles.chatBackBtn}>
          <Text style={styles.chatBackText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.chatHeaderTitle}>💬 Ask AI</Text>
        <View style={{ width: 60 }} />
      </View>
      <View style={styles.chatContext}>
        <Text style={styles.chatContextText} numberOfLines={1}>📝 {transcript.title}</Text>
      </View>
      {chatMessages.length === 0 && (
        <View style={styles.suggestionsContainer}>
          <Text style={styles.suggestionsTitle}>Try asking:</Text>
          <View style={styles.suggestionsGrid}>
            {['What were the main topics?', 'What action items were mentioned?',
              'Who said what about the project?', 'What decisions were made?'
            ].map((q, i) => (
              <TouchableOpacity key={i} style={styles.suggestionChip} onPress={() => { setChatInput(q); setTimeout(() => inputRef.current?.focus(), 100); }}>
                <Text style={styles.suggestionText}>{q}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
      <FlatList
        ref={flatListRef}
        data={chatMessages}
        keyExtractor={item => item.id}
        style={styles.chatMessages}
        contentContainerStyle={styles.chatMessagesContent}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <View style={[styles.chatBubble, item.role === 'user' ? styles.userBubble : styles.aiBubble]}>
            {item.role === 'ai' && <Text style={styles.aiLabel}>🤖 VoxNote AI</Text>}
            <Text selectable={true} style={[styles.chatBubbleText, item.role === 'user' ? styles.userBubbleText : styles.aiBubbleText]}>
              {item.text}
            </Text>
          </View>
        )}
        ListFooterComponent={chatLoading ? (
          <View style={styles.typingIndicator}>
            <ActivityIndicator size="small" color="#6C3FA0" />
            <Text style={styles.typingText}>VoxNote AI is thinking...</Text>
          </View>
        ) : null}
      />
      <View style={styles.chatInputWrapper}>
        <View style={styles.chatInputRow}>
          <TextInput
            ref={inputRef}
            style={styles.chatInput}
            placeholder="Ask anything about this recording..."
            placeholderTextColor="#888"
            value={chatInput}
            onChangeText={setChatInput}
            multiline
            maxLength={500}
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={sendChatMessage}
            onFocus={() => { setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 300); }}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!chatInput.trim() || chatLoading) && styles.sendBtnDisabled]}
            onPress={sendChatMessage}
            disabled={!chatInput.trim() || chatLoading}>
            <Text style={styles.sendBtnText}>➤</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.navBarSpacer} />
      </View>
    </KeyboardAvoidingView>
  );

  return (
    <SafeAreaView style={styles.container}>
      {renderRenameModal()}
      {renderFolderModal()}
      {showChat && renderChatPanel()}

      <ScrollView contentContainerStyle={styles.scroll}>

        <Text selectable={true} style={styles.title}>{transcript.title}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{transcript.wordCount} words  •  {formatDate(transcript.createdAt)}</Text>
          <View style={styles.langBadge}>
            <Text style={styles.langBadgeText}>{getLangBadge()}</Text>
          </View>
        </View>

        {/* Template badge */}
        {templateInfo && (
          <View style={[styles.templateBadge, { backgroundColor: templateInfo.bg, borderColor: templateInfo.color }]}>
            <Text style={styles.templateBadgeIcon}>{templateInfo.icon}</Text>
            <Text style={[styles.templateBadgeLabel, { color: templateInfo.color }]}>{templateInfo.label}</Text>
          </View>
        )}

        <TouchableOpacity style={styles.folderBadge} onPress={() => setFolderModal(true)}>
          <Text style={styles.folderBadgeIcon}>{FOLDER_ICONS[currentFolder]}</Text>
          <Text style={styles.folderBadgeText}>{currentFolder}</Text>
          <Text style={styles.folderBadgeChange}>Change →</Text>
        </TouchableOpacity>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.btn} onPress={copyToClipboard}>
            <Text style={styles.btnIcon}>📋</Text>
            <Text style={styles.btnText}>Copy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnGreen]} onPress={getSummary}>
            <Text style={styles.btnIcon}>🤖</Text>
            <Text style={styles.btnText}>Summary</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnOrange]} onPress={shareTranscript}>
            <Text style={styles.btnIcon}>📤</Text>
            <Text style={styles.btnText}>Share</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.chatBtn} onPress={() => setShowChat(true)}>
          <Text style={styles.chatBtnIcon}>💬</Text>
          <View style={styles.chatBtnTextWrapper}>
            <Text style={styles.chatBtnTitle}>Ask AI about this recording</Text>
            <Text style={styles.chatBtnSubtitle}>What was discussed? Any action items?</Text>
          </View>
          <Text style={styles.chatBtnArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.pdfBtn, exportingPDF && { opacity: 0.6 }]} onPress={exportAsPDF} disabled={exportingPDF}>
          {exportingPDF ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.pdfBtnIcon}>📄</Text>}
          <Text style={styles.pdfBtnText}>{exportingPDF ? 'Generating PDF...' : 'Export as PDF'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.shareLinkBtn, sharingLink && { opacity: 0.6 }]} onPress={generateShareLink} disabled={sharingLink}>
          {sharingLink ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.shareLinkIcon}>🔗</Text>}
          <Text style={styles.shareLinkText}>{sharingLink ? 'Generating link...' : 'Share via Link'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.emailBtn, generatingEmail && { opacity: 0.6 }]} onPress={generateFollowUpEmail} disabled={generatingEmail}>
          {generatingEmail ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.emailBtnIcon}>✉️</Text>}
          <Text style={styles.emailBtnText}>{generatingEmail ? 'Generating email...' : 'Generate Follow-up Email'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.whatsAppBtn, sharingWhatsApp && { opacity: 0.6 }]} onPress={shareToWhatsApp} disabled={sharingWhatsApp}>
          {sharingWhatsApp ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.whatsAppBtnIcon}>💬</Text>}
          <Text style={styles.whatsAppBtnText}>{sharingWhatsApp ? 'Opening WhatsApp...' : 'Share to WhatsApp'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.exportBtn} onPress={exportAsText}>
          <Text style={styles.exportBtnIcon}>📋</Text>
          <Text style={styles.exportBtnText}>Export Full Transcript (Text)</Text>
        </TouchableOpacity>

        {loadingSummary && (
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#1A56A0" />
            <Text style={styles.loadingText}>Generating AI summary...</Text>
          </View>
        )}

        {/* ─── AI Summary — structured or plain text ─────────────────── */}
        {summary && (
          <View style={styles.summaryBox}>
            <View style={styles.summaryHeader}>
              <Text style={styles.summaryTitle}>🤖 AI {templateInfo ? templateInfo.label : 'Summary'}</Text>
            </View>
            {isStructuredSummary ? (
              <StructuredSummary summary={summary} mode={transcript.mode} />
            ) : (
              <Text selectable={true} style={styles.summaryText}>{summary}</Text>
            )}
          </View>
        )}
        {/* ─────────────────────────────────────────────────────────────── */}

        {transcript.actionItems?.length > 0 && (
          <View style={styles.actionItemsBox}>
            <Text style={styles.actionItemsTitle}>✅ Action Items</Text>
            {transcript.actionItems.map((item, index) => (
              <View key={index} style={styles.actionItem}>
                <View style={styles.actionItemHeader}>
                  <View style={styles.actionItemNumber}>
                    <Text style={styles.actionItemNumberText}>{index + 1}</Text>
                  </View>
                  <Text selectable={true} style={styles.actionItemTask}>{item.task}</Text>
                </View>
                <View style={styles.actionItemMeta}>
                  {item.owner && (
                    <View style={styles.actionItemBadge}>
                      <Text style={styles.actionItemBadgeText}>👤 {item.owner}</Text>
                    </View>
                  )}
                  {item.deadline && (
                    <View style={[styles.actionItemBadge, styles.deadlineBadge]}>
                      <Text style={styles.actionItemBadgeText}>📅 {item.deadline}</Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {hasTranslation && (
          <View style={styles.translationBox}>
            <View style={styles.translationHeader}>
              <Text style={styles.translationTitle}>🇬🇧 English Translation</Text>
              <TouchableOpacity style={styles.toggleBtn} onPress={() => setShowOriginal(!showOriginal)}>
                <Text style={styles.toggleBtnText}>{showOriginal ? 'Hide Original' : 'Show Original'}</Text>
              </TouchableOpacity>
            </View>
            <Text selectable={true} style={styles.translationText}>{transcript.englishText}</Text>
            {showOriginal && transcript.originalText && (
              <View style={styles.originalBox}>
                <Text style={styles.originalLabel}>Original (Roman script):</Text>
                <Text selectable={true} style={styles.originalText}>{transcript.originalText}</Text>
              </View>
            )}
          </View>
        )}

        {utterances.length > 0 ? (
          <View style={styles.transcriptBox}>
            <Text style={styles.transcriptLabel}>🎙 Speaker Transcript</Text>
            <View style={styles.renameHintBox}>
              <Text style={styles.renameHintText}>✏️ Tap speaker name to rename · Long press text to copy</Text>
            </View>
            <View style={styles.legendRow}>
              {[...new Set(utterances.map(u => u.speaker))].map(speaker => (
                <TouchableOpacity
                  key={speaker}
                  style={[styles.legendBadge, { backgroundColor: SPEAKER_COLORS[getSpeakerIndex(speaker)] }]}
                  onPress={() => handleSpeakerTap(speaker)} activeOpacity={0.7}>
                  <Text style={styles.legendText}>{speaker}  ✏️</Text>
                </TouchableOpacity>
              ))}
            </View>
            {utterances.map((utterance, index) => {
              const idx = getSpeakerIndex(utterance.speaker);
              return (
                <View key={index} style={[styles.utteranceBox, { backgroundColor: SPEAKER_BG[idx] }]}>
                  <View style={styles.speakerRow}>
                    <TouchableOpacity
                      style={[styles.speakerBadge, { backgroundColor: SPEAKER_COLORS[idx] }]}
                      onPress={() => handleSpeakerTap(utterance.speaker)} activeOpacity={0.7}>
                      <Text style={styles.speakerBadgeText}>{utterance.speaker}  ✏️</Text>
                    </TouchableOpacity>
                    <Text style={styles.utteranceTime}>{formatTime(utterance.start)} — {formatTime(utterance.end)}</Text>
                  </View>
                  <Text selectable={true} style={styles.utteranceText}>{utterance.englishText || utterance.text}</Text>
                  {utterance.englishText && utterance.englishText !== utterance.text && (
                    <Text selectable={true} style={styles.utteranceOriginal}>{utterance.text}</Text>
                  )}
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.transcriptBox}>
            <Text style={styles.transcriptLabel}>📝 Full Transcript</Text>
            <Text selectable={true} style={styles.transcriptText}>{transcript.englishText || transcript.text}</Text>
            {hasTranslation && (
              <>
                <TouchableOpacity style={[styles.toggleBtn, { marginTop: 12 }]} onPress={() => setShowOriginal(!showOriginal)}>
                  <Text style={styles.toggleBtnText}>{showOriginal ? 'Hide Original' : 'Show Original'}</Text>
                </TouchableOpacity>
                {showOriginal && (
                  <View style={styles.originalBox}>
                    <Text style={styles.originalLabel}>Original:</Text>
                    <Text selectable={true} style={styles.originalText}>{transcript.originalText || transcript.text}</Text>
                  </View>
                )}
              </>
            )}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#F5F7FA' },
  scroll:       { padding: 20, paddingBottom: 40 },
  title:        { fontSize: 20, fontWeight: 'bold', color: '#0D3B7A', marginBottom: 6 },
  metaRow:      { flexDirection: 'row', justifyContent: 'space-between',
                  alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 },
  meta:         { fontSize: 12, color: '#888' },
  langBadge:    { backgroundColor: '#E8F0FC', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  langBadgeText:{ fontSize: 11, color: '#1A56A0', fontWeight: '600' },

  templateBadge:      { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5,
                        borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
                        marginBottom: 10, gap: 6, alignSelf: 'flex-start' },
  templateBadgeIcon:  { fontSize: 14 },
  templateBadgeLabel: { fontSize: 12, fontWeight: '700' },

  folderBadge:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0F4FF',
                       borderWidth: 1, borderColor: '#D0DAF8', borderRadius: 10,
                       paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12, gap: 6 },
  folderBadgeIcon:   { fontSize: 16 },
  folderBadgeText:   { fontSize: 13, color: '#1A56A0', fontWeight: '600', flex: 1 },
  folderBadgeChange: { fontSize: 12, color: '#888' },

  actions:      { flexDirection: 'row', gap: 10, marginBottom: 10 },
  btn:          { flex: 1, backgroundColor: '#1A56A0', padding: 10, borderRadius: 10, alignItems: 'center' },
  btnGreen:     { backgroundColor: '#1A7A4A' },
  btnOrange:    { backgroundColor: '#C85A00' },
  btnIcon:      { fontSize: 18, marginBottom: 2 },
  btnText:      { color: '#fff', fontWeight: 'bold', fontSize: 12 },

  chatBtn:           { flexDirection: 'row', alignItems: 'center', backgroundColor: '#6C3FA0',
                       padding: 14, borderRadius: 12, marginBottom: 10, gap: 12 },
  chatBtnIcon:       { fontSize: 24 },
  chatBtnTextWrapper:{ flex: 1 },
  chatBtnTitle:      { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  chatBtnSubtitle:   { color: '#DDD0FF', fontSize: 11, marginTop: 2 },
  chatBtnArrow:      { color: '#FFFFFF', fontSize: 24, fontWeight: 'bold' },

  pdfBtn:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#C0392B',
                   padding: 14, borderRadius: 12, marginBottom: 10, gap: 10 },
  pdfBtnIcon:    { fontSize: 20 },
  pdfBtnText:    { color: '#FFFFFF', fontWeight: '700', fontSize: 14, flex: 1 },

  shareLinkBtn:  { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0097A7',
                   padding: 14, borderRadius: 12, marginBottom: 10, gap: 10 },
  shareLinkIcon: { fontSize: 20 },
  shareLinkText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14, flex: 1 },

  emailBtn:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#2E7D32',
                  padding: 14, borderRadius: 12, marginBottom: 10, gap: 10 },
  emailBtnIcon: { fontSize: 20 },
  emailBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14, flex: 1 },

  whatsAppBtn:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#25D366',
                     padding: 14, borderRadius: 12, marginBottom: 10, gap: 10 },
  whatsAppBtnIcon: { fontSize: 20 },
  whatsAppBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14, flex: 1 },

  exportBtn:    { flexDirection: 'row', alignItems: 'center', backgroundColor: '#4A4A8A',
                  padding: 12, borderRadius: 10, marginBottom: 16, gap: 8 },
  exportBtnIcon:{ fontSize: 18 },
  exportBtnText:{ color: '#FFFFFF', fontWeight: '600', fontSize: 13, flex: 1 },

  loadingBox:   { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16,
                  backgroundColor: '#EFF4FF', borderRadius: 10, marginBottom: 16 },
  loadingText:  { color: '#1A56A0', fontSize: 13 },

  summaryBox:    { backgroundColor: '#D6F0E2', padding: 16, borderRadius: 12,
                   marginBottom: 16, borderLeftWidth: 4, borderLeftColor: '#1A7A4A' },
  summaryHeader: { marginBottom: 12 },
  summaryTitle:  { fontSize: 14, fontWeight: 'bold', color: '#1A7A4A' },
  summaryText:   { fontSize: 13, color: '#333', lineHeight: 22 },

  actionItemsBox:      { backgroundColor: '#FFF3E0', padding: 16, borderRadius: 12,
                         marginBottom: 16, borderLeftWidth: 4, borderLeftColor: '#FF9800' },
  actionItemsTitle:    { fontSize: 14, fontWeight: 'bold', color: '#E65100', marginBottom: 12 },
  actionItem:          { backgroundColor: '#FFFFFF', borderRadius: 8, padding: 12, marginBottom: 8 },
  actionItemHeader:    { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 6 },
  actionItemNumber:    { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FF9800',
                         justifyContent: 'center', alignItems: 'center' },
  actionItemNumberText:{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 12 },
  actionItemTask:      { flex: 1, fontSize: 14, color: '#333', fontWeight: '500', lineHeight: 20 },
  actionItemMeta:      { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  actionItemBadge:     { backgroundColor: '#FFF3E0', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  deadlineBadge:       { backgroundColor: '#FCE4EC' },
  actionItemBadgeText: { fontSize: 11, color: '#E65100', fontWeight: '600' },

  translationBox:   { backgroundColor: '#FFF9E6', padding: 16, borderRadius: 12,
                      marginBottom: 16, borderLeftWidth: 4, borderLeftColor: '#E6A817' },
  translationHeader:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  translationTitle: { fontSize: 14, fontWeight: 'bold', color: '#8B6A00' },
  translationText:  { fontSize: 14, color: '#333', lineHeight: 24 },
  originalBox:      { marginTop: 12, padding: 12, backgroundColor: '#F5F0E0', borderRadius: 8 },
  originalLabel:    { fontSize: 11, fontWeight: '600', color: '#888', marginBottom: 6 },
  originalText:     { fontSize: 13, color: '#666', lineHeight: 22, fontStyle: 'italic' },
  toggleBtn:        { paddingHorizontal: 10, paddingVertical: 4, backgroundColor: '#E6A817', borderRadius: 8 },
  toggleBtnText:    { fontSize: 11, color: '#fff', fontWeight: '600' },

  transcriptBox:    { backgroundColor: '#fff', padding: 16, borderRadius: 12, marginBottom: 16 },
  transcriptLabel:  { fontSize: 14, fontWeight: 'bold', color: '#0D3B7A', marginBottom: 8 },
  transcriptText:   { fontSize: 15, color: '#333', lineHeight: 28 },
  renameHintBox:    { backgroundColor: '#FFF3CD', padding: 8, borderRadius: 8,
                      marginBottom: 12, alignItems: 'center' },
  renameHintText:   { fontSize: 12, color: '#856404', fontWeight: '500' },
  legendRow:        { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  legendBadge:      { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  legendText:       { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  utteranceBox:     { borderRadius: 10, padding: 14, marginBottom: 12 },
  speakerRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  speakerBadge:     { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12 },
  speakerBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: 'bold' },
  utteranceTime:    { fontSize: 11, color: '#666' },
  utteranceText:    { fontSize: 15, color: '#333', lineHeight: 26 },
  utteranceOriginal:{ fontSize: 12, color: '#888', lineHeight: 20, marginTop: 6, fontStyle: 'italic' },

  modalOverlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox:         { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20,
                      borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modalHeader:      { flexDirection: 'row', justifyContent: 'space-between',
                      alignItems: 'center', marginBottom: 16 },
  modalTitle:       { fontSize: 18, fontWeight: 'bold', color: '#0D3B7A' },
  modalCloseX:      { fontSize: 22, color: '#888', padding: 4 },
  modalSubtitle:    { fontSize: 13, color: '#666', marginBottom: 16 },
  folderOption:     { flexDirection: 'row', alignItems: 'center', padding: 14,
                      borderRadius: 12, marginBottom: 8, backgroundColor: '#F5F7FA', gap: 12 },
  folderOptionActive:{ backgroundColor: '#E8F0FC', borderWidth: 2, borderColor: '#1A56A0' },
  folderOptionIcon: { fontSize: 20 },
  folderOptionText: { flex: 1, fontSize: 15, color: '#333', fontWeight: '500' },
  folderOptionTextActive: { color: '#1A56A0', fontWeight: '700' },
  folderOptionCheck:{ fontSize: 18, color: '#1A56A0', fontWeight: 'bold' },
  modalCurrentRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  modalCurrentLabel:{ fontSize: 13, color: '#666' },
  modalCurrentBadge:{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  modalCurrentBadgeText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 13 },
  modalInputLabel:  { fontSize: 13, color: '#333', fontWeight: '600', marginBottom: 8 },
  modalInput:       { backgroundColor: '#F5F7FA', borderWidth: 2, borderColor: '#1A56A0',
                      borderRadius: 12, padding: 14, fontSize: 18, color: '#333',
                      marginBottom: 10, fontWeight: '500' },
  modalHint:        { fontSize: 11, color: '#888', marginBottom: 20, fontStyle: 'italic' },
  modalButtons:     { flexDirection: 'row', gap: 12 },
  modalCancelBtn:   { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1.5,
                      borderColor: '#DDD', alignItems: 'center' },
  modalCancelText:  { fontSize: 15, color: '#666', fontWeight: '600' },
  modalSaveBtn:     { flex: 2, padding: 14, borderRadius: 12,
                      backgroundColor: '#1A56A0', alignItems: 'center' },
  modalSaveText:    { fontSize: 15, color: '#FFFFFF', fontWeight: 'bold' },

  chatOverlay:      { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: '#FFFFFF', zIndex: 999, elevation: 20 },
  chatHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                      backgroundColor: '#6C3FA0', paddingTop: 50, paddingBottom: 14, paddingHorizontal: 16 },
  chatBackBtn:      { paddingVertical: 6, paddingRight: 12 },
  chatBackText:     { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  chatHeaderTitle:  { color: '#FFFFFF', fontSize: 17, fontWeight: 'bold' },
  chatContext:      { backgroundColor: '#F0E8FF', paddingHorizontal: 16, paddingVertical: 8,
                      borderBottomWidth: 1, borderBottomColor: '#E0D0FF' },
  chatContextText:  { fontSize: 12, color: '#6C3FA0', fontWeight: '600' },
  suggestionsContainer: { padding: 16, backgroundColor: '#FAF7FF',
                          borderBottomWidth: 1, borderBottomColor: '#EEE' },
  suggestionsTitle: { fontSize: 12, color: '#888', marginBottom: 10, fontWeight: '600',
                      textTransform: 'uppercase', letterSpacing: 0.5 },
  suggestionsGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  suggestionChip:   { backgroundColor: '#EDE0FF', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  suggestionText:   { fontSize: 12, color: '#6C3FA0', fontWeight: '500' },
  chatMessages:     { flex: 1, backgroundColor: '#FAF7FF' },
  chatMessagesContent: { padding: 16, paddingBottom: 8 },
  chatBubble:       { maxWidth: '85%', padding: 12, borderRadius: 16, marginBottom: 12 },
  userBubble:       { backgroundColor: '#6C3FA0', alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  aiBubble:         { backgroundColor: '#FFFFFF', alignSelf: 'flex-start', borderBottomLeftRadius: 4,
                      elevation: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4 },
  aiLabel:          { fontSize: 10, color: '#6C3FA0', fontWeight: '700', marginBottom: 4 },
  chatBubbleText:   { fontSize: 14, lineHeight: 22 },
  userBubbleText:   { color: '#FFFFFF' },
  aiBubbleText:     { color: '#333333' },
  typingIndicator:  { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  typingText:       { fontSize: 13, color: '#888', fontStyle: 'italic' },
  chatInputWrapper: { backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#EEE' },
  chatInputRow:     { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 10,
                      paddingBottom: 8, gap: 8, alignItems: 'flex-end' },
  chatInput:        { flex: 1, backgroundColor: '#F5F0FF', borderRadius: 20,
                      paddingHorizontal: 16, paddingVertical: 10,
                      fontSize: 14, color: '#333', maxHeight: 100, minHeight: 44 },
  sendBtn:          { width: 44, height: 44, borderRadius: 22, backgroundColor: '#6C3FA0',
                      justifyContent: 'center', alignItems: 'center', marginBottom: 2 },
  sendBtnDisabled:  { backgroundColor: '#CCC' },
  sendBtnText:      { color: '#FFFFFF', fontSize: 18 },
  navBarSpacer:     { height: 20, backgroundColor: '#FFFFFF' },
});