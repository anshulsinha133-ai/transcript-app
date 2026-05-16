import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { Alert, AppState, Platform, Linking } from 'react-native';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';

const RecordingContext = createContext(null);
const audioRecorderPlayer = new AudioRecorderPlayer();

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

  const startTimeRef = useRef(null);
  const timerRef     = useRef(null);
  const appStateRef  = useRef(AppState.currentState);
  const appStateSub  = useRef(null);
  const currentUriRef = useRef(null);

  // Resync timer when app comes back to foreground
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

  // ─── Battery optimization exemption (Samsung One UI) ─────────────────────
  const checkBatteryOptimization = async () => {
    if (Platform.OS !== 'android') return;
    try {
      const hasAsked = await AsyncStorage.getItem('voxnote_battery_asked');
      if (!hasAsked) {
        await AsyncStorage.setItem('voxnote_battery_asked', 'true');
        Alert.alert(
          '🔋 Enable Background Recording',
          'To keep recording when the screen is locked, tap "Allow" on the next screen to disable battery optimization for VoxNote.\n\nThis is required on Samsung phones.',
          [
            {
              text: '✅ Allow (Recommended)',
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
    } catch (e) {
      console.log('Battery check error:', e.message);
    }
  };

  const startRecording = async () => {
    try {
      // Check battery optimization on first use
      await checkBatteryOptimization();

      // Set output path
      const path = Platform.select({
        android: `${Date.now()}_recording.m4a`,
        ios:     `${Date.now()}_recording.m4a`,
      });

      // Start recording with react-native-audio-recorder-player
      // This library uses Android's native MediaRecorder with proper
      // foreground service support — works when screen is locked
      const uri = await audioRecorderPlayer.startRecorder(path, {
        AVFormatIDKeyIOS:                  'aac',
        AVSampleRateKeyIOS:                44100,
        AVNumberOfChannelsKeyIOS:          1,
        AVEncoderAudioQualityKeyIOS:       'high',
        AudioEncoderAndroid:               'aac',
        AudioSourceAndroid:                'mic',
        OutputFormatAndroid:               'mpeg_4',
        AudioSamplingRateAndroid:          44100,
        AudioChannelsAndroid:              1,
        AudioEncodingBitRateAndroid:       128000,
      });

      currentUriRef.current = uri;
      startTimeRef.current  = Date.now();

      // Keep screen from turning off (belt + suspenders approach)
      await activateKeepAwakeAsync('recording');

      setIsRecording(true);
      setRecordingTime(0);
      setStatusText('Recording... speak now');
      setRecordingUri(null);

      // Wall-clock timer — stays accurate even when screen is off
      timerRef.current = setInterval(() => {
        if (startTimeRef.current) {
          setRecordingTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }
      }, 1000);

      console.log('Recording started, URI:', uri);
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

      const uri = await audioRecorderPlayer.stopRecorder();
      audioRecorderPlayer.removeRecordBackListener();

      const finalDuration = startTimeRef.current
        ? Math.floor((Date.now() - startTimeRef.current) / 1000)
        : recordingTime;

      setRecordingTime(finalDuration);
      setRecordingUri(uri);

      deactivateKeepAwake('recording');

      console.log('Recording stopped, URI:', uri);
      return uri;

    } catch (err) {
      console.error('stopRecording error:', err.message);
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
    startTimeRef.current  = null;
    currentUriRef.current = null;
    setStatusText('Tap to start recording');
    setRecordingUri(null);
  };

  return (
    <RecordingContext.Provider value={{
      isRecording,
      isProcessing,
      recordingTime,
      statusText,
      recordingUri,
      setStatusText,
      setIsProcessing,
      startRecording,
      stopRecording,
      resetRecording,
      formatTime,
    }}>
      {children}
    </RecordingContext.Provider>
  );
};