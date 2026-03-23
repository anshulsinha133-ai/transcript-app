import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, SafeAreaView, Alert, StatusBar, TextInput
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getAllTranscripts, deleteTranscript } from '../utils/storage';

export default function HomeScreen({ navigation }) {
  const [transcripts, setTranscripts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filtered,    setFiltered]    = useState([]);

  useFocusEffect(useCallback(() => {
    const loadTranscripts = async () => {
      const data = await getAllTranscripts();
      setTranscripts(data);
      setFiltered(data);
    };
    loadTranscripts();
  }, []));

  const handleSearch = (text) => {
    setSearchQuery(text);
    if (text.trim() === '') {
      setFiltered(transcripts);
    } else {
      const query = text.toLowerCase();
      const results = transcripts.filter(t =>
        t.title.toLowerCase().includes(query) ||
        t.text.toLowerCase().includes(query)
      );
      setFiltered(results);
    }
  };

  const handleDelete = (id) => {
    Alert.alert('Delete Transcript', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await deleteTranscript(id);
          const updated = transcripts.filter(t => t.id !== id);
          setTranscripts(updated);
          setFiltered(updated);
        }
      }
    ]);
  };

  const formatDate = (iso) => new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate('Transcript', { transcript: item })}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => handleDelete(item.id)}>
          <Text style={styles.deleteBtnText}>🗑</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.cardDate}>{formatDate(item.createdAt)}</Text>
      <Text style={styles.cardPreview} numberOfLines={2}>{item.text}</Text>
      <View style={styles.cardFooter}>
        <Text style={styles.cardMeta}>{item.wordCount} words</Text>
        {item.duration && (
          <Text style={styles.cardMeta}>{Math.round(item.duration)}s</Text>
        )}
        <Text style={styles.cardMeta}>
          {item.utterances?.length > 0
            ? `${item.utterances.length} speakers`
            : 'Single speaker'}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0D3B7A" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>VoxNote</Text>
        <Text style={styles.headerSub}>
          {transcripts.length} recording{transcripts.length !== 1 ? 's' : ''}
        </Text>
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search transcripts..."
          placeholderTextColor="#888"
          value={searchQuery}
          onChangeText={handleSearch}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={() => handleSearch('')}>
            <Text style={styles.clearBtnText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.btn}
          onPress={() => navigation.navigate('Record')}>
          <Text style={styles.btnText}>🎙 Record</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary]}
          onPress={() => navigation.navigate('Upload')}>
          <Text style={[styles.btnText, styles.btnTextSecondary]}>📁 Upload</Text>
        </TouchableOpacity>
      </View>

      {filtered.length === 0 && searchQuery.length > 0
        ? <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No transcripts found{'\n'}for "{searchQuery}"
            </Text>
          </View>
        : filtered.length === 0
        ? <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No transcripts yet.{'\n'}Tap Record to start!
            </Text>
          </View>
        : <FlatList
            data={filtered}
            keyExtractor={t => t.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          />
      }
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#F5F7FA' },
  header:           { backgroundColor: '#0D3B7A', padding: 20, paddingTop: 16 },
  headerTitle:      { fontSize: 24, fontWeight: 'bold', color: '#FFFFFF' },
  headerSub:        { fontSize: 13, color: '#AACFEE', marginTop: 4 },
  searchContainer:  { flexDirection: 'row', alignItems: 'center', margin: 16,
                      backgroundColor: '#FFFFFF', borderRadius: 10, borderWidth: 1,
                      borderColor: '#DCE9F8', paddingHorizontal: 12 },
  searchInput:      { flex: 1, padding: 12, fontSize: 15, color: '#333' },
  clearBtn:         { padding: 8 },
  clearBtnText:     { fontSize: 16, color: '#888' },
  actions:          { flexDirection: 'row', paddingHorizontal: 16,
                      paddingBottom: 8, gap: 12 },
  btn:              { flex: 1, backgroundColor: '#1A56A0', padding: 14,
                      borderRadius: 10, alignItems: 'center' },
  btnSecondary:     { backgroundColor: '#FFFFFF', borderWidth: 1.5,
                      borderColor: '#1A56A0' },
  btnText:          { color: '#FFFFFF', fontWeight: 'bold', fontSize: 15 },
  btnTextSecondary: { color: '#1A56A0' },
  list:             { paddingHorizontal: 16, paddingBottom: 20 },
  card:             { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16,
                      marginBottom: 12, elevation: 3 },
  cardHeader:       { flexDirection: 'row', justifyContent: 'space-between',
                      alignItems: 'flex-start', marginBottom: 4 },
  cardTitle:        { fontSize: 16, fontWeight: 'bold', color: '#0D3B7A',
                      flex: 1, marginRight: 8 },
  cardDate:         { fontSize: 11, color: '#888888', marginBottom: 8 },
  cardPreview:      { fontSize: 13, color: '#666666', lineHeight: 20, marginBottom: 8 },
  cardFooter:       { flexDirection: 'row', gap: 16 },
  cardMeta:         { fontSize: 11, color: '#1A56A0', fontWeight: '600' },
  empty:            { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText:        { fontSize: 16, color: '#888888', textAlign: 'center', lineHeight: 28 },
  deleteBtn:        { padding: 6, marginLeft: 8 },
  deleteBtnText:    { fontSize: 18 },
});