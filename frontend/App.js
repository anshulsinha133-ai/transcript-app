import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { ActivityIndicator, View, TouchableOpacity, Text } from 'react-native';
import { supabase } from './src/supabase';
import LoginScreen        from './src/screens/LoginScreen';
import HomeScreen         from './src/screens/HomeScreen';
import RecordScreen       from './src/screens/RecordScreen';
import UploadScreen       from './src/screens/UploadScreen';
import TranscriptScreen   from './src/screens/TranscriptScreen';
import LiveScreen         from './src/screens/LiveScreen';
import GlobalChatScreen   from './src/screens/GlobalChatScreen'; // ✅ NEW

const Stack = createStackNavigator();

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

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
    <NavigationContainer>
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
                name="Live"
                component={LiveScreen}
                options={{
                  title: '🔴 Live Transcription',
                  headerStyle: { backgroundColor: '#C0392B' },
                }}
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
                options={{ headerShown: false }} // ✅ Has its own header
              />
            </>
          : <Stack.Screen
              name="Login"
              component={LoginScreen}
              options={{ headerShown: false }}
            />
        }
      </Stack.Navigator>
    </NavigationContainer>
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