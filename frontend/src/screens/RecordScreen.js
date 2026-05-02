import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, Alert, ActivityIndicator
} from 'react-native';
import { Audio } from 'expo-av';
import { transcribeWithSpeakers } from '../services/api';
import { saveTranscript, createTranscriptObj } from '../utils/storage';

export default function RecordScreen({ navigation }) {
  const [isRecording,   setIsRecording]   = useState(false);
  const [statusText,    setStatusText]    = useState('Tap to start recording');
  const [recordingTime, setRecordingTime] = useState(0);
  const [isProcessing,  setIsProcessing]  = useState(false);

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

      const { recording } = await Audio.Recording.createAsync({
        android: {
          extension:        '.m4a',
          outputFormat:     Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder:     Audio.AndroidAudioEncoder.AAC,
          sampleRate:       44100,
          numberOfChannels: 1,
          bitRate:          192000,
        },
        ios: {
          extension:            '.m4a',
          outputFormat:         Audio.IOSOutputFormat.MPEG4AAC,
          audioQuality:         Audio.IOSAudioQuality.MAX,
          sampleRate:           44100,
          numberOfChannels:     1,
          bitRate:              192000,
          linearPCMBitDepth:    16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat:     false,
        },
        web: {},
      });

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
      setStatusText('Processing your recording...');
      setIsProcessing(true);

      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (uri) {
        const result = await transcribeWithSpeakers(
          uri,
          (message, percent) => {
            setStatusText(message + ' ' + percent + '%');
          }
        );

        if (result.success) {
          const text = result.englishText ||
            result.text ||
            result.utterances?.map(u => u.englishText || u.text).join(' ') ||
            'Recording saved';

          // ✅ SMART TITLE — use AI title or fallback to date
          const title = result.smartTitle ||
            'Recording ' + new Date().toLocaleDateString('en-IN');

          // ✅ Build transcript object — id starts as null
          const obj = {
            ...createTranscriptObj(title, text, recordingTime),
            utterances:   result.utterances   || [],
            words:        result.words        || [],
            audioPath:    null,
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
            setStatusText('Transcript saved! ✅');
            setTimeout(() => navigation.navigate('Home'), 2000);
          } else {
            setStatusText('Error saving transcript. Please try again.');
          }

        } else if (result.canResume) {
  // ✅ Network dropped but job is safe — show resume option
  setStatusText('Network lost — recording safe ✅');
  Alert.alert(
    '📡 Network Lost',
    'Your recording was uploaded and is being processed.\n\nGo back to Home — you will see a "Resume" button to fetch your transcript when connection is restored.',
    [{ text: 'Go to Home', onPress: () => navigation.navigate('Home') }]
  );
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
              Speak in English, Hindi or Marathi{'\n'}
              VoxNote auto detects your language
            </Text>
          </>
        ) : isProcessing ? (
          <>
            <Text style={styles.infoIcon}>⚙️</Text>
            <Text style={styles.infoText}>Processing your recording...</Text>
            <Text style={styles.infoSubText}>
              Detecting speakers + translating to English{'\n'}
              This may take 30-60 seconds
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.infoIcon}>🎙</Text>
            <Text style={styles.infoText}>Ready to record</Text>
            <Text style={styles.infoSubText}>
              ✨ Supports English, Hindi & Marathi{'\n'}
              ✨ Auto speaker detection{'\n'}
              ✨ Translates to English automatically{'\n'}
              ✨ AI summary + action items included
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
  container:       { flex: 1, backgroundColor: '#F5F7FA', padding: 20 },
  timer:           { fontSize: 64, fontWeight: 'bold', color: '#0D3B7A',
                     textAlign: 'center', marginTop: 20, marginBottom: 10 },
  statusRow:       { flexDirection: 'row', alignItems: 'center',
                     justifyContent: 'center', gap: 8, marginBottom: 16 },
  statusText:      { fontSize: 14, color: '#666', textAlign: 'center' },
  infoBox:         { flex: 1, justifyContent: 'center', alignItems: 'center',
                     marginBottom: 20, backgroundColor: '#FFFFFF',
                     borderRadius: 16, padding: 24,
                     borderWidth: 1, borderColor: '#DCE9F8' },
  infoIcon:        { fontSize: 48, marginBottom: 16 },
  infoText:        { fontSize: 18, fontWeight: '600', color: '#0D3B7A',
                     marginBottom: 12, textAlign: 'center' },
  infoSubText:     { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 26 },
  recordBtn:       { backgroundColor: '#1A56A0', padding: 20,
                     borderRadius: 16, alignItems: 'center' },
  recordBtnActive: { backgroundColor: '#C0392B' },
  recordBtnText:   { color: '#FFFFFF', fontSize: 20, fontWeight: 'bold' },
});