import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, Alert, ActivityIndicator,
  ScrollView, Animated
} from 'react-native';
import { Audio } from 'expo-av';
import { getRealtimeToken } from '../services/api';
import { saveTranscript, createTranscriptObj } from '../utils/storage';

const ASSEMBLYAI_WS = 'wss://streaming.assemblyai.com/v3/ws';
const SAMPLE_RATE   = 16000;
const CHUNK_MS      = 2000; // record 2-second chunks

// ─── Parse WAV header to find actual data offset ──────────────────────────────
// WAV headers are NOT always 44 bytes — this reads the real offset
const getWavDataOffset = (buffer) => {
  try {
    const view = new DataView(buffer);
    // Walk RIFF chunks to find 'data' chunk
    let offset = 12; // skip RIFF(4) + size(4) + WAVE(4)
    while (offset < buffer.byteLength - 8) {
      const chunkId   = String.fromCharCode(
        view.getUint8(offset),   view.getUint8(offset+1),
        view.getUint8(offset+2), view.getUint8(offset+3)
      );
      const chunkSize = view.getUint32(offset + 4, true);
      if (chunkId === 'data') return offset + 8; // found — skip 'data' + size
      offset += 8 + chunkSize;
    }
  } catch (e) {}
  return 44; // fallback to standard header size
};

