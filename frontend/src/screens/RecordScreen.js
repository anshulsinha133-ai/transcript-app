import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, Alert, ActivityIndicator, Modal, ScrollView
} from 'react-native';
import { useRecording } from '../context/RecordingContext';
import { transcribeWithSpeakers } from '../services/api';
import { saveTranscript, createTranscriptObj } from '../utils/storage';

// ─── All 7 recording templates ────────────────────────────────────────────────
const TEMPLATES = [
  { id:'meeting',   icon:'🤝', label:'Meeting Notes',   color:'#1A56A0', bg:'#E8F0FC', hint:'Decisions, action items, owners' },
  { id:'sales',     icon:'📞', label:'Sales Call',      color:'#059669', bg:'#ECFDF5', hint:'Lead, requirements, objections, next steps' },
  { id:'doctor',    icon:'🏥', label:'Doctor Notes',    color:'#DC2626', bg:'#FEF2F2', hint:'Complaint, diagnosis, prescription, follow-up' },
  { id:'lecture',   icon:'🎓', label:'Lecture Notes',   color:'#7C3AED', bg:'#F5F3FF', hint:'Key concepts, definitions, study questions' },
  { id:'interview', icon:'👤', label:'Interview Notes', color:'#0369A1', bg:'#F0F9FF', hint:'Candidate, answers, evaluation, decision' },
  { id:'legal',     icon:'⚖️', label:'Legal Notes',     color:'#92400E', bg:'#FFFBEB', hint:'Client, case summary, actions, hearing date' },
  { id:'other',     icon:'📝', label:'Other',           color:'#374151', bg:'#F9FAFB', hint:'General recording — auto summary' },
];

