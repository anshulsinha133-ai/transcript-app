import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator, Alert
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { transcribeWithSpeakers } from '../services/api';
import { saveTranscript, createTranscriptObj } from '../utils/storage';

export default function UploadScreen({ navigation }) {
  const [file,       setFile]       = useState(null);
  const [status,     setStatus]     = useState('idle');
  const [statusText, setStatusText] = useState('');

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['audio/mpeg','audio/wav','audio/m4a','audio/mp4','audio/*'],
      copyToCacheDirectory: true,
    });
    if (!result.canceled) setFile(result.assets[0]);
  };

  const handleTranscribe = async () => {
    if (!file) return Alert.alert('No file selected', 'Please pick an audio file first');
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
        // ✅ SMART TITLE — use AI title or fallback to file name
        const title = result.smartTitle || file.name;

        const text = result.englishText ||
          result.text ||
          result.utterances?.map(u => u.englishText || u.text).join(' ') ||
          'Transcript saved';

        const obj = {
          ...createTranscriptObj(title, text, result.duration || 0),
          utterances:   result.utterances   || [],
          words:        result.words        || [],
          audioPath:    file.uri,
          originalText: result.text,
          englishText:  result.englishText  || null,
          autoSummary:  result.autoSummary  || null,
          actionItems:  result.actionItems  || [],
          detectedLang: result.detectedLang || 'en',
          mode:         result.detectedLang !== 'en' ? 'auto' : 'en',
        };

        setStatusText('Saving transcript...');

        // ✅ saveTranscript returns real Supabase UUID
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

  return (
    <SafeAreaView style={styles.container}>
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
          <TouchableOpacity style={styles.transcribeBtn} onPress={handleTranscribe}>
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
});