import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, Alert, ScrollView, ActivityIndicator
} from 'react-native';
import { Audio } from 'expo-av';
import { transcribeWithSpeakers } from '../services/api';
import { saveTranscript, createTranscriptObj } from '../utils/storage';

export default function RecordScreen({ navigation }) {
  const [isRecording,    setIsRecording]    = useState(false);
  const [statusText,     setStatusText]     = useState('Tap to start recording');
  const [recordingTime,  setRecordingTime]  = useState(0);
  const [isProcessing,   setIsProcessing]   = useState(false);
  const [language,       setLanguage]       = useState('en');

  const recordingRef   = useRef(null);
  const timerRef       = useRef(null);
  const isRecordingRef = useRef(false);

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync();
      }
    };
  }, []);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission needed', 'Please allow microphone access');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS:   true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current   = recording;
      isRecordingRef.current = true;
      setIsRecording(true);
      setRecordingTime(0);
      setStatusText('Recording... speak now');

      timerRef.current = setInterval(() => {
        setRecordingTime(t => t + 1);
      }, 1000);

    } catch (err) {
      Alert.alert('Error', 'Could not start recording: ' + err.message);
    }
  };

  const stopRecording = async () => {
    try {
      clearInterval(timerRef.current);
      isRecordingRef.current = false;
      setIsRecording(false);
      setStatusText('Processing with speaker detection...');
      setIsProcessing(true);

      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (uri) {
        const result = await transcribeWithSpeakers(
          uri,
          language,
          (message, percent) => {
            setStatusText(message + ' ' + percent + '%');
          }
        );

        if (result.success) {
          const text = result.text ||
            result.utterances?.map(u => u.text).join(' ') ||
            'Recording saved';

          const title = 'Recording ' + new Date().toLocaleDateString('en-IN');
          const obj   = {
            ...createTranscriptObj(title, text, recordingTime),
            utterances: result.utterances,
            words:      result.words,
            audioPath:  null,
          };
          await saveTranscript(obj);
          setStatusText('Transcript saved! ✅');
          setTimeout(() => navigation.navigate('Home'), 2000);
        } else {
          setStatusText('Error: ' + (result.error || 'Unknown error'));
        }
      }

    } catch (err) {
      Alert.alert('Error', 'Could not stop recording: ' + err.message);
      setStatusText('Tap to start recording');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>

      <View style={styles.langRow}>
        {['en', 'hi'].map(lang => (
          <TouchableOpacity
            key={lang}
            style={[styles.langBtn, language === lang && styles.langBtnActive]}
            onPress={() => !isRecording && setLanguage(lang)}>
            <Text style={[styles.langText, language === lang && styles.langTextActive]}>
              {lang === 'en' ? 'English' : 'हिंदी'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.timer}>{formatTime(recordingTime)}</Text>

      <View style={styles.statusRow}>
        {isProcessing && <ActivityIndicator color="#1A56A0" size="small" />}
        <Text style={styles.statusText}>{statusText}</Text>
      </View>

      <View style={styles.emptyBox}>
        <Text style={styles.emptyText}>
          {isRecording
            ? '🎙 Recording in progress...\nSpeak clearly for best results'
            : isProcessing
            ? '⏳ Processing your recording...\nThis may take 30-60 seconds'
            : '🎙 Tap Start Recording to begin\nSpeaker detection powered by AI'}
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.recordBtn, isRecording && styles.recordBtnActive]}
        onPress={isRecording ? stopRecording : startRecording}
        disabled={isProcessing}>
        <Text style={styles.recordBtnText}>
          {isRecording ? '⏹ Stop Recording' : '🎙 Start Recording'}
        </Text>
      </TouchableOpacity>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#F5F7FA', padding: 20 },
  langRow:        { flexDirection: 'row', justifyContent: 'center',
                    gap: 10, marginBottom: 20, marginTop: 10 },
  langBtn:        { paddingHorizontal: 20, paddingVertical: 8,
                    borderRadius: 20, borderWidth: 1.5,
                    borderColor: '#1A56A0' },
  langBtnActive:  { backgroundColor: '#1A56A0' },
  langText:       { color: '#1A56A0', fontSize: 14, fontWeight: '600' },
  langTextActive: { color: '#FFFFFF' },
  timer:          { fontSize: 52, fontWeight: 'bold', color: '#0D3B7A',
                    textAlign: 'center', marginBottom: 10 },
  statusRow:      { flexDirection: 'row', alignItems: 'center',
                    justifyContent: 'center', gap: 8, marginBottom: 8 },
  statusText:     { fontSize: 14, color: '#666', textAlign: 'center' },
  emptyBox:       { flex: 1, justifyContent: 'center',
                    alignItems: 'center', marginBottom: 20 },
  emptyText:      { fontSize: 15, color: '#aaa', textAlign: 'center',
                    paddingHorizontal: 40, lineHeight: 26 },
  recordBtn:      { backgroundColor: '#1A56A0', padding: 18,
                    borderRadius: 14, alignItems: 'center' },
  recordBtnActive:{ backgroundColor: '#C0392B' },
  recordBtnText:  { color: '#FFFFFF', fontSize: 18, fontWeight: 'bold' },
});