export default function LiveScreen({ navigation }) {
  const [isRecording,   setIsRecording]   = useState(false);
  const [isConnecting,  setIsConnecting]  = useState(false);
  const [isSaving,      setIsSaving]      = useState(false);
  const [liveText,      setLiveText]      = useState('');
  const [finalText,     setFinalText]     = useState('');
  const [statusText,    setStatusText]    = useState('Tap to start live transcription');
  const [wordCount,     setWordCount]     = useState(0);
  const [recordingTime, setRecordingTime] = useState(0);
  const [bytesSent,     setBytesSent]     = useState(0); // debug indicator

  const wsRef         = useRef(null);
  const recordingRef  = useRef(null);
  const timerRef      = useRef(null);
  const scrollRef     = useRef(null);
  const activeRef     = useRef(false);
  const pulseAnim     = useRef(new Animated.Value(1)).current;
  const finalTextRef  = useRef('');
  const totalBytesRef = useRef(0);

  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording]);

  useEffect(() => {
    return () => { stopEverything(); };
  }, []);

  const stopEverything = () => {
    activeRef.current = false;
    clearInterval(timerRef.current);
    if (recordingRef.current) {
      recordingRef.current.stopAndUnloadAsync().catch(() => {});
      recordingRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const startLiveTranscription = async () => {
    try {
      setIsConnecting(true);
      setLiveText('');
      setFinalText('');
      finalTextRef.current   = '';
      totalBytesRef.current  = 0;
      setWordCount(0);
      setBytesSent(0);
      setRecordingTime(0);
      setStatusText('Getting token...');

      const tokenResult = await getRealtimeToken();
      if (!tokenResult.success) throw new Error('Could not get token: ' + tokenResult.error);

      setStatusText('Connecting to AssemblyAI...');

      // ── FIX 1: Use correct v3 WebSocket URL with all required params ─────────
      const wsUrl = `${ASSEMBLYAI_WS}?token=${tokenResult.token}&sample_rate=${SAMPLE_RATE}&encoding=pcm_s16le&format_turns=true`;
      const ws    = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        console.log('✅ WebSocket connected');
        setStatusText('Starting microphone...');
        startMicrophone();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          console.log('WS msg type:', msg.type, '| text:', msg.transcript || '');

          if (msg.type === 'Begin') {
            console.log('✅ Session started, id:', msg.id);
            setStatusText('🔴 Recording live — speak now!');

          } else if (msg.type === 'Turn') {
            const text = msg.transcript || '';
            if (!text) return;

            if (msg.end_of_turn) {
              // Completed sentence — move to final
              finalTextRef.current = finalTextRef.current
                ? finalTextRef.current + ' ' + text
                : text;
              setFinalText(finalTextRef.current);
              setLiveText('');
              setWordCount(finalTextRef.current.split(' ').filter(w => w).length);
              setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
            } else {
              // Partial — show as live preview
              setLiveText(text);
            }

          } else if (msg.type === 'Termination') {
            console.log('Session terminated by server');
          } else if (msg.type === 'Error') {
            console.error('AssemblyAI error:', msg.error);
            setStatusText('Error: ' + (msg.error || 'Unknown error'));
          }
        } catch (e) {
          console.error('WS parse error:', e, event.data?.toString?.()?.slice(0,100));
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error.message || error);
        setStatusText('⚠️ Connection error — tap Stop and try again');
        stopLiveTranscription();
      };

      ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        if (activeRef.current) {
          setStatusText('Connection closed. Tap Start to try again.');
          stopLiveTranscription();
        }
      };

    } catch (err) {
      console.error('Start error:', err.message);
      Alert.alert('Error', err.message);
      setIsConnecting(false);
      setStatusText('Tap to start live transcription');
    }
  };

  const startMicrophone = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission needed', 'Please allow microphone access');
        stopLiveTranscription();
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS:      true,
        playsInSilentModeIOS:    true,
        staysActiveInBackground: true,
        shouldDuckAndroid:       false,
      });

      activeRef.current = true;
      setIsRecording(true);
      setIsConnecting(false);
      setStatusText('🔴 Live — speak now!');

      timerRef.current = setInterval(() => {
        setRecordingTime(t => t + 1);
      }, 1000);

      recordChunk();

    } catch (err) {
      console.error('Microphone error:', err.message);
      Alert.alert('Error', 'Could not start microphone: ' + err.message);
      stopLiveTranscription();
    }
  };

  // ── FIX 2: Correct recording config + proper WAV header parsing ─────────────
  const recordChunk = async () => {
    if (!activeRef.current) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.log('WS not open, state:', wsRef.current?.readyState);
      return;
    }

    try {
      const { recording } = await Audio.Recording.createAsync({
        android: {
          extension:        '.wav',
          outputFormat:     Audio.AndroidOutputFormat.WAVE,      // ✅ WAVE not DEFAULT
          audioEncoder:     Audio.AndroidAudioEncoder.PCM_16BIT, // ✅ explicit PCM
          sampleRate:       SAMPLE_RATE,
          numberOfChannels: 1,
          bitRate:          SAMPLE_RATE * 16,
        },
        ios: {
          extension:            '.wav',
          outputFormat:         Audio.IOSOutputFormat.LINEARPCM,
          audioQuality:         Audio.IOSAudioQuality.HIGH,
          sampleRate:           SAMPLE_RATE,
          numberOfChannels:     1,
          bitRate:              SAMPLE_RATE * 16,
          linearPCMBitDepth:    16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat:     false,
        },
        web: {},
      });

      recordingRef.current = recording;

      // Record for CHUNK_MS milliseconds
      await new Promise(resolve => setTimeout(resolve, CHUNK_MS));

      if (!activeRef.current || !recordingRef.current) return;

      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (uri && wsRef.current?.readyState === WebSocket.OPEN) {
        const response = await fetch(uri);
        const buffer   = await response.arrayBuffer();

        // ── FIX 3: Parse actual WAV header offset instead of hardcoding 44 ────
        const dataOffset = getWavDataOffset(buffer);
        const pcmData    = buffer.slice(dataOffset);

        console.log(`Buffer: ${buffer.byteLength}b | Header: ${dataOffset}b | PCM: ${pcmData.byteLength}b`);

        if (pcmData.byteLength > 0) {
          wsRef.current.send(pcmData);
          totalBytesRef.current += pcmData.byteLength;
          setBytesSent(totalBytesRef.current);
        }

        // ── FIX 4: Send ForceEndpoint every ~4 seconds to flush partial text ──
        // This tells AssemblyAI to treat current audio as end-of-turn
        // Without this, short pauses never produce end_of_turn=true
        const elapsed = Math.round(totalBytesRef.current / (SAMPLE_RATE * 2)); // approx seconds
        if (elapsed > 0 && elapsed % 4 === 0) {
          try {
            wsRef.current.send(JSON.stringify({ type: 'ForceEndpoint' }));
            console.log('Sent ForceEndpoint at ~', elapsed, 's');
          } catch (e) {}
        }
      }

      // Continue recording next chunk
      if (activeRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        recordChunk();
      }

    } catch (err) {
      console.error('Chunk error:', err.message);
      if (activeRef.current) {
        setTimeout(() => recordChunk(), 500);
      }
    }
  };

  const stopLiveTranscription = async () => {
    activeRef.current = false;
    clearInterval(timerRef.current);
    setIsRecording(false);

    if (recordingRef.current) {
      try { await recordingRef.current.stopAndUnloadAsync(); } catch (e) {}
      recordingRef.current = null;
    }

    // ── Send ForceEndpoint before closing to flush any remaining text ─────────
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ type: 'ForceEndpoint' }));
        await new Promise(resolve => setTimeout(resolve, 500)); // wait for final message
      } catch (e) {}
      try { wsRef.current.close(); } catch (e) {}
      wsRef.current = null;
    }

    setLiveText('');
    setStatusText(
      finalTextRef.current.trim()
        ? 'Done! Tap 💾 Save to keep this transcript.'
        : 'Recording stopped. Tap Start to try again.'
    );
  };

  const handleToggle = () => {
    if (isRecording) stopLiveTranscription();
    else startLiveTranscription();
  };

  const saveCurrentTranscript = async () => {
    const textToSave = finalTextRef.current.trim();
    if (!textToSave) {
      Alert.alert('Nothing to save', 'Please record something first.');
      return;
    }
    setIsSaving(true);
    const title = 'Live — ' + new Date().toLocaleDateString('en-IN');
    const obj   = { ...createTranscriptObj(title, textToSave, recordingTime), mode: 'en' };
    const saved = await saveTranscript(obj);
    if (saved?.success) {
      Alert.alert('✅ Saved!', 'Live transcript saved!',
        [{ text: 'View', onPress: () => navigation.navigate('Home') }]);
      setFinalText('');
      finalTextRef.current  = '';
      totalBytesRef.current = 0;
      setBytesSent(0);
      setWordCount(0);
      setRecordingTime(0);
      setStatusText('Tap to start live transcription');
    } else {
      Alert.alert('Error', 'Could not save. Try again.');
    }
    setIsSaving(false);
  };

  const clearTranscript = () => {
    Alert.alert('Clear?', 'Clear the current transcript?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => {
        setFinalText(''); finalTextRef.current = '';
        setLiveText(''); setWordCount(0);
        setRecordingTime(0); setBytesSent(0);
        totalBytesRef.current = 0;
        setStatusText('Tap to start live transcription');
      }}
    ]);
  };

  const hasContent = finalText.trim().length > 0 || liveText.trim().length > 0;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{formatTime(recordingTime)}</Text>
          <Text style={styles.statLabel}>Duration</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{wordCount}</Text>
          <Text style={styles.statLabel}>Words</Text>
        </View>
        <View style={[styles.statBox, styles.statBoxStatus]}>
          {isConnecting
            ? <ActivityIndicator size="small" color="#FF9800" />
            : <Animated.View style={[styles.statusDot,
                { transform: [{ scale: pulseAnim }] },
                { backgroundColor: isRecording ? '#F44336' : '#9E9E9E' }]} />
          }
          <Text style={styles.statLabel}>
            {isConnecting ? 'Connecting' : isRecording ? 'LIVE' : 'Stopped'}
          </Text>
        </View>
        {/* Debug: bytes sent indicator */}
        {isRecording && (
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { fontSize: 13 }]}>
              {bytesSent > 0 ? (bytesSent / 1024).toFixed(0) + 'kb' : '0'}
            </Text>
            <Text style={styles.statLabel}>Sent</Text>
          </View>
        )}
      </View>

      <View style={styles.statusBox}>
        <Text style={styles.statusText}>{statusText}</Text>
      </View>

      <ScrollView ref={scrollRef} style={styles.transcriptScroll}
        contentContainerStyle={styles.transcriptContent}>
        {!hasContent && !isRecording && !isConnecting && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🎙️</Text>
            <Text style={styles.emptyTitle}>Ready for Live Transcription</Text>
            <Text style={styles.emptySubtitle}>
              Transcribes every 2 seconds{'\n'}
              Speak clearly in English
            </Text>
            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>
                ℹ️ Hindi/Marathi not supported in live mode{'\n'}
                Use Record → Upload for Indian languages
              </Text>
            </View>
          </View>
        )}
        {finalText ? <Text style={styles.finalText}>{finalText}</Text> : null}
        {liveText  ? <Text style={styles.liveText}>{liveText}</Text>   : null}
        {isRecording && <Text style={styles.cursor}>|</Text>}
      </ScrollView>

      <View style={styles.actionButtons}>
        {hasContent && !isRecording && (
          <>
            <TouchableOpacity style={styles.saveBtn} onPress={saveCurrentTranscript} disabled={isSaving}>
              {isSaving
                ? <ActivityIndicator color="#FFF" />
                : <Text style={styles.saveBtnText}>💾 Save Transcript</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.clearBtn} onPress={clearTranscript}>
              <Text style={styles.clearBtnText}>🗑</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <TouchableOpacity
        style={[styles.recordBtn,
          isRecording   && styles.recordBtnActive,
          isConnecting  && styles.recordBtnConnecting]}
        onPress={handleToggle}
        disabled={isConnecting || isSaving}>
        {isConnecting
          ? <><ActivityIndicator color="#FFF" size="small" /><Text style={styles.recordBtnText}>  Connecting...</Text></>
          : isRecording
            ? <Text style={styles.recordBtnText}>⏹ Stop</Text>
            : <Text style={styles.recordBtnText}>🔴 Start Live Transcription</Text>
        }
      </TouchableOpacity>

      <Text style={styles.hint}>
        {isRecording
          ? `💡 Speaking? ${bytesSent > 0 ? 'Audio flowing ✅' : 'Waiting for audio...'}`
          : '💡 Speak clearly — transcribes every 2 seconds'}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#F5F7FA', padding: 16 },
  statsRow:           { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statBox:            { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 12,
                        padding: 10, alignItems: 'center', elevation: 2 },
  statBoxStatus:      { flexDirection: 'column', gap: 4 },
  statValue:          { fontSize: 20, fontWeight: 'bold', color: '#0D3B7A' },
  statLabel:          { fontSize: 10, color: '#888', marginTop: 2 },
  statusDot:          { width: 16, height: 16, borderRadius: 8, marginBottom: 4 },
  statusBox:          { backgroundColor: '#EFF4FF', borderRadius: 10,
                        padding: 10, marginBottom: 12, alignItems: 'center' },
  statusText:         { fontSize: 13, color: '#1A56A0', fontWeight: '500', textAlign: 'center' },
  transcriptScroll:   { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 14,
                        marginBottom: 12, elevation: 2 },
  transcriptContent:  { padding: 16, minHeight: 200 },
  emptyState:         { alignItems: 'center', justifyContent: 'center', paddingVertical: 30 },
  emptyIcon:          { fontSize: 48, marginBottom: 12 },
  emptyTitle:         { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 8 },
  emptySubtitle:      { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 22, marginBottom: 16 },
  noticeBox:          { backgroundColor: '#EFF4FF', padding: 12, borderRadius: 10,
                        borderWidth: 1, borderColor: '#BFDBFE' },
  noticeText:         { fontSize: 12, color: '#1A56A0', textAlign: 'center', lineHeight: 20 },
  finalText:          { fontSize: 16, color: '#1A1A1A', lineHeight: 28 },
  liveText:           { fontSize: 16, color: '#1A56A0', lineHeight: 28,
                        fontStyle: 'italic', opacity: 0.7 },
  cursor:             { fontSize: 16, color: '#1A56A0', fontWeight: 'bold' },
  actionButtons:      { flexDirection: 'row', gap: 10, marginBottom: 10 },
  saveBtn:            { flex: 4, backgroundColor: '#1A7A4A', padding: 14,
                        borderRadius: 12, alignItems: 'center' },
  saveBtnText:        { color: '#FFFFFF', fontWeight: 'bold', fontSize: 15 },
  clearBtn:           { flex: 1, backgroundColor: '#F5F5F5', padding: 14,
                        borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#DDD' },
  clearBtnText:       { color: '#666', fontWeight: '600', fontSize: 18 },
  recordBtn:          { backgroundColor: '#1A56A0', padding: 18, borderRadius: 16,
                        alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  recordBtnActive:    { backgroundColor: '#C0392B' },
  recordBtnConnecting:{ backgroundColor: '#FF9800' },
  recordBtnText:      { color: '#FFFFFF', fontSize: 18, fontWeight: 'bold' },
  hint:               { fontSize: 11, color: '#AAA', textAlign: 'center', marginTop: 8, marginBottom: 4 },
});