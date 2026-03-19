import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator, Alert
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { transcribeAudio } from '../services/api';
import { saveTranscript, createTranscriptObj } from '../utils/storage';

export default function UploadScreen({ navigation }) {
  const [file,   setFile]   = useState(null);
  const [status, setStatus] = useState('idle');

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
    try {
      const result = await transcribeAudio(file.uri, file.name, file.mimeType || 'audio/m4a');
      if (result.success) {
        const obj = createTranscriptObj(file.name, result.transcript, result.duration, file.uri);
        await saveTranscript(obj);
        setStatus('done');
        navigation.replace('Transcript', { transcript: obj });
      }
    } catch (err) {
      setStatus('error');
      Alert.alert('Error', err.message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Upload Audio File</Text>
      <Text style={styles.subtitle}>Supports MP3, WAV, M4A up to 25MB</Text>
      <TouchableOpacity style={styles.pickBtn} onPress={pickFile}>
        <Text style={styles.pickBtnText}>
          {file ? file.name : 'Choose Audio File'}
        </Text>
      </TouchableOpacity>
      {file && (
        status === 'loading'
          ? <ActivityIndicator size="large" color="#1A56A0" style={{ marginTop: 30 }} />
          : <TouchableOpacity style={styles.transcribeBtn} onPress={handleTranscribe}>
              <Text style={styles.transcribeBtnText}>Transcribe with AI</Text>
            </TouchableOpacity>
      )}
      {status === 'error' && (
        <TouchableOpacity style={styles.retryBtn} onPress={() => setStatus('idle')}>
          <Text style={styles.retryText}>Try Again</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: '#F5F7FA', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title:             { fontSize: 22, fontWeight: 'bold', color: '#0D3B7A', marginBottom: 8 },
  subtitle:          { fontSize: 14, color: '#888', marginBottom: 32 },
  pickBtn:           { width: '100%', padding: 20, backgroundColor: '#fff', borderRadius: 12,
                       borderWidth: 2, borderColor: '#1A56A0', borderStyle: 'dashed', alignItems: 'center' },
  pickBtnText:       { color: '#1A56A0', fontSize: 15, fontWeight: '600' },
  transcribeBtn:     { marginTop: 24, width: '100%', padding: 18, backgroundColor: '#1A56A0',
                       borderRadius: 12, alignItems: 'center' },
  transcribeBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  retryBtn:          { marginTop: 16, padding: 12 },
  retryText:         { color: '#B22222', fontSize: 14 },
});