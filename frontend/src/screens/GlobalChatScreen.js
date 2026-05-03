import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, Alert, ActivityIndicator,
  TextInput, FlatList, KeyboardAvoidingView,
  Platform, Keyboard, StatusBar
} from 'react-native';
import { getAllTranscripts } from '../utils/storage';
import { chatWithTranscripts } from '../services/api';

export default function GlobalChatScreen({ navigation }) {
  const [transcripts,   setTranscripts]   = useState([]);
  const [chatMessages,  setChatMessages]  = useState([]);
  const [chatInput,     setChatInput]     = useState('');
  const [chatLoading,   setChatLoading]   = useState(false);
  const [loadingData,   setLoadingData]   = useState(true);

  const flatListRef = useRef(null);
  const inputRef    = useRef(null);

  useEffect(() => {
    loadTranscripts();
  }, []);

  const loadTranscripts = async () => {
    try {
      const data = await getAllTranscripts();
      setTranscripts(data.slice(0, 10));
    } catch (err) {
      Alert.alert('Error', 'Could not load recordings');
    } finally {
      setLoadingData(false);
    }
  };

  const sendMessage = async () => {
    const question = chatInput.trim();
    if (!question || chatLoading || transcripts.length === 0) return;

    Keyboard.dismiss();
    const userMsg = { role: 'user', text: question, id: Date.now().toString() };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setChatLoading(true);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const result = await chatWithTranscripts(question, transcripts);
      setChatMessages(prev => [...prev, {
        role: 'ai',
        text: result.success ? result.answer : 'Sorry, could not answer that.',
        id:   (Date.now() + 1).toString(),
      }]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err) {
      setChatMessages(prev => [...prev, {
        role: 'ai', text: 'Something went wrong.', id: (Date.now() + 1).toString()
      }]);
    }
    setChatLoading(false);
  };

  const SUGGESTED_QUESTIONS = [
    'What were the main topics across all my meetings?',
    'Which recording mentioned action items?',
    'Summarize what was discussed this week',
    'Who were the most active speakers?',
    'What decisions were made recently?',
    'Any deadlines or follow-ups mentioned?',
  ];

  if (loadingData) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#6C3FA0" />
          <Text style={styles.loadingText}>Loading your recordings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#6C3FA0" />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => { Keyboard.dismiss(); navigation.goBack(); }}
            style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>💬 Ask AI</Text>
            <Text style={styles.headerSub}>Across all recordings</Text>
          </View>
          <View style={{ width: 60 }} />
        </View>

        {/* Context bar */}
        <View style={styles.contextBar}>
          <Text style={styles.contextText}>
            🎙 {transcripts.length} recording{transcripts.length !== 1 ? 's' : ''} loaded as context
          </Text>
        </View>

        {/* Suggestions */}
        {chatMessages.length === 0 && (
          <View style={styles.suggestionsWrapper}>
            <Text style={styles.suggestionsTitle}>Try asking:</Text>
            <View style={styles.suggestionsGrid}>
              {SUGGESTED_QUESTIONS.map((q, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.suggestionChip}
                  onPress={() => {
                    setChatInput(q);
                    setTimeout(() => inputRef.current?.focus(), 100);
                  }}>
                  <Text style={styles.suggestionText}>{q}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={chatMessages}
          keyExtractor={item => item.id}
          style={styles.messagesList}
          contentContainerStyle={styles.messagesContent}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <View style={[
              styles.bubble,
              item.role === 'user' ? styles.userBubble : styles.aiBubble
            ]}>
              {item.role === 'ai' && (
                <Text style={styles.aiLabel}>🤖 VoxNote AI</Text>
              )}
              <Text style={[
                styles.bubbleText,
                item.role === 'user' ? styles.userText : styles.aiText
              ]}>
                {item.text}
              </Text>
            </View>
          )}
          ListFooterComponent={chatLoading ? (
            <View style={styles.typingBox}>
              <ActivityIndicator size="small" color="#6C3FA0" />
              <Text style={styles.typingText}>VoxNote AI is thinking...</Text>
            </View>
          ) : null}
        />

        {/* Input */}
        <View style={styles.inputWrapper}>
          <View style={styles.inputRow}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="Ask anything across all recordings..."
              placeholderTextColor="#888"
              value={chatInput}
              onChangeText={setChatInput}
              multiline
              maxLength={500}
              returnKeyType="send"
              blurOnSubmit={false}
              onSubmitEditing={sendMessage}
              onFocus={() => {
                setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 300);
              }}
            />
            <TouchableOpacity
              style={[styles.sendBtn,
                (!chatInput.trim() || chatLoading) && styles.sendBtnDisabled]}
              onPress={sendMessage}
              disabled={!chatInput.trim() || chatLoading}>
              <Text style={styles.sendBtnText}>➤</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.navBarSpacer} />
        </View>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#FFFFFF' },
  loadingBox:      { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  loadingText:     { fontSize: 14, color: '#888' },

  header:          { flexDirection: 'row', alignItems: 'center',
                     backgroundColor: '#6C3FA0', paddingTop: 16,
                     paddingBottom: 14, paddingHorizontal: 16 },
  backBtn:         { paddingVertical: 6, paddingRight: 12 },
  backText:        { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  headerCenter:    { flex: 1, alignItems: 'center' },
  headerTitle:     { color: '#FFFFFF', fontSize: 17, fontWeight: 'bold' },
  headerSub:       { color: '#DDD0FF', fontSize: 11, marginTop: 2 },

  contextBar:      { backgroundColor: '#F0E8FF', paddingHorizontal: 16,
                     paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#E0D0FF' },
  contextText:     { fontSize: 12, color: '#6C3FA0', fontWeight: '600' },

  suggestionsWrapper: { padding: 16, backgroundColor: '#FAF7FF',
                        borderBottomWidth: 1, borderBottomColor: '#EEE' },
  suggestionsTitle:   { fontSize: 12, color: '#888', fontWeight: '600',
                        textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  suggestionsGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  suggestionChip:     { backgroundColor: '#EDE0FF', paddingHorizontal: 12,
                        paddingVertical: 8, borderRadius: 20 },
  suggestionText:     { fontSize: 12, color: '#6C3FA0', fontWeight: '500' },

  messagesList:    { flex: 1, backgroundColor: '#FAF7FF' },
  messagesContent: { padding: 16, paddingBottom: 8 },
  bubble:          { maxWidth: '85%', padding: 12, borderRadius: 16, marginBottom: 12 },
  userBubble:      { backgroundColor: '#6C3FA0', alignSelf: 'flex-end',
                     borderBottomRightRadius: 4 },
  aiBubble:        { backgroundColor: '#FFFFFF', alignSelf: 'flex-start',
                     borderBottomLeftRadius: 4, elevation: 2,
                     shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4 },
  aiLabel:         { fontSize: 10, color: '#6C3FA0', fontWeight: '700', marginBottom: 4 },
  bubbleText:      { fontSize: 14, lineHeight: 22 },
  userText:        { color: '#FFFFFF' },
  aiText:          { color: '#333333' },
  typingBox:       { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  typingText:      { fontSize: 13, color: '#888', fontStyle: 'italic' },

  inputWrapper:    { backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#EEE' },
  inputRow:        { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 10,
                     paddingBottom: 8, gap: 8, alignItems: 'flex-end' },
  input:           { flex: 1, backgroundColor: '#F5F0FF', borderRadius: 20,
                     paddingHorizontal: 16, paddingVertical: 10,
                     fontSize: 14, color: '#333', maxHeight: 100, minHeight: 44 },
  sendBtn:         { width: 44, height: 44, borderRadius: 22, backgroundColor: '#6C3FA0',
                     justifyContent: 'center', alignItems: 'center', marginBottom: 2 },
  sendBtnDisabled: { backgroundColor: '#CCC' },
  sendBtnText:     { color: '#FFFFFF', fontSize: 18 },
  navBarSpacer:    { height: 20, backgroundColor: '#FFFFFF' },
});