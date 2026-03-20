import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView, Alert,
  ActivityIndicator, Share
} from 'react-native';
import { Audio } from 'expo-av';
import * as Clipboard from 'expo-clipboard';
import { summarizeTranscript } from '../services/api';

export default function TranscriptScreen({ route }) {
  const { transcript } = route.params;

  const [summary,        setSummary]        = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [sound,          setSound]          = useState(null);
  const [isPlaying,      setIsPlaying]      = useState(false);
  const [position,       setPosition]       = useState(0);
  const [duration,       setDuration]       = useState(0);
  const [activeWord,     setActiveWord]     = useState(null);
  const soundRef = useRef(null);

  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
    };
  }, []);

  const loadAudio = async () => {
    try {
      if (!transcript.audioPath) {
        Alert.alert('No audio', 'Audio file not available for this transcript');
        return;
      }

      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: transcript.audioPath },
        { shouldPlay: false },
        onPlaybackStatusUpdate
      );

      soundRef.current = newSound;
      setSound(newSound);
    } catch (err) {
      Alert.alert('Error', 'Could not load audio: ' + err.message);
    }
  };

  const onPlaybackStatusUpdate = (status) => {
    if (status.isLoaded) {
      setPosition(status.positionMillis);
      setDuration(status.durationMillis);
      setIsPlaying(status.isPlaying);

      if (transcript.words) {
        const currentWord = transcript.words.find(
          w => status.positionMillis >= w.start &&
               status.positionMillis <= w.end
        );
        if (currentWord) setActiveWord(currentWord.text);
      }

      if (status.didJustFinish) {
        setIsPlaying(false);
        setPosition(0);
      }
    }
  };

  const togglePlayPause = async () => {
    if (!soundRef.current) {
      await loadAudio();
      return;
    }
    if (isPlaying) {
      await soundRef.current.pauseAsync();
    } else {
      await soundRef.current.playAsync();
    }
  };

  const seekForward = async () => {
    if (!soundRef.current) return;
    const newPos = Math.min(position + 5000, duration);
    await soundRef.current.setPositionAsync(newPos);
  };

  const seekBackward = async () => {
    if (!soundRef.current) return;
    const newPos = Math.max(position - 5000, 0);
    await soundRef.current.setPositionAsync(newPos);
  };

  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const progressPercent = duration > 0 ? (position / duration) * 100 : 0;

  const copyToClipboard = async () => {
    await Clipboard.setStringAsync(transcript.text);
    Alert.alert('Copied!', 'Transcript copied to clipboard');
  };

  const shareTranscript = async () => {
    try {
      await Share.share({
        message: transcript.title + '\n\n' + transcript.text,
        title:   transcript.title,
      });
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  };

  const getSummary = async () => {
    setLoadingSummary(true);
    setSummary(null);
    try {
      const result = await summarizeTranscript(transcript.text);
      if (result.success) {
        setSummary(result.summary);
      } else {
        Alert.alert('Error', 'Could not generate summary. Please try again.');
      }
    } catch (err) {
      Alert.alert('Error', err.message);
    }
    setLoadingSummary(false);
  };

  const formatDate = (iso) => new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const getSpeakerColor = (speaker) => {
    const colors = {
      'Speaker A': '#1A56A0',
      'Speaker B': '#1A7A4A',
      'Speaker C': '#C85A00',
      'Speaker D': '#8B1AAF',
    };
    return colors[speaker] || '#1A56A0';
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>

        <Text style={styles.title}>{transcript.title}</Text>
        <Text style={styles.meta}>
          {transcript.wordCount} words | {formatDate(transcript.createdAt)}
        </Text>

        {transcript.audioPath && (
          <View style={styles.playerBox}>
            <Text style={styles.playerTitle}>Audio Player</Text>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: progressPercent + '%' }]} />
            </View>
            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatTime(position)}</Text>
              <Text style={styles.timeText}>{formatTime(duration)}</Text>
            </View>
            <View style={styles.controls}>
              <TouchableOpacity style={styles.seekBtn} onPress={seekBackward}>
                <Text style={styles.seekBtnText}>-5s</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.playBtn} onPress={togglePlayPause}>
                <Text style={styles.playBtnText}>
                  {isPlaying ? '⏸' : '▶'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.seekBtn} onPress={seekForward}>
                <Text style={styles.seekBtnText}>+5s</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.actions}>
          <TouchableOpacity style={styles.btn} onPress={copyToClipboard}>
            <Text style={styles.btnText}>Copy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnGreen]} onPress={getSummary}>
            <Text style={styles.btnText}>AI Summary</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnOrange]} onPress={shareTranscript}>
            <Text style={styles.btnText}>Share</Text>
          </TouchableOpacity>
        </View>

        {loadingSummary && (
          <ActivityIndicator color="#1A56A0" style={{ margin: 16 }} />
        )}

        {summary && (
          <View style={styles.summaryBox}>
            <Text style={styles.summaryTitle}>AI Summary</Text>
            <Text style={styles.summaryText}>{summary}</Text>
          </View>
        )}

        {transcript.utterances && transcript.utterances.length > 0 ? (
          <View style={styles.transcriptBox}>
            <Text style={styles.transcriptLabel}>Speaker Transcript</Text>
            {transcript.utterances.map((utterance, index) => (
              <View key={index} style={styles.utteranceBox}>
                <View style={styles.speakerRow}>
                  <View style={[styles.speakerBadge,
                    { backgroundColor: getSpeakerColor(utterance.speaker) }]}>
                    <Text style={styles.speakerBadgeText}>
                      {utterance.speaker}
                    </Text>
                  </View>
                  <Text style={styles.utteranceTime}>
                    {formatTime(utterance.start)} - {formatTime(utterance.end)}
                  </Text>
                </View>
                <Text style={styles.utteranceText}>
                  {utterance.words ? utterance.words.map((word, wi) => (
                    <Text
                      key={wi}
                      style={[
                        styles.wordText,
                        activeWord === word.text && styles.wordActive
                      ]}>
                      {word.text + ' '}
                    </Text>
                  )) : utterance.text}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.transcriptBox}>
            <Text style={styles.transcriptLabel}>Full Transcript</Text>
            <Text style={styles.transcriptText}>{transcript.text}</Text>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#F5F7FA' },
  scroll:           { padding: 20 },
  title:            { fontSize: 20, fontWeight: 'bold',
                      color: '#0D3B7A', marginBottom: 6 },
  meta:             { fontSize: 12, color: '#888', marginBottom: 16 },
  playerBox:        { backgroundColor: '#FFFFFF', borderRadius: 12,
                      padding: 16, marginBottom: 16,
                      borderWidth: 1, borderColor: '#DCE9F8' },
  playerTitle:      { fontSize: 13, fontWeight: 'bold',
                      color: '#0D3B7A', marginBottom: 12 },
  progressBar:      { height: 6, backgroundColor: '#E8EEF7',
                      borderRadius: 3, marginBottom: 8 },
  progressFill:     { height: 6, backgroundColor: '#1A56A0',
                      borderRadius: 3 },
  timeRow:          { flexDirection: 'row', justifyContent: 'space-between',
                      marginBottom: 12 },
  timeText:         { fontSize: 12, color: '#888' },
  controls:         { flexDirection: 'row', justifyContent: 'center',
                      alignItems: 'center', gap: 20 },
  seekBtn:          { backgroundColor: '#E8EEF7', paddingHorizontal: 16,
                      paddingVertical: 10, borderRadius: 8 },
  seekBtnText:      { color: '#1A56A0', fontWeight: 'bold', fontSize: 14 },
  playBtn:          { backgroundColor: '#1A56A0', width: 56, height: 56,
                      borderRadius: 28, justifyContent: 'center',
                      alignItems: 'center' },
  playBtnText:      { color: '#FFFFFF', fontSize: 22 },
  actions:          { flexDirection: 'row', gap: 12, marginBottom: 16 },
  btn:              { flex: 1, backgroundColor: '#1A56A0', padding: 12,
                      borderRadius: 8, alignItems: 'center' },
  btnGreen:         { backgroundColor: '#1A7A4A' },
  btnOrange:        { backgroundColor: '#C85A00' },
  btnText:          { color: '#fff', fontWeight: 'bold' },
  summaryBox:       { backgroundColor: '#D6F0E2', padding: 16,
                      borderRadius: 10, marginBottom: 16,
                      borderLeftWidth: 4, borderLeftColor: '#1A7A4A' },
  summaryTitle:     { fontSize: 14, fontWeight: 'bold',
                      color: '#1A7A4A', marginBottom: 8 },
  summaryText:      { fontSize: 13, color: '#333', lineHeight: 22 },
  transcriptBox:    { backgroundColor: '#fff', padding: 16, borderRadius: 10 },
  transcriptLabel:  { fontSize: 13, fontWeight: 'bold',
                      color: '#0D3B7A', marginBottom: 10 },
  transcriptText:   { fontSize: 15, color: '#333', lineHeight: 26 },
  utteranceBox:     { marginBottom: 16, paddingBottom: 16,
                      borderBottomWidth: 1, borderBottomColor: '#E8EEF7' },
  speakerRow:       { flexDirection: 'row', alignItems: 'center',
                      gap: 10, marginBottom: 8 },
  speakerBadge:     { paddingHorizontal: 10, paddingVertical: 4,
                      borderRadius: 12 },
  speakerBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: 'bold' },
  utteranceTime:    { fontSize: 11, color: '#888' },
  utteranceText:    { fontSize: 15, color: '#333', lineHeight: 26 },
  wordText:         { fontSize: 15, color: '#333' },
  wordActive:       { backgroundColor: '#FFE066', color: '#0D3B7A',
                      fontWeight: 'bold' },
});