import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, { TriggerType } from '@notifee/react-native';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const NOTIF_IDS_KEY = 'voxnote_calendar_notif_ids';

// ─── Map Google Calendar event types to VoxNote templates ────────────────────
const MEETING_KEYWORDS = {
  meeting:   ['meeting', 'sync', 'standup', 'stand-up', 'review', 'check-in', 'call', 'discuss'],
  sales:     ['demo', 'sales', 'pitch', 'client', 'prospect', 'deal', 'proposal'],
  interview: ['interview', 'screening', 'candidate', 'hiring'],
  doctor:    ['doctor', 'clinic', 'hospital', 'appointment', 'consult', 'medical'],
  lecture:   ['lecture', 'class', 'training', 'workshop', 'webinar', 'course', 'seminar'],
  legal:     ['legal', 'lawyer', 'attorney', 'court', 'contract', 'hearing'],
};

export const detectMeetingTemplate = (title = '') => {
  const lower = title.toLowerCase();
  for (const [template, keywords] of Object.entries(MEETING_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return template;
  }
  return 'meeting'; // default
};

// ─── Format event time nicely ─────────────────────────────────────────────────
export const formatEventTime = (event) => {
  if (event.start?.dateTime) {
    const start = new Date(event.start.dateTime);
    const end   = new Date(event.end?.dateTime || event.start.dateTime);
    return {
      time:     start.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
      endTime:  end.toLocaleTimeString('en-IN',   { hour: '2-digit', minute: '2-digit', hour12: true }),
      duration: Math.round((end - start) / 60000), // minutes
      isAllDay: false,
    };
  }
  return { time: 'All day', endTime: '', duration: null, isAllDay: true };
};

// ─── Check if event has a Google Meet link ────────────────────────────────────
export const hasMeetLink = (event) => {
  return !!(
    event.hangoutLink ||
    event.conferenceData?.entryPoints?.some(ep => ep.entryPointType === 'video')
  );
};

// ─── Get number of attendees ──────────────────────────────────────────────────
export const getAttendeeCount = (event) => {
  return event.attendees?.length || 0;
};

// ─── Fetch upcoming events (today + tomorrow) ─────────────────────────────────
export const getUpcomingEvents = async (accessToken) => {
  try {
    const now      = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(now.getDate() + 2);
    tomorrow.setHours(0, 0, 0, 0);

    const params = new URLSearchParams({
      timeMin:      now.toISOString(),
      timeMax:      tomorrow.toISOString(),
      maxResults:   '15',
      orderBy:      'startTime',
      singleEvents: 'true',
    });

    const response = await fetch(
      `${CALENDAR_API}/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Calendar API error');
    }

    const data = await response.json();
    const events = (data.items || [])
      .filter(e => e.status !== 'cancelled')
      .map(e => ({
        id:          e.id,
        title:       e.summary || 'Untitled event',
        description: e.description || null,
        location:    e.location || null,
        hasMeet:     hasMeetLink(e),
        attendees:   getAttendeeCount(e),
        template:    detectMeetingTemplate(e.summary),
        ...formatEventTime(e),
        rawStart:    e.start?.dateTime || e.start?.date,
      }));

    return { success: true, events };
  } catch (err) {
    console.error('Calendar fetch error:', err.message);
    return { success: false, error: err.message, events: [] };
  }
};

// ─── Schedule push notifications 5 min before each event ─────────────────────
export const scheduleEventReminders = async (events) => {
  try {
    // Cancel previous calendar notifications
    const prevIds = JSON.parse(await AsyncStorage.getItem(NOTIF_IDS_KEY) || '[]');
    for (const id of prevIds) {
      try { await notifee.cancelNotification(id); } catch {}
    }

    const channelId = await notifee.createChannel({
      id:   'calendar',
      name: 'Meeting reminders',
    });

    const newIds = [];
    const now = Date.now();

    for (const event of events) {
      if (event.isAllDay || !event.rawStart) continue;
      const startMs    = new Date(event.rawStart).getTime();
      const reminderMs = startMs - 5 * 60 * 1000; // 5 minutes before
      if (reminderMs <= now) continue;

      const id = await notifee.createTriggerNotification(
        {
          title: `Meeting in 5 minutes`,
          body:  event.title,
          data:  { eventTitle: event.title, template: event.template },
          android: {
            channelId,
            smallIcon:  'ic_notification',
            pressAction: { id: 'default' },
            actions: [{
              title:       'Start recording',
              pressAction: { id: 'record', launchActivity: 'default' },
            }],
          },
        },
        { type: TriggerType.TIMESTAMP, timestamp: reminderMs }
      );
      newIds.push(id);
    }

    await AsyncStorage.setItem(NOTIF_IDS_KEY, JSON.stringify(newIds));
    console.log(`Scheduled ${newIds.length} meeting reminders`);
  } catch (err) {
    console.error('Failed to schedule reminders:', err.message);
  }
};

// ─── Group events into today / tomorrow sections ──────────────────────────────
export const groupEventsByDay = (events) => {
  const today     = new Date();
  const todayStr  = today.toDateString();
  const tomorrowStr = new Date(today.getTime() + 86400000).toDateString();

  const groups = { Today: [], Tomorrow: [] };

  for (const event of events) {
    if (!event.rawStart) continue;
    const d = new Date(event.rawStart).toDateString();
    if (d === todayStr)     groups.Today.push(event);
    else if (d === tomorrowStr) groups.Tomorrow.push(event);
  }

  return Object.entries(groups).filter(([, evts]) => evts.length > 0);
};