import notifee from '@notifee/react-native';
notifee.registerForegroundService((notification) => { return new Promise(() => {}); });

import React, { useState, useEffect } from 'react';
import {
  NavigationContainer,
  useNavigationContainerRef
} from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import {  
  ActivityIndicator, View, TouchableOpacity,
  Text, StyleSheet
} from 'react-native';
import { supabase } from './src/supabase';
import { RecordingProvider, useRecording } from './src/context/RecordingContext';
import LoginScreen      from './src/screens/LoginScreen';
import HomeScreen       from './src/screens/HomeScreen';
import RecordScreen     from './src/screens/RecordScreen';
import UploadScreen     from './src/screens/UploadScreen';
import TranscriptScreen from './src/screens/TranscriptScreen';
import GlobalChatScreen from './src/screens/GlobalChatScreen';
import PaywallScreen    from './src/screens/PaywallScreen';
import CalendarScreen   from './src/screens/CalendarScreen';

// ✅ CalendarScreen import is at the top — NOT as floating JSX here

const Stack = createStackNavigator();

// ─── Floating recording indicator ────────────────────────────────────────────
function FloatingRecordingBar({ navigationRef }) {
  const { isRecording, recordingTime, formatTime } = useRecording();
  if (!isRecording) return null;
  return (
    <TouchableOpacity
      style={styles.floatingBar}
      onPress={() => {
        if (navigationRef.current) {
          navigationRef.current.navigate('Record');
        }
      }}
      activeOpacity={0.9}>
      <View style={styles.floatingDot} />
      <Text style={styles.floatingText}>
        🎙 Recording — {formatTime(recordingTime)}
      </Text>
      <Text style={styles.floatingTap}>Tap to return →</Text>
    </TouchableOpacity>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigationRef = useNavigationContainerRef();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setLoading(false);
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#1A56A0" />
      </View>
    );
  }

  return (
    <RecordingProvider>
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator
          screenOptions={{
            headerStyle:      { backgroundColor: '#0D3B7A' },
            headerTintColor:  '#FFFFFF',
            headerTitleStyle: { fontWeight: 'bold' },
          }}>
          {session
            ? <>
                <Stack.Screen
                  name="Home"
                  component={HomeScreen}
                  options={{
                    title: 'VoxNote',
                    headerRight: () => <LogoutButton />
                  }}
                />
                <Stack.Screen
                  name="Record"
                  component={RecordScreen}
                  options={{ title: 'New Recording' }}
                />
                <Stack.Screen
                  name="Upload"
                  component={UploadScreen}
                  options={{ title: 'Upload Audio' }}
                />
                <Stack.Screen
                  name="Transcript"
                  component={TranscriptScreen}
                  options={{ title: 'Transcript' }}
                />
                <Stack.Screen
                  name="GlobalChat"
                  component={GlobalChatScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="Paywall"
                  component={PaywallScreen}
                  options={{
                    title: 'Upgrade to Pro',
                    headerStyle: { backgroundColor: '#0D3B7A' },
                  }}
                />
                {/* ✅ CalendarScreen correctly added inside Stack.Navigator */}
                <Stack.Screen
                  name="Calendar"
                  component={CalendarScreen}
                  options={{ headerShown: false }}
                />
              </>
            : <Stack.Screen
                name="Login"
                component={LoginScreen}
                options={{ headerShown: false }}
              />
          }
        </Stack.Navigator>

        {/* Floating bar visible on ALL screens when recording */}
        <FloatingRecordingBar navigationRef={navigationRef} />

      </NavigationContainer>
    </RecordingProvider>
  );
}

function LogoutButton() {
  const handleLogout = async () => {
    await supabase.auth.signOut();
  };
  return (
    <TouchableOpacity onPress={handleLogout} style={{ marginRight: 16 }}>
      <Text style={{ color: '#FFFFFF', fontSize: 14 }}>Logout</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  floatingBar: {
    position:          'absolute',
    bottom:            80,
    left:              16,
    right:             16,
    backgroundColor:   '#C0392B',
    borderRadius:      12,
    paddingHorizontal: 16,
    paddingVertical:   12,
    flexDirection:     'row',
    alignItems:        'center',
    elevation:         10,
    shadowColor:       '#000',
    shadowOpacity:     0.3,
    shadowRadius:      8,
    shadowOffset:      { width: 0, height: 4 },
    gap:               10,
  },
  floatingDot: {
    width:           10,
    height:          10,
    borderRadius:    5,
    backgroundColor: '#FFFFFF',
  },
  floatingText: {
    flex:       1,
    color:      '#FFFFFF',
    fontWeight: '700',
    fontSize:   14,
  },
  floatingTap: {
    color:    '#FFB3B3',
    fontSize: 11,
  },
});