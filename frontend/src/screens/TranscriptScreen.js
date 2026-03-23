import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView, Alert,
  ActivityIndicator, Share
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { summarizeTranscript } from '../services/api';

export default function TranscriptScreen({ route }) {
  const { transcript } = route.params;

  const [summary,        setSummary]        = useState(transcript.autoSummary || null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [showOriginal,   setShowOriginal]   = useState(false);

  const isMixedMode = transcript.mode === 'mumbai' ||
                      transcript.mode === 'delhi'  ||
                      transcript.mode === 'hi';

  const getModeLabel = () => {
    const labels = {
      mumbai: '🏙️ Mumbai Mode',
      delhi:  '🏛️ Delhi Mode',
      hi:     '🇮🇳 Hindi Mode',
      en:     '🇬🇧 English Mode',
    };
    return labels[transcript.mode] || '🇬🇧 English Mode';
  };

  const copyToClipboard = async () => {
    const textToCopy = transcript.englishText || transcript.text;
    await Clipboard.setStringAsync(textToCopy);
    Alert.alert('Copied!', 'Transcript copied to clipboard');
  };

  const shareTranscript = async () => {
    try {
      let shareText = transcript.title + '\n\n';

      if (isMixedMode && transcript.englishText) {
        shareText += '--- English Translation ---\n';
        shareText += transcript.englishText + '\n\n';
        shareText += '--- Original ---\n';
        shareText += transcript.text;
      } else if (transcript.utterances?.length > 0) {
        shareText += transcript.utterances.map(u =>
          `${u.speaker}:\n${u.englishText || u.text}`
        ).join('\n\n');
      } else {
        shareText += transcript.text;
      }

      await Share.share({
        message: shareText,
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
      const textForSummary = transcript.englishText || transcript.text;
      const result = await summarizeTranscript(textForSummary);
      if (result.success) {
        setSummary(result.summary);
      } else {
        Alert.alert('Error', 'Could not generate summary.');
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

        {/* Title & Meta */}
        <Text style={styles.title}>{transcript.title}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>
            {transcript.wordCount} words  •  {formatDate(transcript.createdAt)}
          </Text>
          <View style={styles.modeBadge}>
            <Text style={styles.modeBadgeText}>{getModeLabel()}</Text>
          </View>
        </View>

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

        {/* Auto Summary (from recording) */}
        {summary && (
          <View style={styles.summaryBox}>
            <Text style={styles.summaryTitle}>🤖 AI Summary</Text>
            <Text style={styles.summaryText}>{summary}</Text>
          </View>
        )}

        {/* Mixed Mode — English Translation */}
        {isMixedMode && transcript.englishText && (
          <View style={styles.translationBox}>
            <View style={styles.translationHeader}>
              <Text style={styles.translationTitle}>
                🇬🇧 English Translation
              </Text>
              <TouchableOpacity
                style={styles.toggleBtn}
                onPress={() => setShowOriginal(!showOriginal)}>
                <Text style={styles.toggleBtnText}>
                  {showOriginal ? 'Hide Original' : 'Show Original'}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.translationText}>
              {transcript.englishText}
            </Text>

            {/* Original Text */}
            {showOriginal && transcript.originalText && (
              <View style={styles.originalBox}>
                <Text style={styles.originalLabel}>
                  Original ({getModeLabel()}):
                </Text>
                <Text style={styles.originalText}>
                  {transcript.originalText}
                </Text>
              </View>
            )}
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

                {/* English text (primary) */}
                {utterance.englishText && (
                  <Text style={styles.utteranceText}>
                    {utterance.englishText}
                  </Text>
                )}

                {/* Original text (secondary) */}
                {utterance.englishText && utterance.text !== utterance.englishText && (
                  <Text style={styles.utteranceOriginal}>
                    {utterance.text}
                  </Text>
                )}

                {/* If no translation — show original */}
                {!utterance.englishText && (
                  <Text style={styles.utteranceText}>
                    {utterance.text}
                  </Text>
                )}
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.transcriptBox}>
            <Text style={styles.transcriptLabel}>📝 Full Transcript</Text>
            <Text style={styles.transcriptText}>
              {transcript.englishText || transcript.text}
            </Text>
            {isMixedMode && transcript.originalText && (
              <TouchableOpacity
                style={styles.toggleBtn}
                onPress={() => setShowOriginal(!showOriginal)}>
                <Text style={styles.toggleBtnText}>
                  {showOriginal ? 'Hide Original' : 'Show Original'}
                </Text>
              </TouchableOpacity>
            )}
            {showOriginal && transcript.originalText && (
              <View style={styles.originalBox}>
                <Text style={styles.originalLabel}>Original:</Text>
                <Text style={styles.originalText}>
                  {transcript.originalText}
                </Text>
              </View>
            )}
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
  metaRow:          { flexDirection: 'row', justifyContent: 'space-between',
                      alignItems: 'center', marginBottom: 16, flexWrap: 'wrap',
                      gap: 8 },
  meta:             { fontSize: 12, color: '#888' },
  modeBadge:        { backgroundColor: '#E8F0FC', paddingHorizontal: 10,
                      paddingVertical: 4, borderRadius: 12 },
  modeBadgeText:    { fontSize: 11, color: '#1A56A0', fontWeight: '600' },
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
  translationBox:   { backgroundColor: '#FFF9E6', padding: 16,
                      borderRadius: 12, marginBottom: 16,
                      borderLeftWidth: 4, borderLeftColor: '#E6A817' },
  translationHeader:{ flexDirection: 'row', justifyContent: 'space-between',
                      alignItems: 'center', marginBottom: 10 },
  translationTitle: { fontSize: 14, fontWeight: 'bold', color: '#8B6A00' },
  translationText:  { fontSize: 14, color: '#333', lineHeight: 24 },
  originalBox:      { marginTop: 12, padding: 12, backgroundColor: '#F5F0E0',
                      borderRadius: 8 },
  originalLabel:    { fontSize: 11, fontWeight: '600', color: '#888',
                      marginBottom: 6 },
  originalText:     { fontSize: 13, color: '#666', lineHeight: 22,
                      fontStyle: 'italic' },
  toggleBtn:        { paddingHorizontal: 10, paddingVertical: 4,
                      backgroundColor: '#E6A817', borderRadius: 8 },
  toggleBtnText:    { fontSize: 11, color: '#fff', fontWeight: '600' },
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
  utteranceBox:     { borderRadius: 10, padding: 14, marginBottom: 12 },
  speakerRow:       { flexDirection: 'row', alignItems: 'center',
                      gap: 10, marginBottom: 8 },
  speakerBadge:     { paddingHorizontal: 10, paddingVertical: 4,
                      borderRadius: 12 },
  speakerBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: 'bold' },
  utteranceTime:    { fontSize: 11, color: '#666' },
  utteranceText:    { fontSize: 15, color: '#333', lineHeight: 26 },
  utteranceOriginal:{ fontSize: 12, color: '#888', lineHeight: 20,
                      marginTop: 6, fontStyle: 'italic' },
});