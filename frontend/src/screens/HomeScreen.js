import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, SafeAreaView, Alert, StatusBar, TextInput,
  ScrollView, ActivityIndicator
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getAllTranscripts, deleteTranscript, searchTranscripts, saveTranscript, createTranscriptObj } from '../utils/storage';
import { getPendingJob, resumePendingTranscription } from '../services/api';
import { supabase } from '../supabase';

const FOLDERS = ['All', 'General', 'Work', 'Personal', 'Meetings', 'Lectures'];
const FOLDER_ICONS = { All:'📋', General:'🗂️', Work:'💼', Personal:'👤', Meetings:'👥', Lectures:'🎓' };

const TEMPLATE_MAP = {
  meeting:   { icon: '🤝', color: '#1A56A0' },
  sales:     { icon: '📞', color: '#059669' },
  lecture:   { icon: '🎓', color: '#7C3AED' },
  doctor:    { icon: '🏥', color: '#DC2626' },
  legal:     { icon: '⚖️', color: '#92400E' },
  interview: { icon: '👤', color: '#0369A1' },
};

const LANG_FLAGS = {
  en:'🇬🇧', hi:'🇮🇳', mr:'🏙️', te:'🔵', ta:'🔴',
  kn:'🟡', ml:'🟢', bn:'🟠', gu:'🟣', pa:'🔷', ur:'🌙',
};

const groupByDate = (transcripts) => {
  const groups = {};
  transcripts.forEach(t => {
    const date = new Date(t.createdAt);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    let label;
    if (date.toDateString() === today.toDateString()) label = 'Today';
    else if (date.toDateString() === yesterday.toDateString()) label = 'Yesterday';
    else label = date.toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short' });
    if (!groups[label]) groups[label] = [];
    groups[label].push(t);
  });
  return Object.entries(groups).map(([title, data]) => ({ title, data }));
};

const extractBullets = (autoSummary) => {
  if (!autoSummary) return [];
  try {
    const clean = autoSummary.replace(/^```json\s*/i,'').replace(/\s*```$/i,'').trim();
    const parsed = JSON.parse(clean);
    const lines = [];
    if (parsed.executive_summary) {
      if (parsed.executive_summary.main_purpose)
        lines.push(parsed.executive_summary.main_purpose);
      if (Array.isArray(parsed.executive_summary.major_conclusions))
        parsed.executive_summary.major_conclusions.slice(0,2).forEach(c => {
          if (typeof c === 'string') lines.push(c);
        });
      if (Array.isArray(parsed.key_points))
        parsed.key_points.slice(0,2).forEach(k => {
          if (typeof k === 'string') lines.push(k);
          else if (k && typeof k.key_point === 'string') lines.push(k.key_point);
        });
      return lines.slice(0,4);
    }
    if (parsed.summary) lines.push(parsed.summary);
    const extras = parsed.key_decisions || parsed.key_points || parsed.key_concepts || parsed.requirements || [];
    extras.slice(0,3).forEach(e => {
      if (typeof e === 'string') lines.push(e);
      else if (e && typeof e.key_point === 'string') lines.push(e.key_point);
      else if (e && typeof e.task === 'string') lines.push(e.task);
    });
    return lines.slice(0,4);
  } catch {}
  return autoSummary.split('\n')
    .filter(l => l.trim().match(/^[\d\-\*\•]/))
    .map(l => l.replace(/^[\d\.\-\*\•]\s*/,'').trim())
    .filter(l => l.length > 10)
    .slice(0,4);
};

const formatDuration = (seconds) => {
  if (!seconds) return null;
  const mins = Math.round(seconds / 60);
  return mins < 1 ? '< 1 min' : `${mins} min`;
};

const MATCH_LABELS = {
  title:      { icon: '📌', label: 'Title match' },
  transcript: { icon: '📝', label: 'In transcript' },
  summary:    { icon: '🤖', label: 'In summary' },
  speaker:    { icon: '🗣️', label: 'Speaker said' },
  action:     { icon: '✅', label: 'Action item' },
};

