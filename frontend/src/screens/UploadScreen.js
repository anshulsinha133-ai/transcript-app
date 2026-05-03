import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator, Alert, Modal
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { transcribeWithSpeakers } from '../services/api';
import { saveTranscript, createTranscriptObj } from '../utils/storage';

// ─── Recording Templates ───────────────────────────────────────────── ✅ NEW
const TEMPLATES = [
  {
    id:    'meeting',
    icon:  '👥',
    label: 'Meeting',
    color: '#1A56A0',
    bg:    '#E8F0FC',
    hint:  'Decisions, action items, owners',
  },
  {
    id:    'sales',
    icon:  '💰',
    label: 'Sales Call',
    color: '#C85A00',
    bg:    '#FEF3E8',
    hint:  'Pain points, next steps, deal stage',
  },
  {
    id:    'lecture',
    icon:  '🎓',
    label: 'Lecture',
    color: '#1A7A4A',
    bg:    '#E8F5EE',
    hint:  'Key concepts, topics to review',
  },
  {
    id:    'interview',
    icon:  '🧑‍💼',
    label: 'Interview',
    color: '#8B1AAF',
    bg:    '#F3E8FE',
    hint:  'Strengths, responses, red flags',
  },
];
// ──────────────────────────────────────────────────────────────────────

