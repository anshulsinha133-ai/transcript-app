import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, Alert, ActivityIndicator, ScrollView
} from 'react-native';
import { Audio } from 'expo-av';
import { transcribeWithSpeakers } from '../services/api';
import { saveTranscript, createTranscriptObj } from '../utils/storage';

const MODES = [
  {
    id:       'en',
    label:    '🇬🇧 English',
    language: 'en',
    desc:     'English only'
  },
  {
    id:       'hi',
    label:    '🇮🇳 Hindi',
    language: 'hi',
    desc:     'Hindi → English'
  },
  {
    id:       'mumbai',
    label:    '🏙️ Mumbai',
    language: 'en',
    desc:     'Hindi + Marathi + English'
  },
  {
    id:       'delhi',
    label:    '🏛️ Delhi',
    language: 'en',
    desc:     'Hindi + Punjabi + English'
  },
];

export default function RecordScreen({ navigation }) {
  const [isRecording,  setIsRecording]  = useState(false);
  const [statusText,   setStatusText]   = useState('Tap to start recording');
  const [recordingTime,setRecordingTime]= useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [mode,         setMode]         = useState('en');

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

  const selectedMode = MODES.find(m => m.id === mode) || MODES[0];

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
          selectedMode.language,
          mode,
          (message, percent) => {
            setStatusText(message + ' ' + percent + '%');
          }
        );

        if (result.success) {
          const text = result.englishText ||
            result.text ||
            result.utterances?.map(u => u.englishText || u.text).join(' ') ||
            'Recording saved';

          const title = 'Recording ' + new Date().toLocaleDateString('en-IN');
          const obj   = {
            ...createTranscriptObj(title, text, recordingTime),
            utterances:  result.utterances,
            words:       result.words,
            audioPath:   null,
            originalText: result.text,
            englishText:  result.englishText,
            autoSummary:  result.autoSummary,
            mode:         mode,
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

      {/* Mode Selector */}
      <Text style={styles.sectionLabel}>Select Language Mode</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.modeScroll}
        contentContainerStyle={styles.modeRow}>
        {MODES.map(m => (
          <TouchableOpacity
            key={m.id}
            style={[styles.modeBtn, mode === m.id && styles.modeBtnActive]}
            onPress={() => !isRecording && setMode(m.id)}>
            <Text style={[styles.modeBtnLabel,
              mode === m.id && styles.modeBtnLabelActive]}>
              {m.label}
            </Text>
            <Text style={[styles.modeBtnDesc,
              mode === m.id && styles.modeBtnDescActive]}>
              {m.desc}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Timer */}
      <Text style={styles.timer}>{formatTime(recordingTime)}</Text>

      {/* Status */}
      <View style={styles.statusRow}>
        {isProcessing && <ActivityIndicator color="#1A56A0" size="small" />}
        <Text style={styles.statusText}>{statusText}</Text>
      </View>

      {/* Info Box */}
      <View style={styles.infoBox}>
        {isRecording ? (
          <>
            <Text style={styles.infoIcon}>🎙</Text>
            <Text style={styles.infoText}>Recording in progress...</Text>
            <Text style={styles.infoSubText}>
              Speaking in {selectedMode.desc}
            </Text>
          </>
        ) : isProcessing ? (
          <>
            <Text style={styles.infoIcon}>⚙️</Text>
            <Text style={styles.infoText}>Processing your recording...</Text>
            <Text style={styles.infoSubText}>
              Detecting speakers + translating to English
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.infoIcon}>🎙</Text>
            <Text style={styles.infoText}>Ready to record</Text>
            <Text style={styles.infoSubText}>
              Mode: {selectedMode.label}{'\n'}
              {mode === 'mumbai' || mode === 'delhi'
                ? '✨ Mixed language will be translated to English'
                : mode === 'hi'
                ? '✨ Hindi will be translated to English'
                : '✨ English transcription with speaker detection'}
            </Text>
          </>
        )}
      </View>

      {/* Record Button */}
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
  container:          { flex: 1, backgroundColor: '#F5F7FA', padding: 20 },
  sectionLabel:       { fontSize: 13, fontWeight: '600', color: '#666',
                        marginBottom: 10, marginTop: 4 },
  modeScroll:         { maxHeight: 90, marginBottom: 20 },
  modeRow:            { gap: 10, paddingRight: 10 },
  modeBtn:            { borderWidth: 1.5, borderColor: '#1A56A0',
                        borderRadius: 12, paddingHorizontal: 14,
                        paddingVertical: 8, minWidth: 110,
                        alignItems: 'center' },
  modeBtnActive:      { backgroundColor: '#1A56A0' },
  modeBtnLabel:       { fontSize: 14, fontWeight: '700',
                        color: '#1A56A0', marginBottom: 2 },
  modeBtnLabelActive: { color: '#FFFFFF' },
  modeBtnDesc:        { fontSize: 10, color: '#888', textAlign: 'center' },
  modeBtnDescActive:  { color: '#CCE0FF' },
  timer:              { fontSize: 52, fontWeight: 'bold', color: '#0D3B7A',
                        textAlign: 'center', marginBottom: 10 },
  statusRow:          { flexDirection: 'row', alignItems: 'center',
                        justifyContent: 'center', gap: 8, marginBottom: 16 },
  statusText:         { fontSize: 14, color: '#666', textAlign: 'center' },
  infoBox:            { flex: 1, justifyContent: 'center',
                        alignItems: 'center', marginBottom: 20,
                        backgroundColor: '#FFFFFF', borderRadius: 16,
                        padding: 24, borderWidth: 1, borderColor: '#DCE9F8' },
  infoIcon:           { fontSize: 40, marginBottom: 12 },
  infoText:           { fontSize: 16, fontWeight: '600', color: '#0D3B7A',
                        marginBottom: 8, textAlign: 'center' },
  infoSubText:        { fontSize: 13, color: '#888', textAlign: 'center',
                        lineHeight: 22 },
  recordBtn:          { backgroundColor: '#1A56A0', padding: 18,
                        borderRadius: 14, alignItems: 'center' },
  recordBtnActive:    { backgroundColor: '#C0392B' },
  recordBtnText:      { color: '#FFFFFF', fontSize: 18, fontWeight: 'bold' },
});