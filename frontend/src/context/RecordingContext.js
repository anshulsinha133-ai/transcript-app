import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { Alert, AppState, Platform, Linking } from 'react-native';
import { Audio } from 'expo-av';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, { AndroidImportance } from '@notifee/react-native';

const RecordingContext = createContext(null);

export const useRecording = () => {
  const context = useContext(RecordingContext);
  if (!context) throw new Error('useRecording must be used within RecordingProvider');
  return context;
};

export const RecordingProvider = ({ children }) => {
  const [isRecording,   setIsRecording]   = useState(false);
  const [isProcessing,  setIsProcessing]  = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [statusText,    setStatusText]    = useState('Tap to start recording');
  const [recordingUri,  setRecordingUri]  = useState(null);

  const recordingRef = useRef(null);
  const timerRef     = useRef(null);
  const startTimeRef = useRef(null);
  const appStateRef  = useRef(AppState.currentState);
  const appStateSub  = useRef(null);

  useEffect(() => {
    appStateSub.current = AppState.addEventListener('change', (nextState) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextState === 'active' &&
        isRecording &&
        startTimeRef.current
      ) {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setRecordingTime(elapsed);
      }
      appStateRef.current = nextState;
    });
    return () => { appStateSub.current?.remove(); };
  }, [isRecording]);

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      appStateSub.current?.remove();
    };
  }, []);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // ─── Start foreground service notification (keeps recording alive) ────────
  const startForegroundService = async () => {
    if (Platform.OS !== 'android') return;
    try {
      // Create notification channel
      const channelId = await notifee.createChannel({
        id:         'recording',
        name:       'VoxNote Recording',
        importance: AndroidImportance.LOW,
        sound:      null,
        vibration:  false,
      });

      // Display foreground service notification
      // This is what keeps Android from killing the recording when screen locks
      await notifee.displayNotification({
        id:    'voxnote-recording',
        title: '🎙 VoxNote is Recording',
        body:  'Recording in progress — screen can be locked safely',
        android: {
          channelId,
          asForegroundService: true,  // ← THIS is the key — true foreground service
          ongoing:             true,
          pressAction:         { id: 'default' },
          color:               '#1A56A0',
          smallIcon:           'ic_launcher',
          importance:          AndroidImportance.LOW,
        },
      });
      console.log('Foreground service notification started');
    } catch (e) {
      console.warn('Could not start foreground service:', e.message);
    }
  };

  const stopForegroundService = async () => {
    if (Platform.OS !== 'android') return;
    try {
      await notifee.stopForegroundService();
      await notifee.cancelNotification('voxnote-recording');
      console.log('Foreground service stopped');
    } catch (e) {
      console.warn('Could not stop foreground service:', e.message);
    }
  };

  // ─── Battery optimization check ───────────────────────────────────────────
  const checkBatteryOptimization = async () => {
    if (Platform.OS !== 'android') return;
    try {
      const hasAsked = await AsyncStorage.getItem('voxnote_battery_asked');
      if (!hasAsked) {
        await AsyncStorage.setItem('voxnote_battery_asked', 'true');
        Alert.alert(
          '🔋 Enable Background Recording',
          'To keep recording when the screen is locked, tap "Allow" to disable battery optimization for VoxNote.',
          [
            {
              text: '✅ Allow',
              onPress: async () => {
                try {
                  await Linking.sendIntent(
                    'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
                    [{ key: 'package', value: 'com.voxnote.app' }]
                  );
                } catch (e) {
                  await Linking.openSettings();
                }
              },
            },
            { text: 'Skip', style: 'cancel' },
          ]
        );
      }
    } catch (e) { console.log('Battery check error:', e.message); }
  };

  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission needed', 'Please allow microphone access');
        return false;
      }

      // Request notification permission (needed for foreground service on Android 13+)
      await notifee.requestPermission();

      // Check battery optimization
      await checkBatteryOptimization();

      await Audio.setAudioModeAsync({
        allowsRecordingIOS:         true,
        playsInSilentModeIOS:       true,
        staysActiveInBackground:    true,
        interruptionModeIOS:        1,
        shouldDuckAndroid:          false,
        interruptionModeAndroid:    1,
        playThroughEarpieceAndroid: false,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = recording;
      startTimeRef.current = Date.now();

      // Start foreground service AFTER recording starts
      // This shows notification and prevents Android from killing the process
      await startForegroundService();
      await activateKeepAwakeAsync('recording');

      setIsRecording(true);
      setRecordingTime(0);
      setStatusText('Recording... speak now');
      setRecordingUri(null);

      timerRef.current = setInterval(() => {
        if (startTimeRef.current) {
          setRecordingTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }
      }, 1000);

      return true;

    } catch (err) {
      console.error('startRecording error:', err.message);
      Alert.alert('Error', 'Could not start recording: ' + err.message);
      return false;
    }
  };

  const stopRecording = async () => {
    try {
      clearInterval(timerRef.current);
      setIsRecording(false);
      setStatusText('Processing your recording...');
      setIsProcessing(true);

      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      const finalDuration = startTimeRef.current
        ? Math.floor((Date.now() - startTimeRef.current) / 1000)
        : recordingTime;

      setRecordingTime(finalDuration);
      setRecordingUri(uri);

      // Stop foreground service
      await stopForegroundService();
      deactivateKeepAwake('recording');
      await Audio.setAudioModeAsync({
        allowsRecordingIOS:      false,
        staysActiveInBackground: false,
      }).catch(() => {});

      return uri;

    } catch (err) {
      console.error('stopRecording error:', err.message);
      await stopForegroundService();
      deactivateKeepAwake('recording');
      Alert.alert('Error', 'Could not stop recording: ' + err.message);
      setStatusText('Tap to start recording');
      setIsProcessing(false);
      return null;
    }
  };

  const resetRecording = () => {
    setIsRecording(false);
    setIsProcessing(false);
    setRecordingTime(0);
    startTimeRef.current = null;
    setStatusText('Tap to start recording');
    setRecordingUri(null);
  };

  return (
    <RecordingContext.Provider value={{
      isRecording, isProcessing, recordingTime, statusText, recordingUri,
      setStatusText, setIsProcessing, startRecording, stopRecording,
      resetRecording, formatTime,
    }}>
      {children}
    </RecordingContext.Provider>
  );
};