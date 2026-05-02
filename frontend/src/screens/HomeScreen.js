import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, SafeAreaView, Alert, StatusBar, TextInput,
  ScrollView
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getAllTranscripts, deleteTranscript, searchTranscripts } from '../utils/storage';

// ─── Folder tabs ───
const FOLDERS = ['All', 'General', 'Work', 'Personal', 'Meetings', 'Lectures'];

const FOLDER_ICONS = {
  All:      '📋',
  General:  '🗂️',
  Work:     '💼',
  Personal: '👤',
  Meetings: '👥',
  Lectures: '🎓',
};

// ─── Group transcripts by date ───
const groupByDate = (transcripts) => {
  const groups = {};
  transcripts.forEach(t => {
    const date      = new Date(t.createdAt);
    const today     = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    let label;
    if (date.toDateString() === today.toDateString()) {
      label = 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      label = 'Yesterday';
    } else {
      label = date.toLocaleDateString('en-IN', {
        weekday: 'short', day: 'numeric', month: 'short'
      });
    }

    if (!groups[label]) groups[label] = [];
    groups[label].push(t);
  });

  return Object.entries(groups).map(([title, data]) => ({ title, data }));
};

// ─── Extract bullet points from autoSummary ───
const extractBullets = (autoSummary) => {
  if (!autoSummary) return [];
  return autoSummary.split('\n')
    .filter(l => l.trim().match(/^[\d\-\*\•]/))
    .map(l => l.replace(/^[\d\.\-\*\•]\s*/, '').trim())
    .filter(l => l.length > 10)
    .slice(0, 4);
};

// ─── Format duration ───
const formatDuration = (seconds) => {
  if (!seconds) return null;
  const mins = Math.round(seconds / 60);
  return mins < 1 ? '< 1 min' : `${mins} min`;
};

// ─── Match context badge ───
const MATCH_LABELS = {
  title:      { icon: '📌', label: 'Title match' },
  transcript: { icon: '📝', label: 'In transcript' },
  summary:    { icon: '🤖', label: 'In summary' },
  speaker:    { icon: '🗣️', label: 'Speaker said' },
  action:     { icon: '✅', label: 'Action item' },
};