export default function RecordScreen({ navigation }) {
  // ✅ ALL recording state from context — background-safe, no duplicate audio session
  const {
    isRecording,
    isProcessing,
    recordingTime,
    statusText,
    setStatusText,
    setIsProcessing,
    startRecording,
    stopRecording,
    resetRecording,
    formatTime,
  } = useRecording();

  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [showTemplates,    setShowTemplates]    = useState(false);

  const handleRecordPress = () => {
    if (isRecording) handleStop();
    else setShowTemplates(true);
  };

  const selectTemplateAndRecord = async (template) => {
    setSelectedTemplate(template);
    setShowTemplates(false);
    const started = await startRecording();
    if (!started) setSelectedTemplate(null);
  };

  const handleStop = async () => {
    try {
      const uri = await stopRecording();
      if (!uri) return;

      const result = await transcribeWithSpeakers(uri, (message, percent) => {
        setStatusText(percent ? `${message} ${percent}%` : message);
      });

      if (result.success) {
        const text  = result.englishText ||
                      result.text ||
                      result.utterances?.map(u => u.englishText || u.text).join(' ') ||
                      'Recording saved';
        const title = result.smartTitle ||
                      'Recording ' + new Date().toLocaleDateString('en-IN');

        const obj = {
          ...createTranscriptObj(title, text, recordingTime),
          utterances:    result.utterances   || [],
          words:         result.words        || [],
          audioPath:     null,
          originalText:  result.text,
          englishText:   result.englishText  || null,
          autoSummary:   result.autoSummary  || null,
          actionItems:   result.actionItems  || [],
          detectedLang:  result.detectedLang || 'en',
          mode:          selectedTemplate?.id || (result.detectedLang !== 'en' ? 'auto' : 'en'),
          templateLabel: selectedTemplate?.label || null,
        };

        setStatusText('Saving transcript...');
        const saved = await saveTranscript(obj);

        if (saved?.success) {
          obj.id = saved.id;
          setStatusText('Transcript saved! ✅');
          resetRecording();
          setSelectedTemplate(null);
          setTimeout(() => navigation.navigate('Home'), 1500);
        } else {
          setStatusText('Error saving. Please try again.');
          setIsProcessing(false);
        }

      } else if (result.canResume) {
        setStatusText('Network lost — recording safe ✅');
        resetRecording();
        Alert.alert(
          '📡 Network Lost',
          'Your recording was uploaded and is being processed.\n\nGo to Home — tap the Resume banner to fetch your transcript.',
          [{ text: 'Go to Home', onPress: () => navigation.navigate('Home') }]
        );
      } else {
        setStatusText('Error: ' + (result.error || 'Unknown error'));
        setIsProcessing(false);
      }
    } catch (err) {
      Alert.alert('Error', 'Could not process recording: ' + err.message);
      setStatusText('Choose a type to begin');
      setIsProcessing(false);
    }
  };

  const renderTemplateModal = () => (
    <Modal visible={showTemplates} transparent animationType="slide"
      onRequestClose={() => setShowTemplates(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalBox}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>🎙 What are you recording?</Text>
            <TouchableOpacity onPress={() => setShowTemplates(false)}>
              <Text style={styles.modalCloseX}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.modalSubtitle}>Helps AI generate a smarter, structured summary</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {TEMPLATES.map(t => (
              <TouchableOpacity key={t.id}
                style={[styles.templateOption, { backgroundColor: t.bg, borderColor: t.color }]}
                onPress={() => selectTemplateAndRecord(t)} activeOpacity={0.75}>
                <Text style={styles.templateIcon}>{t.icon}</Text>
                <View style={styles.templateTextWrap}>
                  <Text style={[styles.templateLabel, { color: t.color }]}>{t.label}</Text>
                  <Text style={styles.templateHint}>{t.hint}</Text>
                </View>
                <Text style={[styles.templateArrow, { color: t.color }]}>›</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  const activeTemplate = TEMPLATES.find(t => t.id === selectedTemplate?.id);

  return (
    <SafeAreaView style={styles.container}>
      {renderTemplateModal()}

      <Text style={styles.timer}>{formatTime(recordingTime)}</Text>

      <View style={styles.statusRow}>
        {isProcessing && <ActivityIndicator color="#1A56A0" size="small" />}
        <Text style={styles.statusText}>{statusText}</Text>
      </View>

      {selectedTemplate && !isProcessing && (
        <TouchableOpacity
          style={[styles.templateBadge, { backgroundColor: activeTemplate?.bg, borderColor: activeTemplate?.color }]}
          onPress={() => !isRecording && setShowTemplates(true)}
          disabled={isRecording}>
          <Text style={styles.templateBadgeIcon}>{activeTemplate?.icon}</Text>
          <Text style={[styles.templateBadgeLabel, { color: activeTemplate?.color }]}>{activeTemplate?.label}</Text>
          {!isRecording && <Text style={[styles.templateBadgeChange, { color: activeTemplate?.color }]}>Change →</Text>}
        </TouchableOpacity>
      )}

      <View style={styles.infoBox}>
        {isRecording ? (
          <>
            <Text style={styles.infoIcon}>{activeTemplate?.icon || '🎙'}</Text>
            <Text style={styles.infoText}>Recording in progress...</Text>
            <Text style={styles.infoSubText}>
              🔴 Screen can be locked safely{'\n'}
              Speak in any Indian language or English{'\n'}
              VoxNote auto-detects your language
            </Text>
          </>
        ) : isProcessing ? (
          <>
            <Text style={styles.infoIcon}>⚙️</Text>
            <Text style={styles.infoText}>Processing your recording...</Text>
            <Text style={styles.infoSubText}>
              Detecting speakers + translating{'\n'}
              This may take 30–60 seconds
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.infoIcon}>🎙</Text>
            <Text style={styles.infoText}>Ready to record</Text>
            <Text style={styles.infoSubText}>
              ✨ Hindi, Marathi, Telugu, Tamil & more{'\n'}
              ✨ English supported{'\n'}
              ✨ Auto speaker detection{'\n'}
              ✨ AI structured notes included
            </Text>
          </>
        )}
      </View>

      <TouchableOpacity
        style={[styles.recordBtn, isRecording && styles.recordBtnActive]}
        onPress={handleRecordPress}
        disabled={isProcessing}>
        <Text style={styles.recordBtnText}>
          {isRecording ? '⏹ Stop Recording' : '🎙 Start Recording'}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#F5F7FA', padding: 20 },
  timer:              { fontSize: 64, fontWeight: 'bold', color: '#0D3B7A',
                        textAlign: 'center', marginTop: 20, marginBottom: 10 },
  statusRow:          { flexDirection: 'row', alignItems: 'center',
                        justifyContent: 'center', gap: 8, marginBottom: 10 },
  statusText:         { fontSize: 14, color: '#666', textAlign: 'center' },
  templateBadge:      { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5,
                        borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
                        marginBottom: 12, gap: 6 },
  templateBadgeIcon:  { fontSize: 16 },
  templateBadgeLabel: { fontSize: 13, fontWeight: '700', flex: 1 },
  templateBadgeChange:{ fontSize: 12 },
  infoBox:            { flex: 1, justifyContent: 'center', alignItems: 'center',
                        marginBottom: 20, backgroundColor: '#FFFFFF', borderRadius: 16,
                        padding: 24, borderWidth: 1, borderColor: '#DCE9F8' },
  infoIcon:           { fontSize: 48, marginBottom: 16 },
  infoText:           { fontSize: 18, fontWeight: '600', color: '#0D3B7A',
                        marginBottom: 12, textAlign: 'center' },
  infoSubText:        { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 26 },
  recordBtn:          { backgroundColor: '#1A56A0', padding: 20, borderRadius: 16, alignItems: 'center' },
  recordBtnActive:    { backgroundColor: '#C0392B' },
  recordBtnText:      { color: '#FFFFFF', fontSize: 20, fontWeight: 'bold' },
  modalOverlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox:           { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24,
                        borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: '85%' },
  modalHeader:        { flexDirection: 'row', justifyContent: 'space-between',
                        alignItems: 'center', marginBottom: 6 },
  modalTitle:         { fontSize: 18, fontWeight: 'bold', color: '#0D3B7A' },
  modalCloseX:        { fontSize: 22, color: '#888', padding: 4 },
  modalSubtitle:      { fontSize: 13, color: '#888', marginBottom: 16 },
  templateOption:     { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5,
                        borderRadius: 14, padding: 14, marginBottom: 10, gap: 12 },
  templateIcon:       { fontSize: 24 },
  templateTextWrap:   { flex: 1 },
  templateLabel:      { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  templateHint:       { fontSize: 12, color: '#888' },
  templateArrow:      { fontSize: 24, fontWeight: 'bold' },
});