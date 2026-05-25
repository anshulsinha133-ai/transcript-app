import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView, StatusBar,
  ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  useGoogleCalendarAuth,
  getGoogleToken,
  getGoogleEmail,
  clearGoogleToken,
  isGoogleConnected,
} from '../services/googleAuth';
import {
  getUpcomingEvents,
  groupEventsByDay,
  scheduleEventReminders,
} from '../services/googleCalendar';

const TEMPLATE_COLORS = {
  meeting:   { bg: '#E8F0FC', text: '#1A56A0', border: '#1A56A0' },
  sales:     { bg: '#ECFDF5', text: '#059669', border: '#059669' },
  interview: { bg: '#F0F9FF', text: '#0369A1', border: '#0369A1' },
  doctor:    { bg: '#FEF2F2', text: '#DC2626', border: '#DC2626' },
  lecture:   { bg: '#F5F3FF', text: '#7C3AED', border: '#7C3AED' },
  legal:     { bg: '#FFFBEB', text: '#92400E', border: '#92400E' },
};

const TEMPLATE_ICONS = {
  meeting:   '🤝', sales: '📞', interview: '👤',
  doctor:    '🏥', lecture: '🎓', legal: '⚖️',
};

export default function CalendarScreen({ navigation }) {
  const [connected,  setConnected]  = useState(false);
  const [email,      setEmail]      = useState(null);
  const [events,     setEvents]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);

  // ─── Google auth hook ────────────────────────────────────────────────────
  const { response, promptAsync, handleResponse } = useGoogleCalendarAuth(
    async (token, userEmail) => {
      setConnected(true);
      setEmail(userEmail);
      await loadEvents(token);
    }
  );

  // Handle OAuth response
  useEffect(() => {
    if (response) handleResponse();
  }, [response]);

  // ─── Load events ─────────────────────────────────────────────────────────
  const loadEvents = async (token = null) => {
    try {
      const accessToken = token || await getGoogleToken();
      if (!accessToken) { setLoading(false); return; }

      const result = await getUpcomingEvents(accessToken);
      if (result.success) {
        setEvents(result.events);
        setError(null);
        await scheduleEventReminders(result.events);
      } else {
        setError(result.error);
        // Token may be expired — clear it
        if (result.error?.includes('401') || result.error?.includes('unauthorized')) {
          await clearGoogleToken();
          setConnected(false);
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // ─── Check connection on focus ────────────────────────────────────────────
  useFocusEffect(useCallback(() => {
    const check = async () => {
      setLoading(true);
      const connected = await isGoogleConnected();
      const userEmail = await getGoogleEmail();
      setConnected(connected);
      setEmail(userEmail);
      if (connected) await loadEvents();
      else setLoading(false);
    };
    check();
  }, []));

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadEvents();
  };

  const handleDisconnect = () => {
    Alert.alert(
      'Disconnect Google Calendar',
      'Your calendar events will no longer appear in VoxNote.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: async () => {
          await clearGoogleToken();
          setConnected(false);
          setEvents([]);
          setEmail(null);
        }},
      ]
    );
  };

  const handleRecordFromEvent = (event) => {
    navigation.navigate('Record', {
      meetingContext: {
        title:    event.title,
        template: event.template,
        attendees: event.attendees,
        hasMeet:  event.hasMeet,
      },
    });
  };

  // ─── Connect banner (not connected yet) ──────────────────────────────────
  const renderConnectBanner = () => (
    <View style={styles.connectBox}>
      <Text style={styles.connectIcon}>📅</Text>
      <Text style={styles.connectTitle}>Connect Google Calendar</Text>
      <Text style={styles.connectDesc}>
        See your upcoming meetings, get 5-minute recording reminders,
        and auto-fill meeting titles when you start recording.
      </Text>
      <TouchableOpacity style={styles.connectBtn} onPress={() => promptAsync()}>
        <Text style={styles.connectBtnText}>Connect Google Account</Text>
      </TouchableOpacity>
      <Text style={styles.connectNote}>
        VoxNote only reads your calendar — it never modifies events.
      </Text>
    </View>
  );

  // ─── Event card ───────────────────────────────────────────────────────────
  const renderEventCard = (event) => {
    const colors = TEMPLATE_COLORS[event.template] || TEMPLATE_COLORS.meeting;
    return (
      <View key={event.id} style={styles.eventCard}>
        <View style={styles.eventLeft}>
          <View style={[styles.templateDot, { backgroundColor: colors.border }]} />
          <View style={styles.eventTime}>
            <Text style={styles.eventTimeText}>{event.time}</Text>
            {event.endTime && (
              <Text style={styles.eventEndTime}>{event.endTime}</Text>
            )}
            {event.duration && (
              <Text style={styles.eventDuration}>{event.duration}m</Text>
            )}
          </View>
        </View>

        <View style={styles.eventBody}>
          <View style={styles.eventHeader}>
            <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
            <View style={[styles.templateBadge, { backgroundColor: colors.bg }]}>
              <Text style={[styles.templateBadgeText, { color: colors.text }]}>
                {TEMPLATE_ICONS[event.template]} {event.template}
              </Text>
            </View>
          </View>

          <View style={styles.eventMeta}>
            {event.hasMeet && (
              <View style={styles.metaBadge}>
                <Text style={styles.metaBadgeText}>📹 Google Meet</Text>
              </View>
            )}
            {event.attendees > 0 && (
              <View style={styles.metaBadge}>
                <Text style={styles.metaBadgeText}>👥 {event.attendees} people</Text>
              </View>
            )}
            {event.location && !event.hasMeet && (
              <View style={styles.metaBadge}>
                <Text style={styles.metaBadgeText} numberOfLines={1}>
                  📍 {event.location.slice(0, 30)}{event.location.length > 30 ? '…' : ''}
                </Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[styles.recordBtn, { backgroundColor: colors.border }]}
            onPress={() => handleRecordFromEvent(event)}>
            <Text style={styles.recordBtnText}>🎙 Start recording</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ─── Main render ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0D3B7A" />

      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Calendar</Text>
          {email && <Text style={styles.headerSub}>{email}</Text>}
        </View>
        {connected && (
          <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect}>
            <Text style={styles.disconnectText}>Disconnect</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#1A56A0" />
          <Text style={styles.loadingText}>
            {connected ? 'Loading your meetings...' : 'Checking connection...'}
          </Text>
        </View>
      ) : !connected ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          {renderConnectBanner()}
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#1A56A0" />
          }>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️ {error}</Text>
              <TouchableOpacity onPress={() => loadEvents()}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {events.length === 0 && !error ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>🗓</Text>
              <Text style={styles.emptyTitle}>No meetings today or tomorrow</Text>
              <Text style={styles.emptyDesc}>Pull down to refresh</Text>
            </View>
          ) : (
            groupEventsByDay(events).map(([day, dayEvents]) => (
              <View key={day}>
                <Text style={styles.dayHeader}>{day}</Text>
                {dayEvents.map(event => renderEventCard(event))}
              </View>
            ))
          )}

          <View style={styles.reminderNote}>
            <Text style={styles.reminderNoteText}>
              🔔 VoxNote will remind you 5 minutes before each meeting
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: '#F0F4F8' },
  header:            { backgroundColor: '#0D3B7A', padding: 20, paddingTop: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle:       { fontSize: 22, fontWeight: 'bold', color: '#FFFFFF' },
  headerSub:         { fontSize: 12, color: '#AACFEE', marginTop: 2 },
  disconnectBtn:     { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8 },
  disconnectText:    { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  scroll:            { padding: 16, paddingBottom: 40 },
  loadingBox:        { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText:       { fontSize: 14, color: '#1A56A0' },

  connectBox:        { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24, alignItems: 'center', marginTop: 20 },
  connectIcon:       { fontSize: 48, marginBottom: 16 },
  connectTitle:      { fontSize: 20, fontWeight: 'bold', color: '#0D3B7A', marginBottom: 10, textAlign: 'center' },
  connectDesc:       { fontSize: 14, color: '#555', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  connectBtn:        { backgroundColor: '#1A56A0', paddingHorizontal: 28, paddingVertical: 14, borderRadius: 12, width: '100%', alignItems: 'center', marginBottom: 12 },
  connectBtnText:    { color: '#FFFFFF', fontWeight: 'bold', fontSize: 15 },
  connectNote:       { fontSize: 11, color: '#888', textAlign: 'center' },

  dayHeader:         { fontSize: 12, fontWeight: '700', color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 8 },

  eventCard:         { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', gap: 12, elevation: 1 },
  eventLeft:         { alignItems: 'center', width: 56 },
  templateDot:       { width: 4, height: 4, borderRadius: 2, marginBottom: 6 },
  eventTime:         { alignItems: 'center' },
  eventTimeText:     { fontSize: 13, fontWeight: '700', color: '#0D3B7A' },
  eventEndTime:      { fontSize: 11, color: '#888', marginTop: 1 },
  eventDuration:     { fontSize: 10, color: '#AAA', marginTop: 2 },

  eventBody:         { flex: 1 },
  eventHeader:       { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  eventTitle:        { flex: 1, fontSize: 14, fontWeight: '700', color: '#111', lineHeight: 20 },
  templateBadge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, flexShrink: 0 },
  templateBadgeText: { fontSize: 11, fontWeight: '600' },

  eventMeta:         { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  metaBadge:         { backgroundColor: '#F0F4F8', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  metaBadgeText:     { fontSize: 11, color: '#555' },

  recordBtn:         { paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  recordBtnText:     { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },

  errorBox:          { backgroundColor: '#FFF3F3', borderRadius: 10, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  errorText:         { fontSize: 13, color: '#C0392B', flex: 1 },
  retryText:         { fontSize: 13, color: '#1A56A0', fontWeight: '600', marginLeft: 8 },

  emptyBox:          { alignItems: 'center', paddingVertical: 60 },
  emptyIcon:         { fontSize: 48, marginBottom: 16 },
  emptyTitle:        { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 6 },
  emptyDesc:         { fontSize: 13, color: '#888' },

  reminderNote:      { backgroundColor: '#EFF4FF', borderRadius: 10, padding: 12, marginTop: 16, alignItems: 'center' },
  reminderNoteText:  { fontSize: 12, color: '#1A56A0' },
});