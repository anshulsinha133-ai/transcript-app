import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, Alert, ScrollView, ActivityIndicator
} from 'react-native';
import { Audio } from 'expo-av';
import { transcribeChunk, transcribeWithSpeakers } from '../services/api';
import { saveTranscript, createTranscriptObj } from '../utils/storage';

const CHUNK_INTERVAL = 30000;

export default function RecordScreen({ navigation }) {
  const [isRecording,    setIsRecording]    = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [statusText,     setStatusText]     = useState('Tap to start recording');
  const [recordingTime,  setRecordingTime]  = useState(0);
  const [isProcessing,   setIsProcessing]   = useState(false);
  const [language,       setLanguage]       = useState('auto');
  const [chunkCount,     setChunkCount]     = useState(0);

  const recordingRef   = useRef(null);
  const timerRef       = useRef(null);
  const chunkTimerRef  = useRef(null);
  const liveTextRef    = useRef('');
  const isRecordingRef = useRef(false);

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      clearInterval(chunkTimerRef.current);
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
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current   = recording;
      isRecordingRef.current = true;
      setIsRecording(true);
      setLiveTranscript('');
      setRecordingTime(0);
      liveTextRef.current = '';
      setChunkCount(0);
      setStatusText('Recording... speak now');

      timerRef.current = setInterval(() => {
        setRecordingTime(t => t + 1);
      }, 1000);

      chunkTimerRef.current = setInterval(async () => {
        if (isRecordingRef.current) {
          await processCurrentChunk();
        }
      }, CHUNK_INTERVAL);

    } catch (err) {
      Alert.alert('Error', 'Could not start recording: ' + err.message);
    }
  };

  const processCurrentChunk = async () => {
    if (!recordingRef.current || !isRecordingRef.current) return;

    try {
      setIsProcessing(true);
      setStatusText('Processing chunk...');

      await recordingRef.current.pauseAsync();
      const uri = recordingRef.current.getURI();

      if (uri) {
        setChunkCount(c => c + 1);
        const result = await transcribeChunk(
          uri,
          'chunk.m4a',
          'audio/m4a',
          language,
          liveTextRef.current
        );

        if (result.success && result.text) {
          const newText = liveTextRef.current
            ? liveTextRef.current + ' ' + result.text
            : result.text;
          liveTextRef.current = newText;
          setLiveTranscript(newText);
        }
      }

      if (isRecordingRef.current) {
        await recordingRef.current.resumeAsync();
        setStatusText('Recording... speak now');
      }

    } catch (err) {
      console.error('Chunk processing error:', err);
      if (isRecordingRef.current) {
        setStatusText('Recording... speak now');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const stopRecording = async () => {
    try {
      clearInterval(timerRef.current);
      clearInterval(chunkTimerRef.current);
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

        if (result.success && result.text) {
          const title = 'Recording ' + new Date().toLocaleDateString('en-IN');
          const obj   = {
            ...createTranscriptObj(title, result.text, recordingTime),
            utterances: result.utterances,
            words:      result.words,
            audioPath:  uri,
          };
          await saveTranscript(obj);
          setStatusText('Transcript saved! ✅');
          setLiveTranscript(result.text);
          setTimeout(() => navigation.navigate('Home'), 1500);
        } else {
          setStatusText('No speech detected. Try again.');
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
        {['auto', 'en', 'hi'].map(lang => (
          <TouchableOpacity
            key={lang}
            style={[styles.langBtn, language === lang && styles.langBtnActive]}
            onPress={() => !isRecording && setLanguage(lang)}>
            <Text style={[styles.langText, language === lang && styles.langTextActive]}>
              {lang === 'auto' ? 'Auto' : lang === 'en' ? 'English' : 'हिंदी'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.timer}>{formatTime(recordingTime)}</Text>

      <View style={styles.statusRow}>
        {isProcessing && <ActivityIndicator color="#1A56A0" size="small" />}
        <Text style={styles.statusText}>{statusText}</Text>
      </View>

      {chunkCount > 0 && (
        <Text style={styles.chunkText}>
          {chunkCount} chunk{chunkCount > 1 ? 's' : ''} processed ✅
        </Text>
      )}

      {liveTranscript ? (
        <ScrollView style={styles.liveBox}>
          <Text style={styles.liveLabel}>Live Transcript</Text>
          <Text style={styles.liveText}>{liveTranscript}</Text>
        </ScrollView>
      ) : (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            {isRecording
              ? 'Your transcript will appear here in 30 seconds...'
              : 'Start recording to see live transcript'}
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.recordBtn, isRecording && styles.recordBtnActive]}
        onPress={isRecording ? stopRecording : startRecording}
        disabled={isProcessing && !isRecording}>
        <Text style={styles.recordBtnText}>
          {isRecording ? '⏹ Stop Recording' : '🎙 Start Recording'}
        </Text>
      </TouchableOpacity>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#F5F7FA', padding: 20 },
  langRow:         { flexDirection: 'row', justifyContent: 'center',
                     gap: 10, marginBottom: 20, marginTop: 10 },
  langBtn:         { paddingHorizontal: 20, paddingVertical: 8,
                     borderRadius: 20, borderWidth: 1.5,
                     borderColor: '#1A56A0' },
  langBtnActive:   { backgroundColor: '#1A56A0' },
  langText:        { color: '#1A56A0', fontSize: 14, fontWeight: '600' },
  langTextActive:  { color: '#FFFFFF' },
  timer:           { fontSize: 52, fontWeight: 'bold', color: '#0D3B7A',
                     textAlign: 'center', marginBottom: 10 },
  statusRow:       { flexDirection: 'row', alignItems: 'center',
                     justifyContent: 'center', gap: 8, marginBottom: 8 },
  statusText:      { fontSize: 14, color: '#666', textAlign: 'center' },
  chunkText:       { fontSize: 12, color: '#1A7A4A', textAlign: 'center',
                     marginBottom: 12 },
  liveBox:         { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 12,
                     padding: 16, marginBottom: 20,
                     borderWidth: 1, borderColor: '#DCE9F8' },
  liveLabel:       { fontSize: 12, fontWeight: 'bold', color: '#1A56A0',
                     marginBottom: 8 },
  liveText:        { fontSize: 15, color: '#333', lineHeight: 26 },
  emptyBox:        { flex: 1, justifyContent: 'center',
                     alignItems: 'center', marginBottom: 20 },
  emptyText:       { fontSize: 14, color: '#aaa', textAlign: 'center',
                     paddingHorizontal: 40 },
  recordBtn:       { backgroundColor: '#1A56A0', padding: 18,
                     borderRadius: 14, alignItems: 'center' },
  recordBtnActive: { backgroundColor: '#C0392B' },
  recordBtnText:   { color: '#FFFFFF', fontSize: 18, fontWeight: 'bold' },
});