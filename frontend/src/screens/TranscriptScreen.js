import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView, Alert,
  ActivityIndicator, Share
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { summarizeTranscript } from '../services/api';

export default function TranscriptScreen({ route }) {
  const { transcript } = route.params;

  const [summary,        setSummary]        = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [expandedSpeaker, setExpandedSpeaker] = useState(null);

  const copyToClipboard = async () => {
    await Clipboard.setStringAsync(transcript.text);
    Alert.alert('Copied!', 'Transcript copied to clipboard');
  };

  const shareTranscript = async () => {
    try {
      const speakerText = transcript.utterances?.length > 0
        ? transcript.utterances.map(u =>
            `${u.speaker}:\n${u.text}`
          ).join('\n\n')
        : transcript.text;

      await Share.share({
        message: transcript.title + '\n\n' + speakerText,
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

  const formatTime = (ms) => {
    if (!ms) return '0:00';
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const getSpeakerColor = (speaker) => {
    const colors = {
      'Speaker A': '#1A56A0',
      'Speaker B': '#1A7A4A',
      'Speaker C': '#C85A00',
      'Speaker D': '#8B1AAF',
      'Speaker E': '#C0392B',
    };
    return colors[speaker] || '#1A56A0';
  };

  const getSpeakerBg = (speaker) => {
    const colors = {
      'Speaker A': '#E8F0FC',
      'Speaker B': '#E8F5EE',
      'Speaker C': '#FEF3E8',
      'Speaker D': '#F3E8FE',
      'Speaker E': '#FDE8E8',
    };
    return colors[speaker] || '#E8F0FC';
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Title */}
        <Text style={styles.title}>{transcript.title}</Text>
        <Text style={styles.meta}>
          {transcript.wordCount} words  •  {formatDate(transcript.createdAt)}
          {transcript.utterances?.length > 0 &&
            `  •  ${transcript.utterances.length} speaker${transcript.utterances.length > 1 ? 's' : ''}`
          }
        </Text>

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.btn} onPress={copyToClipboard}>
            <Text style={styles.btnIcon}>📋</Text>
            <Text style={styles.btnText}>Copy</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnGreen]}
            onPress={getSummary}>
            <Text style={styles.btnIcon}>🤖</Text>
            <Text style={styles.btnText}>Summary</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnOrange]}
            onPress={shareTranscript}>
            <Text style={styles.btnIcon}>📤</Text>
            <Text style={styles.btnText}>Share</Text>
          </TouchableOpacity>
        </View>

        {/* Loading Summary */}
        {loadingSummary && (
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#1A56A0" />
            <Text style={styles.loadingText}>Generating AI summary...</Text>
          </View>
        )}

        {/* Summary */}
        {summary && (
          <View style={styles.summaryBox}>
            <Text style={styles.summaryTitle}>🤖 AI Summary</Text>
            <Text style={styles.summaryText}>{summary}</Text>
          </View>
        )}

        {/* Speaker Transcript */}
        {transcript.utterances && transcript.utterances.length > 0 ? (
          <View style={styles.transcriptBox}>
            <Text style={styles.transcriptLabel}>
              🎙 Speaker Transcript
            </Text>

            {/* Speaker Legend */}
            <View style={styles.legendRow}>
              {[...new Set(transcript.utterances.map(u => u.speaker))].map(speaker => (
                <View
                  key={speaker}
                  style={[styles.legendBadge,
                    { backgroundColor: getSpeakerColor(speaker) }]}>
                  <Text style={styles.legendText}>{speaker}</Text>
                </View>
              ))}
            </View>

            {/* Utterances */}
            {transcript.utterances.map((utterance, index) => (
              <View
                key={index}
                style={[styles.utteranceBox,
                  { backgroundColor: getSpeakerBg(utterance.speaker) }]}>
                <View style={styles.speakerRow}>
                  <View style={[styles.speakerBadge,
                    { backgroundColor: getSpeakerColor(utterance.speaker) }]}>
                    <Text style={styles.speakerBadgeText}>
                      {utterance.speaker}
                    </Text>
                  </View>
                  <Text style={styles.utteranceTime}>
                    {formatTime(utterance.start)} — {formatTime(utterance.end)}
                  </Text>
                </View>
                <Text style={styles.utteranceText}>
                  {utterance.text}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.transcriptBox}>
            <Text style={styles.transcriptLabel}>📝 Full Transcript</Text>
            <Text style={styles.transcriptText}>{transcript.text}</Text>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#F5F7FA' },
  scroll:           { padding: 20, paddingBottom: 40 },
  title:            { fontSize: 20, fontWeight: 'bold',
                      color: '#0D3B7A', marginBottom: 6 },
  meta:             { fontSize: 12, color: '#888', marginBottom: 20 },
  actions:          { flexDirection: 'row', gap: 10, marginBottom: 16 },
  btn:              { flex: 1, backgroundColor: '#1A56A0', padding: 10,
                      borderRadius: 10, alignItems: 'center' },
  btnGreen:         { backgroundColor: '#1A7A4A' },
  btnOrange:        { backgroundColor: '#C85A00' },
  btnIcon:          { fontSize: 18, marginBottom: 2 },
  btnText:          { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  loadingBox:       { flexDirection: 'row', alignItems: 'center',
                      gap: 10, padding: 16, backgroundColor: '#EFF4FF',
                      borderRadius: 10, marginBottom: 16 },
  loadingText:      { color: '#1A56A0', fontSize: 13 },
  summaryBox:       { backgroundColor: '#D6F0E2', padding: 16,
                      borderRadius: 12, marginBottom: 16,
                      borderLeftWidth: 4, borderLeftColor: '#1A7A4A' },
  summaryTitle:     { fontSize: 14, fontWeight: 'bold',
                      color: '#1A7A4A', marginBottom: 10 },
  summaryText:      { fontSize: 13, color: '#333', lineHeight: 22 },
  transcriptBox:    { backgroundColor: '#fff', padding: 16,
                      borderRadius: 12, marginBottom: 16 },
  transcriptLabel:  { fontSize: 14, fontWeight: 'bold',
                      color: '#0D3B7A', marginBottom: 12 },
  transcriptText:   { fontSize: 15, color: '#333', lineHeight: 28 },
  legendRow:        { flexDirection: 'row', gap: 8,
                      marginBottom: 16, flexWrap: 'wrap' },
  legendBadge:      { paddingHorizontal: 12, paddingVertical: 4,
                      borderRadius: 12 },
  legendText:       { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  utteranceBox:     { borderRadius: 10, padding: 14,
                      marginBottom: 12 },
  speakerRow:       { flexDirection: 'row', alignItems: 'center',
                      gap: 10, marginBottom: 8 },
  speakerBadge:     { paddingHorizontal: 10, paddingVertical: 4,
                      borderRadius: 12 },
  speakerBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: 'bold' },
  utteranceTime:    { fontSize: 11, color: '#666' },
  utteranceText:    { fontSize: 15, color: '#333', lineHeight: 26 },
});