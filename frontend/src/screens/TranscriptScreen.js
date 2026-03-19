import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView, Alert, ActivityIndicator, Share
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { summarizeTranscript } from '../services/api';

export default function TranscriptScreen({ route }) {
  const { transcript } = route.params;
  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  const copyToClipboard = async () => {
    await Clipboard.setStringAsync(transcript.text);
    Alert.alert('Copied!', 'Transcript copied to clipboard');
  };

  const shareTranscript = async () => {
    try {
      await Share.share({
        message: transcript.title + '\n\n' + transcript.text,
        title: transcript.title,
      });
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  };

  const getSummary = async () => {
    setLoadingSummary(true);
    try {
      const result = await summarizeTranscript(transcript.text);
      setSummary(result.summary);
    } catch (err) {
      Alert.alert('Error', err.message);
    }
    setLoadingSummary(false);
  };

  const formatDate = (iso) => new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>{transcript.title}</Text>
        <Text style={styles.meta}>
          {transcript.wordCount} words | {formatDate(transcript.createdAt)}
        </Text>
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
        <View style={styles.transcriptBox}>
          <Text style={styles.transcriptLabel}>Full Transcript</Text>
          <Text style={styles.transcriptText}>{transcript.text}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  scroll: { padding: 20 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#0D3B7A', marginBottom: 6 },
  meta: { fontSize: 12, color: '#888', marginBottom: 16 },
  actions: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  btn: { flex: 1, backgroundColor: '#1A56A0', padding: 12, borderRadius: 8, alignItems: 'center' },
  btnGreen: { backgroundColor: '#1A7A4A' },
  btnOrange: { backgroundColor: '#C85A00' },
  btnText: { color: '#fff', fontWeight: 'bold' },
  summaryBox: { backgroundColor: '#D6F0E2', padding: 16, borderRadius: 10, marginBottom: 16, borderLeftWidth: 4, borderLeftColor: '#1A7A4A' },
  summaryTitle: { fontSize: 14, fontWeight: 'bold', color: '#1A7A4A', marginBottom: 8 },
  summaryText: { fontSize: 13, color: '#333', lineHeight: 22 },
  transcriptBox: { backgroundColor: '#fff', padding: 16, borderRadius: 10 },
  transcriptLabel: { fontSize: 13, fontWeight: 'bold', color: '#0D3B7A', marginBottom: 10 },
  transcriptText: { fontSize: 15, color: '#333', lineHeight: 26 },
});