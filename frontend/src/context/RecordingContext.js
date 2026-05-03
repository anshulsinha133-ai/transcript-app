import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { Alert } from 'react-native';
import { Audio } from 'expo-av';

const RecordingContext = createContext(null);

export const useRecording = () => {
  const context = useContext(RecordingContext);
  if (!context) throw new Error('useRecording must be used within RecordingProvider');
  return context;
};

export const RecordingProvider = ({ children }) => {
  const [isRecording,   setIsRecording]   = useState(false);
  const [isProcessing,  setIsProcessing]  = useState(false);
  const [recordingTime,  setRecordingTime]  = useState(0);
const startTimeRef = useRef(null);
  const [statusText,    setStatusText]    = useState('Tap to start recording');
  const [recordingUri,  setRecordingUri]  = useState(null);

  const recordingRef   = useRef(null);
  const timerRef       = useRef(null);

  // ─── Cleanup on unmount ───
  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
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

      await Audio.setAudioModeAsync({
        allowsRecordingIOS:   true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync({
        android: {
          extension:        '.m4a',
          outputFormat:     Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder:     Audio.AndroidAudioEncoder.AAC,
          sampleRate:       44100,
          numberOfChannels: 1,
          bitRate:          128000,
        },
        ios: {
          extension:            '.m4a',
          outputFormat:         Audio.IOSOutputFormat.MPEG4AAC,
          audioQuality:         Audio.IOSAudioQuality.MAX,
          sampleRate:           44100,
          numberOfChannels:     1,
          bitRate:              128000,
          linearPCMBitDepth:    16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat:     false,
        },
        web: {},
      });

      recordingRef.current = recording;
      setIsRecording(true);
      setRecordingTime(0);
      setStatusText('Recording... speak now');
      setRecordingUri(null);

      startTimeRef.current = Date.now();
timerRef.current = setInterval(() => {
  const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
  setRecordingTime(elapsed);
}, 1000);

      return true;

    } catch (err) {
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
// ✅ Calculate final duration from start time
const finalDuration = startTimeRef.current
  ? Math.floor((Date.now() - startTimeRef.current) / 1000)
  : recordingTime;
setRecordingTime(finalDuration);
setRecordingUri(uri);
return uri;

      return uri;

    } catch (err) {
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