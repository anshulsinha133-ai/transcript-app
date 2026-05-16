import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import { Audio } from 'expo-av';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

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

  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission needed', 'Please allow microphone access');
        return false;
      }

      // ── Critical: set audio mode BEFORE creating recording ──────────────
      // interruptionModeAndroid: 1 = DO_NOT_MIX (keeps audio from being interrupted)
      // staysActiveInBackground: true = keeps session alive when screen locks
      await Audio.setAudioModeAsync({
        allowsRecordingIOS:         true,
        playsInSilentModeIOS:       true,
        staysActiveInBackground:    true,
        interruptionModeIOS:        1,
        shouldDuckAndroid:          false,
        interruptionModeAndroid:    1,
        playThroughEarpieceAndroid: false,
      });

      // ── Use HIGH_QUALITY preset — proven to work in background on Android ─
      // Custom settings with MPEG_4/AAC can lose background audio on some devices
      // HIGH_QUALITY preset uses Android's MediaRecorder with proper session flags
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = recording;
      startTimeRef.current = Date.now();

      // Keep CPU awake so JS timer stays accurate
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

      // Release keep-awake and audio session
      deactivateKeepAwake('recording');
      await Audio.setAudioModeAsync({
        allowsRecordingIOS:      false,
        staysActiveInBackground: false,
      }).catch(() => {});

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
    startTimeRef.current = null;
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