export default function HomeScreen({ navigation }) {
  const [transcripts,   setTranscripts]   = useState([]);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [filtered,      setFiltered]      = useState([]);
  const [activeFolder,  setActiveFolder]  = useState('All');
  const [isSearching,   setIsSearching]   = useState(false);

  useFocusEffect(useCallback(() => {
    const loadTranscripts = async () => {
      const data = await getAllTranscripts();
      setTranscripts(data);
      applyFilters(data, searchQuery, activeFolder);
    };
    loadTranscripts();
  }, []));

  const applyFilters = (data, query, folder) => {
    let results = data;

    // Filter by folder
    if (folder !== 'All') {
      results = results.filter(t => (t.folder || 'General') === folder);
    }

    // Full-text search across all fields
    if (query.trim()) {
      results = searchTranscripts(results, query);
    } else {
      results = results.map(t => ({ ...t, matchContext: null }));
    }

    setFiltered(results);
  };

  const handleSearch = (text) => {
    setSearchQuery(text);
    setIsSearching(text.trim().length > 0);
    applyFilters(transcripts, text, activeFolder);
  };

  const handleFolderChange = (folder) => {
    setActiveFolder(folder);
    applyFilters(transcripts, searchQuery, folder);
  };

  const handleDelete = (id) => {
    Alert.alert('Delete Recording', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await deleteTranscript(id);
          const updated = transcripts.filter(t => t.id !== id);
          setTranscripts(updated);
          applyFilters(updated, searchQuery, activeFolder);
        }
      }
    ]);
  };

  // ─── Folder count badges ───
  const getFolderCount = (folder) => {
    if (folder === 'All') return transcripts.length;
    return transcripts.filter(t => (t.folder || 'General') === folder).length;
  };

  // ─── Render match context snippet ───
  const renderMatchContext = (matchContext) => {
    if (!matchContext) return null;
    const meta = MATCH_LABELS[matchContext.field] || { icon: '🔍', label: 'Match' };
    return (
      <View style={styles.matchBox}>
        <View style={styles.matchBadge}>
          <Text style={styles.matchBadgeText}>
            {meta.icon} {matchContext.speaker
              ? `${matchContext.speaker} said`
              : meta.label}
          </Text>
        </View>
        {matchContext.snippet && (
          <Text style={styles.matchSnippet} numberOfLines={2}>
            {matchContext.snippet}
          </Text>
        )}
      </View>
    );
  };

  // ─── Render card ───
  const renderCard = (item) => {
    const bullets     = item.matchContext ? [] : extractBullets(item.autoSummary);
    const duration    = formatDuration(item.duration);
    const time        = new Date(item.createdAt).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', hour12: true
    });
    const langFlag    = item.detectedLang === 'hi' ? '🇮🇳'
                      : item.detectedLang === 'mr' ? '🏙️' : '🇬🇧';
    const folderIcon  = FOLDER_ICONS[item.folder || 'General'] || '🗂️';

    return (
      <TouchableOpacity
        key={item.id}
        style={[styles.card, item.matchContext && styles.cardHighlighted]}
        onPress={() => navigation.navigate('Transcript', { transcript: item })}
        activeOpacity={0.85}>

        {/* Card Header */}
        <View style={styles.cardHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {item.title?.charAt(0)?.toUpperCase() || 'V'}
            </Text>
          </View>
          <View style={styles.cardMeta}>
            <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
            <View style={styles.cardSubRow}>
              <Text style={styles.cardTime}>{time}</Text>
              {duration && <Text style={styles.dot}>·</Text>}
              {duration && <Text style={styles.cardDuration}>{duration}</Text>}
              <Text style={styles.dot}>·</Text>
              <Text style={styles.langFlag}>{langFlag}</Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.folderIcon}>{folderIcon}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => handleDelete(item.id)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.deleteBtnText}>🗑</Text>
          </TouchableOpacity>
        </View>

        {/* Search match context — shown instead of bullets when searching */}
        {item.matchContext
          ? renderMatchContext(item.matchContext)
          : bullets.length > 0
            ? (
              <View style={styles.bulletsContainer}>
                {bullets.map((bullet, i) => (
                  <View key={i} style={styles.bulletRow}>
                    <Text style={styles.bulletDot}>•</Text>
                    <Text style={styles.bulletText} numberOfLines={1}>{bullet}</Text>
                  </View>
                ))}
              </View>
            )
            : (
              <Text style={styles.cardPreview} numberOfLines={2}>
                {item.englishText || item.text}
              </Text>
            )
        }

        {/* Footer */}
        <View style={styles.cardFooter}>
          {item.utterances?.length > 0 && (
            <View style={styles.footerBadge}>
              <Text style={styles.footerBadgeText}>
                👥 {[...new Set(item.utterances.map(u => u.speaker))].length} speakers
              </Text>
            </View>
          )}
          <View style={styles.footerBadge}>
            <Text style={styles.footerBadgeText}>📝 {item.wordCount || 0} words</Text>
          </View>
          {item.autoSummary && (
            <View style={[styles.footerBadge, styles.aiBadge]}>
              <Text style={[styles.footerBadgeText, styles.aiBadgeText]}>🤖 AI Summary</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // ─── Render grouped list ───
  const renderGroupedList = () => {
    const groups = groupByDate(filtered);
    return (
      <FlatList
        data={groups}
        keyExtractor={g => g.title}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        renderItem={({ item: group }) => (
          <View>
            <Text style={styles.dateHeader}>{group.title}</Text>
            {group.data.map(item => renderCard(item))}
          </View>
        )}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0D3B7A" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>VoxNote</Text>
          <Text style={styles.headerSub}>
            {isSearching
              ? `${filtered.length} result${filtered.length !== 1 ? 's' : ''} for "${searchQuery}"`
              : `${filtered.length} recording${filtered.length !== 1 ? 's' : ''}`
            }
          </Text>
        </View>
        <TouchableOpacity
          style={styles.headerMicBtn}
          onPress={() => navigation.navigate('Record')}>
          <Text style={styles.headerMicIcon}>🎙️</Text>
        </TouchableOpacity>
      </View>

      {/* Folder Tabs */}
      <View style={styles.folderTabsWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.folderTabs}>
          {FOLDERS.map(folder => {
            const count    = getFolderCount(folder);
            const isActive = folder === activeFolder;
            return (
              <TouchableOpacity
                key={folder}
                style={[styles.folderTab, isActive && styles.folderTabActive]}
                onPress={() => handleFolderChange(folder)}>
                <Text style={styles.folderTabIcon}>{FOLDER_ICONS[folder]}</Text>
                <Text style={[styles.folderTabText, isActive && styles.folderTabTextActive]}>
                  {folder}
                </Text>
                {count > 0 && (
                  <View style={[styles.folderCount, isActive && styles.folderCountActive]}>
                    <Text style={[styles.folderCountText, isActive && styles.folderCountTextActive]}>
                      {count}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search titles, transcripts, summaries, speakers..."
          placeholderTextColor="#888"
          value={searchQuery}
          onChangeText={handleSearch}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => handleSearch('')}>
            <Text style={styles.clearBtnText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Action Buttons */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate('Record')}>
          <Text style={styles.btnText}>🎙 Record</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: '#C0392B' }]}
          onPress={() => navigation.navigate('Live')}>
          <Text style={styles.btnText}>🔴 Live</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary]}
          onPress={() => navigation.navigate('Upload')}>
          <Text style={[styles.btnText, styles.btnTextSecondary]}>📁 Upload</Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {filtered.length === 0 && searchQuery.length > 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🔍</Text>
          <Text style={styles.emptyTitle}>No results found</Text>
          <Text style={styles.emptySubtitle}>
            No recordings match "{searchQuery}"{'\n'}
            Try searching for a speaker name, topic, or keyword
          </Text>
        </View>
      ) : filtered.length === 0 && activeFolder !== 'All' ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>{FOLDER_ICONS[activeFolder]}</Text>
          <Text style={styles.emptyTitle}>No recordings in {activeFolder}</Text>
          <Text style={styles.emptySubtitle}>
            Open any recording and tap the folder badge to organise it here
          </Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🎙️</Text>
          <Text style={styles.emptyTitle}>No recordings yet</Text>
          <Text style={styles.emptySubtitle}>Tap Record to capture your first conversation</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.navigate('Record')}>
            <Text style={styles.emptyBtnText}>Start Recording</Text>
          </TouchableOpacity>
        </View>
      ) : (
        renderGroupedList()
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#F0F4F8' },

  // Header
  header:        { backgroundColor: '#0D3B7A', padding: 20, paddingTop: 16,
                   flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle:   { fontSize: 24, fontWeight: 'bold', color: '#FFFFFF' },
  headerSub:     { fontSize: 13, color: '#AACFEE', marginTop: 2 },
  headerMicBtn:  { width: 44, height: 44, borderRadius: 22,
                   backgroundColor: '#1A6FC4', justifyContent: 'center', alignItems: 'center' },
  headerMicIcon: { fontSize: 20 },

  // Folder Tabs
  folderTabsWrapper: { backgroundColor: '#0D3B7A', paddingBottom: 12 },
  folderTabs:    { paddingHorizontal: 16, gap: 8, flexDirection: 'row' },
  folderTab:     { flexDirection: 'row', alignItems: 'center', gap: 4,
                   paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
                   backgroundColor: 'rgba(255,255,255,0.15)' },
  folderTabActive:     { backgroundColor: '#FFFFFF' },
  folderTabIcon:       { fontSize: 13 },
  folderTabText:       { fontSize: 12, color: '#AACFEE', fontWeight: '600' },
  folderTabTextActive: { color: '#0D3B7A' },
  folderCount:         { backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 10,
                         paddingHorizontal: 6, paddingVertical: 1, marginLeft: 2 },
  folderCountActive:      { backgroundColor: '#0D3B7A' },
  folderCountText:        { fontSize: 10, color: '#FFFFFF', fontWeight: 'bold' },
  folderCountTextActive:  { color: '#FFFFFF' },

  // Search
  searchContainer: { flexDirection: 'row', alignItems: 'center',
                     marginHorizontal: 16, marginTop: 12, marginBottom: 8,
                     backgroundColor: '#FFFFFF', borderRadius: 12,
                     paddingHorizontal: 12, paddingVertical: 4, elevation: 2 },
  searchIcon:    { fontSize: 16, marginRight: 8 },
  searchInput:   { flex: 1, padding: 10, fontSize: 15, color: '#333' },
  clearBtnText:  { fontSize: 16, color: '#888', padding: 4 },

  // Action buttons
  actions:          { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 8, gap: 12 },
  btn:              { flex: 1, backgroundColor: '#1A56A0', padding: 12,
                      borderRadius: 10, alignItems: 'center' },
  btnSecondary:     { backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#1A56A0' },
  btnText:          { color: '#FFFFFF', fontWeight: 'bold', fontSize: 14 },
  btnTextSecondary: { color: '#1A56A0' },

  // List
  list:          { paddingHorizontal: 16, paddingBottom: 30 },
  dateHeader:    { fontSize: 13, fontWeight: '700', color: '#555', marginTop: 16,
                   marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Card
  card:            { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16,
                     marginBottom: 10, elevation: 2, shadowColor: '#000',
                     shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  cardHighlighted: { borderWidth: 1.5, borderColor: '#1A56A0',
                     backgroundColor: '#F5F9FF' },
  cardHeader:      { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  avatar:          { width: 38, height: 38, borderRadius: 19, backgroundColor: '#1A56A0',
                     justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  avatarText:      { color: '#FFFFFF', fontWeight: 'bold', fontSize: 16 },
  cardMeta:        { flex: 1 },
  cardTitle:       { fontSize: 16, fontWeight: '700', color: '#111', marginBottom: 3 },
  cardSubRow:      { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  cardTime:        { fontSize: 12, color: '#888' },
  cardDuration:    { fontSize: 12, color: '#888' },
  dot:             { fontSize: 12, color: '#CCC' },
  langFlag:        { fontSize: 12 },
  folderIcon:      { fontSize: 12 },
  deleteBtn:       { padding: 4 },
  deleteBtnText:   { fontSize: 18 },

  // Search match context
  matchBox:        { backgroundColor: '#EEF4FF', borderRadius: 8,
                     padding: 10, marginBottom: 10 },
  matchBadge:      { alignSelf: 'flex-start', backgroundColor: '#1A56A0',
                     borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3,
                     marginBottom: 6 },
  matchBadgeText:  { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  matchSnippet:    { fontSize: 13, color: '#444', lineHeight: 19, fontStyle: 'italic' },

  // Bullets
  bulletsContainer: { marginBottom: 10 },
  bulletRow:        { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 },
  bulletDot:        { fontSize: 14, color: '#1A56A0', marginRight: 8, marginTop: 1 },
  bulletText:       { flex: 1, fontSize: 13, color: '#444', lineHeight: 20 },
  cardPreview:      { fontSize: 13, color: '#666', lineHeight: 20, marginBottom: 10 },

  cardFooter:      { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  footerBadge:     { backgroundColor: '#EEF3FC', paddingHorizontal: 10,
                     paddingVertical: 4, borderRadius: 20 },
  footerBadgeText: { fontSize: 11, color: '#1A56A0', fontWeight: '600' },
  aiBadge:         { backgroundColor: '#D6F0E2' },
  aiBadgeText:     { color: '#1A7A4A' },

  // Empty state
  empty:         { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon:     { fontSize: 48, marginBottom: 16 },
  emptyTitle:    { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: '#888', textAlign: 'center',
                   lineHeight: 22, marginBottom: 24 },
  emptyBtn:      { backgroundColor: '#1A56A0', paddingHorizontal: 28,
                   paddingVertical: 14, borderRadius: 12 },
  emptyBtnText:  { color: '#FFFFFF', fontWeight: 'bold', fontSize: 15 },
});