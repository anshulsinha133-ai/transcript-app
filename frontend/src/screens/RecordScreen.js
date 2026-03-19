import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator, Alert
} from 'react-native';
import { Audio } from 'expo-av';
import { transcribeAudio } from '../services/api';
import { saveTranscript, createTranscriptObj } from '../utils/storage';

export default function RecordScreen({ navigation }) {
  const [isRecording,    setIsRecording]    = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingTime,  setRecordingTime]  = useState(0);
  const [statusText,     setStatusText]     = useState('Tap to start recording');
  const recordingRef = useRef(null);
  const timerRef     = useRef(null);

  const requestPermissions = async () => {
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Microphone access is needed to record audio.');
      return false;
    }
    return true;
  };

  const startRecording = async () => {
    const allowed = await requestPermissions();
    if (!allowed) return;
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setIsRecording(true);
      setStatusText('Recording... Speak now');
      timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch (err) {
      Alert.alert('Error', 'Could not start recording: ' + err.message);
    }
  };

  const stopAndTranscribe = async () => {
    if (!recordingRef.current) return;
    clearInterval(timerRef.current);
    setIsRecording(false);
    setIsTranscribing(true);
    setStatusText('Transcribing with AI...');
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      const result = await transcribeAudio(uri, 'recording.m4a', 'audio/m4a');
      if (result.success) {
        const title = 'Recording ' + new Date().toLocaleDateString('en-IN');
        const obj   = createTranscriptObj(title, result.transcript, recordingTime, uri);
        const saved = await saveTranscript(obj);
        if (!saved) {
          Alert.alert('Warning', 'Transcript could not be saved to cloud');
        }
        setStatusText('Transcription complete!');
        navigation.replace('Transcript', { transcript: obj });
      }
    } catch (err) {
      setStatusText('Error: ' + err.message);
      setIsTranscribing(false);
      Alert.alert('Transcription Failed', err.message);
    }
  };

  const formatTime = (s) =>
    String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Live Recording</Text>
      <Text style={styles.timer}>{formatTime(recordingTime)}</Text>
      <Text style={styles.status}>{statusText}</Text>
      {isTranscribing
        ? <ActivityIndicator size="large" color="#1A56A0" style={{ marginTop: 40 }} />
        : <TouchableOpacity
            style={[styles.recordBtn, isRecording && styles.recordBtnActive]}
            onPress={isRecording ? stopAndTranscribe : startRecording}>
            <Text style={styles.recordBtnText}>{isRecording ? 'Stop' : 'Record'}</Text>
          </TouchableOpacity>
      }
      {isRecording && <Text style={styles.hint}>Tap Stop when finished</Text>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#F5F7FA', alignItems: 'center', justifyContent: 'center' },
  title:           { fontSize: 22, fontWeight: 'bold', color: '#0D3B7A', marginBottom: 12 },
  timer:           { fontSize: 52, fontWeight: 'bold', color: '#1A56A0' },
  status:          { fontSize: 15, color: '#666', marginTop: 12, marginBottom: 40 },
  recordBtn:       { width: 120, height: 120, borderRadius: 60, backgroundColor: '#1A56A0',
                     justifyContent: 'center', alignItems: 'center',
                     shadowColor: '#1A56A0', shadowOffset: { width: 0, height: 4 },
                     shadowOpacity: 0.4, shadowRadius: 8, elevation: 8 },
  recordBtnActive: { backgroundColor: '#B22222' },
  recordBtnText:   { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  hint:            { marginTop: 24, fontSize: 13, color: '#888' },
});