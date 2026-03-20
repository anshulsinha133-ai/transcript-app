import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, SafeAreaView, Alert,
  ActivityIndicator, KeyboardAvoidingView, Platform
} from 'react-native';
import { supabase } from '../supabase';

export default function LoginScreen() {
  const [mode,     setMode]     = useState('otp');
  const [email,    setEmail]    = useState('');
  const [otp,      setOtp]      = useState('');
  const [password, setPassword] = useState('');
  const [step,     setStep]     = useState('input');
  const [loading,  setLoading]  = useState(false);

  const sendEmailOTP = async () => {
    if (!email) return Alert.alert('Error', 'Please enter your email address');
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { shouldCreateUser: true }
      });
      if (error) throw error;
      setStep('otp');
      Alert.alert('OTP Sent!', 'Check your email inbox for the 6-digit OTP code');
    } catch (err) {
      Alert.alert('Error', err.message);
    }
    setLoading(false);
  };

  const verifyEmailOTP = async () => {
    if (!otp) return Alert.alert('Error', 'Please enter the OTP');
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: otp,
        type:  'email',
      });
      if (error) throw error;
    } catch (err) {
      Alert.alert('Error', err.message);
    }
    setLoading(false);
  };

  const emailLogin = async () => {
    if (!email || !password) return Alert.alert('Error', 'Please enter email and password');
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password
      });
      if (error) throw error;
    } catch (err) {
      Alert.alert('Error', err.message);
    }
    setLoading(false);
  };

  const emailSignUp = async () => {
    if (!email || !password) return Alert.alert('Error', 'Please enter email and password');
    if (password.length < 6) return Alert.alert('Error', 'Password must be at least 6 characters');
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password
      });
      if (error) throw error;
      Alert.alert('Success!', 'Check your email to verify your account then login');
    } catch (err) {
      Alert.alert('Error', err.message);
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inner}>

        <View style={styles.header}>
          <Text style={styles.appName}>VoxNote</Text>
          <Text style={styles.tagline}>Speak. Transcribe. Remember.</Text>
        </View>

        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, mode === 'otp' && styles.tabActive]}
            onPress={() => { setMode('otp'); setStep('input'); setOtp(''); }}>
            <Text style={[styles.tabText, mode === 'otp' && styles.tabTextActive]}>
              Email OTP
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, mode === 'password' && styles.tabActive]}
            onPress={() => { setMode('password'); setStep('input'); }}>
            <Text style={[styles.tabText, mode === 'password' && styles.tabTextActive]}>
              Email + Password
            </Text>
          </TouchableOpacity>
        </View>

        {mode === 'otp' && step === 'input' && (
          <View style={styles.form}>
            <Text style={styles.label}>Enter your email address</Text>
            <TextInput
              style={styles.input}
              placeholder="yourname@gmail.com"
              placeholderTextColor="#888"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.hint}>
              A 6-digit OTP will be sent to your email
            </Text>
            {loading
              ? <ActivityIndicator color="#1A56A0" style={{ marginTop: 20 }} />
              : <TouchableOpacity style={styles.btn} onPress={sendEmailOTP}>
                  <Text style={styles.btnText}>Send OTP to Email</Text>
                </TouchableOpacity>
            }
          </View>
        )}

        {mode === 'otp' && step === 'otp' && (
          <View style={styles.form}>
            <Text style={styles.label}>Enter OTP sent to:</Text>
            <Text style={styles.emailDisplay}>{email}</Text>
            <TextInput
              style={styles.otpInput}
              placeholder="000000"
              placeholderTextColor="#888"
              value={otp}
              onChangeText={setOtp}
              keyboardType="number-pad"
              maxLength={6}
            />
            {loading
              ? <ActivityIndicator color="#1A56A0" style={{ marginTop: 20 }} />
              : <TouchableOpacity style={styles.btn} onPress={verifyEmailOTP}>
                  <Text style={styles.btnText}>Verify OTP and Login</Text>
                </TouchableOpacity>
            }
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => { setStep('input'); setOtp(''); }}>
              <Text style={styles.backBtnText}>Change email address</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.resendBtn} onPress={sendEmailOTP}>
              <Text style={styles.resendBtnText}>Resend OTP</Text>
            </TouchableOpacity>
          </View>
        )}

        {mode === 'password' && (
          <View style={styles.form}>
            <Text style={styles.label}>Email Address</Text>
            <TextInput
              style={styles.input}
              placeholder="yourname@gmail.com"
              placeholderTextColor="#888"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Minimum 6 characters"
              placeholderTextColor="#888"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            {loading
              ? <ActivityIndicator color="#1A56A0" style={{ marginTop: 20 }} />
              : <View style={styles.btnGroup}>
                  <TouchableOpacity style={styles.btn} onPress={emailLogin}>
                    <Text style={styles.btnText}>Login</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnOutline]}
                    onPress={emailSignUp}>
                    <Text style={[styles.btnText, styles.btnOutlineText]}>
                      Create New Account
                    </Text>
                  </TouchableOpacity>
                </View>
            }
          </View>
        )}

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#F5F7FA' },
  inner:          { flex: 1, padding: 24, justifyContent: 'center' },
  header:         { alignItems: 'center', marginBottom: 40 },
  appName:        { fontSize: 36, fontWeight: 'bold', color: '#0D3B7A' },
  tagline:        { fontSize: 14, color: '#888', marginTop: 8, textAlign: 'center' },
  tabs:           { flexDirection: 'row', backgroundColor: '#E8EEF7',
                    borderRadius: 10, padding: 4, marginBottom: 24 },
  tab:            { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center' },
  tabActive:      { backgroundColor: '#1A56A0' },
  tabText:        { fontSize: 13, color: '#666', fontWeight: '600' },
  tabTextActive:  { color: '#FFFFFF' },
  form:           { gap: 12 },
  label:          { fontSize: 14, fontWeight: '600', color: '#0D3B7A' },
  input:          { backgroundColor: '#FFFFFF', borderWidth: 1,
                    borderColor: '#DCE9F8', borderRadius: 10,
                    padding: 14, fontSize: 15, color: '#333' },
  otpInput:       { backgroundColor: '#FFFFFF', borderWidth: 2,
                    borderColor: '#1A56A0', borderRadius: 10,
                    padding: 14, fontSize: 28, color: '#333',
                    textAlign: 'center', letterSpacing: 10 },
  hint:           { fontSize: 12, color: '#888', textAlign: 'center' },
  emailDisplay:   { fontSize: 15, fontWeight: 'bold', color: '#1A56A0',
                    textAlign: 'center' },
  btn:            { backgroundColor: '#1A56A0', padding: 16,
                    borderRadius: 10, alignItems: 'center', marginTop: 8 },
  btnOutline:     { backgroundColor: '#FFFFFF', borderWidth: 1.5,
                    borderColor: '#1A56A0', marginTop: 8 },
  btnText:        { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold' },
  btnOutlineText: { color: '#1A56A0' },
  btnGroup:       { gap: 0 },
  backBtn:        { alignItems: 'center', marginTop: 12 },
  backBtnText:    { color: '#888', fontSize: 13 },
  resendBtn:      { alignItems: 'center', marginTop: 8 },
  resendBtnText:  { color: '#1A56A0', fontSize: 13, fontWeight: '600' },
});