export default function HomeScreen({ navigation }) {
  const [transcripts,  setTranscripts]  = useState([]);
  const [searchQuery,  setSearchQuery]  = useState('');
  const [filtered,     setFiltered]     = useState([]);
  const [activeFolder, setActiveFolder] = useState('All');
  const [isSearching,  setIsSearching]  = useState(false);
  const [pendingJob,   setPendingJob]   = useState(null);
  const [resuming,     setResuming]     = useState(false);
  const [resumeStatus, setResumeStatus] = useState('');
  const [loading,      setLoading]      = useState(false);

  useFocusEffect(useCallback(() => {
    const loadTranscripts = async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      const data = await getAllTranscripts(user?.id);
      setTranscripts(data);
      applyFilters(data, searchQuery, activeFolder);
      setLoading(false);
    };
    loadTranscripts();
    const checkPending = async () => { setPendingJob(await getPendingJob()); };
    checkPending();
  }, []));

  const applyFilters = (data, query, folder) => {
    let results = data;
    if (folder !== 'All') results = results.filter(t => (t.folder || 'General') === folder);
    if (query.trim()) results = searchTranscripts(results, query);
    else results = results.map(t => ({ ...t, matchContext: null }));
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
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const { data: { user } } = await supabase.auth.getUser();
        await deleteTranscript(id, user?.id);
        const updated = transcripts.filter(t => t.id !== id);
        setTranscripts(updated);
        applyFilters(updated, searchQuery, activeFolder);
      }}
    ]);
  };

  const handleResume = async () => {
    setResuming(true);
    setResumeStatus('Connecting to server...');
    try {
      const result = await resumePendingTranscription((msg, pct) => {
        setResumeStatus(pct ? `${msg} ${pct}%` : msg);
      });
      if (result.success) {
        setResumeStatus('Saving transcript...');
        const title = result.smartTitle || 'Recording ' + new Date().toLocaleDateString('en-IN');
        const text  = result.englishText || result.text ||
                      result.utterances?.map(u => u.englishText || u.text).join(' ') || 'Recording saved';
        const obj = {
          ...createTranscriptObj(title, text, result.duration || 0),
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
        const saved = await saveTranscript(obj);
        if (saved && saved.success) {
          obj.id = saved.id;
          setPendingJob(null); setResuming(false); setResumeStatus('');
          const { data: { user } } = await supabase.auth.getUser();
          const data = await getAllTranscripts(user?.id);
          setTranscripts(data);
          applyFilters(data, searchQuery, activeFolder);
          Alert.alert('✅ Recovered!', `"${title}" has been saved successfully.`);
        } else {
          setResuming(false); setResumeStatus('');
          Alert.alert('Error', 'Transcript recovered but could not be saved. Try again.');
        }
      } else if (result.canResume) {
        setResuming(false); setResumeStatus('');
        Alert.alert('Still Processing', 'Your recording is still being transcribed. Try again in a minute.');
      } else {
        setResuming(false); setResumeStatus('');
        Alert.alert('Error', result.error || 'Could not resume transcription.');
      }
    } catch (err) {
      setResuming(false); setResumeStatus('');
      Alert.alert('Error', err.message);
    }
  };

  const getFolderCount = (folder) => {
    if (folder === 'All') return transcripts.length;
    return transcripts.filter(t => (t.folder || 'General') === folder).length;
  };

  const renderMatchContext = (matchContext) => {
    if (!matchContext) return null;
    const meta = MATCH_LABELS[matchContext.field] || { icon: '🔍', label: 'Match' };
    return (
      <View style={styles.matchBox}>
        <View style={styles.matchBadge}>
          <Text style={styles.matchBadgeText}>
            {meta.icon} {matchContext.speaker ? `${matchContext.speaker} said` : meta.label}
          </Text>
        </View>
        {matchContext.snippet && (
          <Text style={styles.matchSnippet} numberOfLines={2}>{matchContext.snippet}</Text>
        )}
      </View>
    );
  };

  // ── renderCard: NO calendar button here — it belongs in the actions row ──
  const renderCard = (item) => {
    const bullets    = item.matchContext ? [] : extractBullets(item.autoSummary);
    const duration   = formatDuration(item.duration);
    const time       = new Date(item.createdAt).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true });
    const langFlag   = LANG_FLAGS[item.detectedLang] || '🇬🇧';
    const folderIcon = FOLDER_ICONS[item.folder || 'General'] || '🗂️';
    const template   = TEMPLATE_MAP[item.mode] || null;

    return (
      <TouchableOpacity
        key={item.id}
        style={[styles.card, item.matchContext && styles.cardHighlighted]}
        onPress={() => navigation.navigate('Transcript', { transcript: item })}
        activeOpacity={0.85}>
        <View style={styles.cardHeader}>
          <View style={[styles.avatar, template ? { backgroundColor: template.color } : {}]}>
            <Text style={styles.avatarText}>
              {template ? template.icon : (item.title?.charAt(0)?.toUpperCase() || 'V')}
            </Text>
          </View>
          <View style={styles.cardMeta}>
            <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
            <View style={styles.cardSubRow}>
              <Text style={styles.cardTime}>{time}</Text>
              {duration && <><Text style={styles.dot}>·</Text><Text style={styles.cardDuration}>{duration}</Text></>}
              <Text style={styles.dot}>·</Text>
              <Text style={styles.langFlag}>{langFlag}</Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.folderIcon}>{folderIcon}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id)}
            hitSlop={{ top:10, bottom:10, left:10, right:10 }}>
            <Text style={styles.deleteBtnText}>🗑</Text>
          </TouchableOpacity>
        </View>

        {item.matchContext ? renderMatchContext(item.matchContext)
          : bullets.length > 0 ? (
            <View style={styles.bulletsContainer}>
              {bullets.map((bullet, i) => (
                <View key={i} style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bulletText} numberOfLines={1}>{bullet}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.cardPreview} numberOfLines={2}>{item.englishText || item.text}</Text>
          )
        }

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
              <Text style={[styles.footerBadgeText, styles.aiBadgeText]}>🤖 AI Notes</Text>
            </View>
          )}
          {template && (
            <View style={[styles.footerBadge, { backgroundColor: template.color + '20' }]}>
              <Text style={[styles.footerBadgeText, { color: template.color }]}>
                {template.icon} {item.mode.charAt(0).toUpperCase() + item.mode.slice(1)}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

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

      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>VoxNote</Text>
          <Text style={styles.headerSub}>
            {isSearching
              ? `${filtered.length} result${filtered.length !== 1 ? 's' : ''} for "${searchQuery}"`
              : `${filtered.length} recording${filtered.length !== 1 ? 's' : ''}`}
          </Text>
        </View>
        <TouchableOpacity style={styles.headerMicBtn} onPress={() => navigation.navigate('Record')}>
          <Text style={styles.headerMicIcon}>🎙️</Text>
        </TouchableOpacity>
      </View>

      {pendingJob && (
        <TouchableOpacity style={[styles.resumeBanner, resuming && { opacity:0.7 }]}
          onPress={handleResume} disabled={resuming}>
          {resuming
            ? <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight:10 }} />
            : <Text style={styles.resumeIcon}>⏳</Text>}
          <View style={styles.resumeTextWrapper}>
            <Text style={styles.resumeTitle}>{resuming ? 'Recovering recording...' : 'Pending recording found'}</Text>
            <Text style={styles.resumeSubtitle}>{resuming ? resumeStatus : 'Tap to resume transcription'}</Text>
          </View>
          {!resuming && <Text style={styles.resumeArrow}>›</Text>}
        </TouchableOpacity>
      )}

      <View style={styles.folderTabsWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.folderTabs}>
          {FOLDERS.map(folder => {
            const count = getFolderCount(folder);
            const isActive = folder === activeFolder;
            return (
              <TouchableOpacity key={folder}
                style={[styles.folderTab, isActive && styles.folderTabActive]}
                onPress={() => handleFolderChange(folder)}>
                <Text style={styles.folderTabIcon}>{FOLDER_ICONS[folder]}</Text>
                <Text style={[styles.folderTabText, isActive && styles.folderTabTextActive]}>{folder}</Text>
                {count > 0 && (
                  <View style={[styles.folderCount, isActive && styles.folderCountActive]}>
                    <Text style={[styles.folderCountText, isActive && styles.folderCountTextActive]}>{count}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.searchContainer}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput style={styles.searchInput}
          placeholder="Search titles, transcripts, summaries, speakers..."
          placeholderTextColor="#888" value={searchQuery} onChangeText={handleSearch} />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => handleSearch('')}>
            <Text style={styles.clearBtnText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Action buttons: Record + Upload + Calendar ── */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.btnRecord} onPress={() => navigation.navigate('Record')}>
          <Text style={styles.btnIcon}>🎙</Text>
          <Text style={styles.btnText}>Record</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnUpload} onPress={() => navigation.navigate('Upload')}>
          <Text style={styles.btnIcon}>📁</Text>
          <Text style={styles.btnTextSecondary}>Upload</Text>
        </TouchableOpacity>
        {/* ✅ Calendar button — correctly placed here, not inside renderCard */}
        <TouchableOpacity style={styles.btnCalendar} onPress={() => navigation.navigate('Calendar')}>
          <Text style={styles.btnIcon}>📅</Text>
          <Text style={styles.btnTextCalendar}>Calendar</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.globalChatBtn} onPress={() => navigation.navigate('GlobalChat')}>
        <Text style={styles.globalChatIcon}>💬</Text>
        <View style={styles.globalChatTextWrapper}>
          <Text style={styles.globalChatTitle}>Ask AI across all recordings</Text>
          <Text style={styles.globalChatSub}>What was discussed? Any action items?</Text>
        </View>
        <Text style={styles.globalChatArrow}>›</Text>
      </TouchableOpacity>

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#1A56A0" />
          <Text style={styles.loadingText}>Loading your recordings...</Text>
        </View>
      )}

      {!loading && filtered.length === 0 && searchQuery.length > 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🔍</Text>
          <Text style={styles.emptyTitle}>No results found</Text>
          <Text style={styles.emptySubtitle}>No recordings match "{searchQuery}"{'\n'}Try searching for a speaker name, topic, or keyword</Text>
        </View>
      ) : !loading && filtered.length === 0 && activeFolder !== 'All' ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>{FOLDER_ICONS[activeFolder]}</Text>
          <Text style={styles.emptyTitle}>No recordings in {activeFolder}</Text>
          <Text style={styles.emptySubtitle}>Open any recording and tap the folder badge to organise it here</Text>
        </View>
      ) : !loading && filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🎙️</Text>
          <Text style={styles.emptyTitle}>No recordings yet</Text>
          <Text style={styles.emptySubtitle}>Tap Record to capture your first conversation</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.navigate('Record')}>
            <Text style={styles.emptyBtnText}>Start Recording</Text>
          </TouchableOpacity>
        </View>
      ) : renderGroupedList()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:            { flex:1, backgroundColor:'#F0F4F8' },
  header:               { backgroundColor:'#0D3B7A', padding:20, paddingTop:16, flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
  headerTitle:          { fontSize:24, fontWeight:'bold', color:'#FFFFFF' },
  headerSub:            { fontSize:13, color:'#AACFEE', marginTop:2 },
  headerMicBtn:         { width:44, height:44, borderRadius:22, backgroundColor:'#1A6FC4', justifyContent:'center', alignItems:'center' },
  headerMicIcon:        { fontSize:20 },
  resumeBanner:         { backgroundColor:'#E65100', flexDirection:'row', alignItems:'center', paddingHorizontal:16, paddingVertical:12, gap:10 },
  resumeIcon:           { fontSize:20 },
  resumeTextWrapper:    { flex:1 },
  resumeTitle:          { color:'#FFFFFF', fontWeight:'700', fontSize:14 },
  resumeSubtitle:       { color:'#FFD0B0', fontSize:12, marginTop:2 },
  resumeArrow:          { color:'#FFFFFF', fontSize:24, fontWeight:'bold' },
  folderTabsWrapper:    { backgroundColor:'#0D3B7A', paddingBottom:12 },
  folderTabs:           { paddingHorizontal:16, gap:8, flexDirection:'row' },
  folderTab:            { flexDirection:'row', alignItems:'center', gap:4, paddingHorizontal:12, paddingVertical:7, borderRadius:20, backgroundColor:'rgba(255,255,255,0.15)' },
  folderTabActive:      { backgroundColor:'#FFFFFF' },
  folderTabIcon:        { fontSize:13 },
  folderTabText:        { fontSize:12, color:'#AACFEE', fontWeight:'600' },
  folderTabTextActive:  { color:'#0D3B7A' },
  folderCount:          { backgroundColor:'rgba(255,255,255,0.3)', borderRadius:10, paddingHorizontal:6, paddingVertical:1, marginLeft:2 },
  folderCountActive:    { backgroundColor:'#0D3B7A' },
  folderCountText:      { fontSize:10, color:'#FFFFFF', fontWeight:'bold' },
  folderCountTextActive:{ color:'#FFFFFF' },
  searchContainer:      { flexDirection:'row', alignItems:'center', marginHorizontal:16, marginTop:12, marginBottom:8, backgroundColor:'#FFFFFF', borderRadius:12, paddingHorizontal:12, paddingVertical:4, elevation:2 },
  searchIcon:           { fontSize:16, marginRight:8 },
  searchInput:          { flex:1, padding:10, fontSize:15, color:'#333' },
  clearBtnText:         { fontSize:16, color:'#888', padding:4 },
  actions:              { flexDirection:'row', paddingHorizontal:16, paddingBottom:8, gap:8 },
  btnRecord:            { flex:1, backgroundColor:'#1A56A0', padding:12, borderRadius:12,
                          alignItems:'center', flexDirection:'row', justifyContent:'center', gap:6 },
  btnUpload:            { flex:1, backgroundColor:'#FFFFFF', padding:12, borderRadius:12,
                          alignItems:'center', flexDirection:'row', justifyContent:'center',
                          gap:6, borderWidth:1.5, borderColor:'#1A56A0' },
  btnCalendar:          { flex:1, backgroundColor:'#FFFFFF', padding:12, borderRadius:12,
                          alignItems:'center', flexDirection:'row', justifyContent:'center',
                          gap:6, borderWidth:1.5, borderColor:'#0D3B7A' },
  btnIcon:              { fontSize:16 },
  btnText:              { color:'#FFFFFF', fontWeight:'bold', fontSize:13 },
  btnTextSecondary:     { color:'#1A56A0', fontWeight:'bold', fontSize:13 },
  btnTextCalendar:      { color:'#0D3B7A', fontWeight:'bold', fontSize:13 },
  globalChatBtn:        { flexDirection:'row', alignItems:'center', backgroundColor:'#6C3FA0', marginHorizontal:16, marginBottom:8, padding:14, borderRadius:12, gap:12 },
  globalChatIcon:       { fontSize:22 },
  globalChatTextWrapper:{ flex:1 },
  globalChatTitle:      { color:'#FFFFFF', fontWeight:'700', fontSize:14 },
  globalChatSub:        { color:'#DDD0FF', fontSize:11, marginTop:2 },
  globalChatArrow:      { color:'#FFFFFF', fontSize:24, fontWeight:'bold' },
  loadingRow:           { flexDirection:'row', alignItems:'center', justifyContent:'center', gap:10, paddingVertical:16 },
  loadingText:          { fontSize:13, color:'#1A56A0' },
  list:                 { paddingHorizontal:16, paddingBottom:30 },
  dateHeader:           { fontSize:13, fontWeight:'700', color:'#555', marginTop:16, marginBottom:8, textTransform:'uppercase', letterSpacing:0.5 },
  card:                 { backgroundColor:'#FFFFFF', borderRadius:14, padding:16, marginBottom:10, elevation:2, shadowColor:'#000', shadowOpacity:0.06, shadowRadius:6, shadowOffset:{ width:0, height:2 } },
  cardHighlighted:      { borderWidth:1.5, borderColor:'#1A56A0', backgroundColor:'#F5F9FF' },
  cardHeader:           { flexDirection:'row', alignItems:'flex-start', marginBottom:10 },
  avatar:               { width:38, height:38, borderRadius:19, backgroundColor:'#1A56A0', justifyContent:'center', alignItems:'center', marginRight:12 },
  avatarText:           { color:'#FFFFFF', fontWeight:'bold', fontSize:16 },
  cardMeta:             { flex:1 },
  cardTitle:            { fontSize:16, fontWeight:'700', color:'#111', marginBottom:3 },
  cardSubRow:           { flexDirection:'row', alignItems:'center', gap:4, flexWrap:'wrap' },
  cardTime:             { fontSize:12, color:'#888' },
  cardDuration:         { fontSize:12, color:'#888' },
  dot:                  { fontSize:12, color:'#CCC' },
  langFlag:             { fontSize:12 },
  folderIcon:           { fontSize:12 },
  deleteBtn:            { padding:4 },
  deleteBtnText:        { fontSize:18 },
  matchBox:             { backgroundColor:'#EEF4FF', borderRadius:8, padding:10, marginBottom:10 },
  matchBadge:           { alignSelf:'flex-start', backgroundColor:'#1A56A0', borderRadius:12, paddingHorizontal:10, paddingVertical:3, marginBottom:6 },
  matchBadgeText:       { color:'#FFFFFF', fontSize:11, fontWeight:'700' },
  matchSnippet:         { fontSize:13, color:'#444', lineHeight:19, fontStyle:'italic' },
  bulletsContainer:     { marginBottom:10 },
  bulletRow:            { flexDirection:'row', alignItems:'flex-start', marginBottom:4 },
  bulletDot:            { fontSize:14, color:'#1A56A0', marginRight:8, marginTop:1 },
  bulletText:           { flex:1, fontSize:13, color:'#444', lineHeight:20 },
  cardPreview:          { fontSize:13, color:'#666', lineHeight:20, marginBottom:10 },
  cardFooter:           { flexDirection:'row', gap:8, flexWrap:'wrap' },
  footerBadge:          { backgroundColor:'#EEF3FC', paddingHorizontal:10, paddingVertical:4, borderRadius:20 },
  footerBadgeText:      { fontSize:11, color:'#1A56A0', fontWeight:'600' },
  aiBadge:              { backgroundColor:'#D6F0E2' },
  aiBadgeText:          { color:'#1A7A4A' },
  empty:                { flex:1, justifyContent:'center', alignItems:'center', padding:40 },
  emptyIcon:            { fontSize:48, marginBottom:16 },
  emptyTitle:           { fontSize:20, fontWeight:'bold', color:'#333', marginBottom:8 },
  emptySubtitle:        { fontSize:14, color:'#888', textAlign:'center', lineHeight:22, marginBottom:24 },
  emptyBtn:             { backgroundColor:'#1A56A0', paddingHorizontal:28, paddingVertical:14, borderRadius:12 },
  emptyBtnText:         { color:'#FFFFFF', fontWeight:'bold', fontSize:15 },
});