export default function UploadScreen({ navigation }) {
  const [file,              setFile]              = useState(null);
  const [status,            setStatus]            = useState('idle');
  const [statusText,        setStatusText]        = useState('');
  const [selectedTemplate,  setSelectedTemplate]  = useState(null); // ✅ NEW
  const [showTemplates,     setShowTemplates]     = useState(false); // ✅ NEW

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['audio/mpeg','audio/wav','audio/m4a','audio/mp4','audio/*'],
      copyToCacheDirectory: true,
    });
    if (!result.canceled) setFile(result.assets[0]);
  };

  // ─── Show template picker before transcribing ─────────────── ✅ NEW
  const handleTranscribePress = () => {
    if (!file) return Alert.alert('No file selected', 'Please pick an audio file first');
    setShowTemplates(true);
  };

  const selectTemplateAndTranscribe = (template) => {
    setSelectedTemplate(template);
    setShowTemplates(false);
    handleTranscribe(template);
  };
  // ──────────────────────────────────────────────────────────────

  const handleTranscribe = async (template) => {
    if (!file) return;
    setStatus('loading');
    setStatusText('Uploading audio...');

    try {
      const result = await transcribeWithSpeakers(
        file.uri,
        (message, percent) => {
          setStatusText(message + ' ' + percent + '%');
        }
      );

      if (result.success) {
        const title = result.smartTitle || file.name;

        const text = result.englishText ||
          result.text ||
          result.utterances?.map(u => u.englishText || u.text).join(' ') ||
          'Transcript saved';

        const obj = {
          ...createTranscriptObj(title, text, result.duration || 0),
          utterances:    result.utterances   || [],
          words:         result.words        || [],
          audioPath:     file.uri,
          originalText:  result.text,
          englishText:   result.englishText  || null,
          autoSummary:   result.autoSummary  || null,
          actionItems:   result.actionItems  || [],
          detectedLang:  result.detectedLang || 'en',
          mode:          template?.id || (result.detectedLang !== 'en' ? 'auto' : 'en'), // ✅ NEW
          templateLabel: template?.label || null, // ✅ NEW
        };

        setStatusText('Saving transcript...');

        const saved = await saveTranscript(obj);

        if (saved && saved.success) {
          obj.id = saved.id;
          console.log('Transcript saved with real UUID:', obj.id);
          setStatus('done');
          navigation.replace('Transcript', { transcript: obj });
        } else {
          setStatus('error');
          setStatusText('Error saving transcript. Please try again.');
        }

      } else {
        setStatus('error');
        setStatusText('Error: ' + (result.error || 'Unknown error'));
      }

    } catch (err) {
      setStatus('error');
      setStatusText('');
      Alert.alert('Error', err.message);
    }
  };

  // ─── Template Picker Modal ─────────────────────────────────── ✅ NEW
  const renderTemplateModal = () => (
    <Modal
      visible={showTemplates}
      transparent
      animationType="slide"
      onRequestClose={() => setShowTemplates(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalBox}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>🤖 Choose Recording Type</Text>
            <TouchableOpacity onPress={() => setShowTemplates(false)}>
              <Text style={styles.modalCloseX}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.modalSubtitle}>
            This helps AI generate a smarter summary for you
          </Text>
          {TEMPLATES.map(t => (
            <TouchableOpacity
              key={t.id}
              style={[styles.templateOption, { backgroundColor: t.bg, borderColor: t.color }]}
              onPress={() => selectTemplateAndTranscribe(t)}
              activeOpacity={0.75}>
              <Text style={styles.templateIcon}>{t.icon}</Text>
              <View style={styles.templateTextWrap}>
                <Text style={[styles.templateLabel, { color: t.color }]}>{t.label}</Text>
                <Text style={styles.templateHint}>{t.hint}</Text>
              </View>
              <Text style={[styles.templateArrow, { color: t.color }]}>›</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </Modal>
  );
  // ──────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      {renderTemplateModal()}

      <Text style={styles.title}>Upload Audio File</Text>
      <Text style={styles.subtitle}>Supports MP3, WAV, M4A · Up to 500MB · 1 hour+</Text>

      <TouchableOpacity style={styles.pickBtn} onPress={pickFile}>
        <Text style={styles.pickIcon}>📁</Text>
        <Text style={styles.pickBtnText}>
          {file ? file.name : 'Choose Audio File'}
        </Text>
      </TouchableOpacity>

      {file && (
        status === 'loading' ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#1A56A0" />
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.transcribeBtn} onPress={handleTranscribePress}>
            <Text style={styles.transcribeBtnText}>🤖 Transcribe with AI</Text>
          </TouchableOpacity>
        )
      )}

      {status === 'error' && (
        <TouchableOpacity style={styles.retryBtn} onPress={() => setStatus('idle')}>
          <Text style={styles.retryText}>↩ Try Again</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: '#F5F7FA', alignItems: 'center',
                       justifyContent: 'center', padding: 24 },
  title:             { fontSize: 22, fontWeight: 'bold', color: '#0D3B7A', marginBottom: 8 },
  subtitle:          { fontSize: 14, color: '#888', marginBottom: 32 },
  pickBtn:           { width: '100%', padding: 20, backgroundColor: '#fff', borderRadius: 12,
                       borderWidth: 2, borderColor: '#1A56A0', borderStyle: 'dashed',
                       alignItems: 'center' },
  pickIcon:          { fontSize: 32, marginBottom: 8 },
  pickBtnText:       { color: '#1A56A0', fontSize: 15, fontWeight: '600' },
  loadingBox:        { marginTop: 32, alignItems: 'center', gap: 12 },
  statusText:        { fontSize: 14, color: '#666', textAlign: 'center' },
  transcribeBtn:     { marginTop: 24, width: '100%', padding: 18, backgroundColor: '#1A56A0',
                       borderRadius: 12, alignItems: 'center' },
  transcribeBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  retryBtn:          { marginTop: 16, padding: 12 },
  retryText:         { color: '#B22222', fontSize: 14 },

  // ✅ Template modal
  modalOverlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox:        { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24,
                     borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalHeader:     { flexDirection: 'row', justifyContent: 'space-between',
                     alignItems: 'center', marginBottom: 6 },
  modalTitle:      { fontSize: 18, fontWeight: 'bold', color: '#0D3B7A' },
  modalCloseX:     { fontSize: 22, color: '#888', padding: 4 },
  modalSubtitle:   { fontSize: 13, color: '#888', marginBottom: 20 },
  templateOption:  { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5,
                     borderRadius: 14, padding: 14, marginBottom: 10, gap: 12 },
  templateIcon:    { fontSize: 26 },
  templateTextWrap:{ flex: 1 },
  templateLabel:   { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  templateHint:    { fontSize: 12, color: '#888' },
  templateArrow:   { fontSize: 24, fontWeight: 'bold' },
});