// src/screens/PaywallScreen.js
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, Alert, ActivityIndicator,
  ScrollView, Linking
} from 'react-native';
import { setProStatus } from '../utils/subscription';

const RENDER_URL  = 'https://transcript-app-lbpe.onrender.com';
const PLAN_AMOUNT = 29900; // ₹299 in paise

const FEATURES_FREE = [
  { text: '5 recordings total',          ok: true  },
  { text: 'All Indian languages',         ok: true  },
  { text: 'Speaker detection',            ok: true  },
  { text: 'AI structured notes',          ok: true  },
  { text: 'Unlimited recordings',         ok: false },
  { text: 'Priority processing',          ok: false },
  { text: 'Export PDF & share',           ok: false },
];

const FEATURES_PRO = [
  { text: 'Unlimited recordings',         ok: true },
  { text: 'All Indian languages',         ok: true },
  { text: 'Speaker detection',            ok: true },
  { text: 'AI structured notes',          ok: true },
  { text: 'Export PDF & share',           ok: true },
  { text: 'Priority processing',          ok: true },
  { text: 'WhatsApp & email sharing',     ok: true },
];

export default function PaywallScreen({ navigation, route }) {
  const [loading, setLoading] = useState(false);
  const fromScreen = route?.params?.fromScreen || 'Home';

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      // Step 1: Create Razorpay order on backend
      const orderRes = await fetch(`${RENDER_URL}/create-order`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ amount: PLAN_AMOUNT }),
      });
      const orderData = await orderRes.json();
      if (!orderData.success) throw new Error(orderData.error || 'Could not create order');

      // Step 2: Open Razorpay checkout
      // Using Razorpay payment link approach (works without native SDK in Expo Go)
      const paymentUrl = `https://rzp.io/l/voxnote-pro`;
      const supported  = await Linking.canOpenURL(paymentUrl);

      if (supported) {
        await Linking.openURL(paymentUrl);
        // After payment, user taps "I've paid" to verify
        Alert.alert(
          '✅ Complete Payment',
          'After paying on Razorpay, tap "Verify Payment" below to activate Pro.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Verify Payment',
              onPress: () => verifyAndActivate(orderData.orderId),
            },
          ]
        );
      } else {
        throw new Error('Cannot open payment page');
      }
    } catch (err) {
      Alert.alert('Error', err.message || 'Payment failed. Please try again.');
    }
    setLoading(false);
  };

  const verifyAndActivate = async (orderId) => {
    setLoading(true);
    try {
      const verifyRes = await fetch(`${RENDER_URL}/verify-payment`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ orderId }),
      });
      const verifyData = await verifyRes.json();

      if (verifyData.success) {
        // Set pro for 30 days
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + 30);
        await setProStatus(expiry);

        Alert.alert(
          '🎉 Welcome to VoxNote Pro!',
          'Your subscription is now active. Enjoy unlimited recordings!',
          [{ text: 'Start Recording', onPress: () => navigation.navigate('Home') }]
        );
      } else {
        Alert.alert(
          'Payment not found',
          'We could not verify your payment yet. If you have paid, please wait a minute and try again.',
          [
            { text: 'Try Again', onPress: () => verifyAndActivate(orderId) },
            { text: 'Cancel',    style: 'cancel' },
          ]
        );
      }
    } catch (err) {
      Alert.alert('Error', 'Verification failed: ' + err.message);
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerBadge}>🎙 VoxNote</Text>
          <Text style={styles.headerTitle}>Upgrade to Pro</Text>
          <Text style={styles.headerSub}>
            Unlimited recordings for your business,{'\n'}meetings, and consultations
          </Text>
        </View>

        {/* Price */}
        <View style={styles.priceCard}>
          <Text style={styles.priceAmount}>₹299</Text>
          <Text style={styles.pricePer}>per month</Text>
          <Text style={styles.priceNote}>Cancel anytime · No hidden charges</Text>
        </View>

        {/* Plan comparison */}
        <View style={styles.plansRow}>

          {/* Free */}
          <View style={styles.planCard}>
            <Text style={styles.planTitle}>Free</Text>
            <Text style={styles.planPrice}>₹0</Text>
            {FEATURES_FREE.map((f, i) => (
              <View key={i} style={styles.featureRow}>
                <Text style={[styles.featureDot, { color: f.ok ? '#059669' : '#CCC' }]}>
                  {f.ok ? '✓' : '✗'}
                </Text>
                <Text style={[styles.featureText, !f.ok && styles.featureTextDim]}>
                  {f.text}
                </Text>
              </View>
            ))}
          </View>

          {/* Pro */}
          <View style={[styles.planCard, styles.planCardPro]}>
            <View style={styles.proBadge}>
              <Text style={styles.proBadgeText}>POPULAR</Text>
            </View>
            <Text style={[styles.planTitle, styles.planTitlePro]}>Pro</Text>
            <Text style={[styles.planPrice, styles.planPricePro]}>₹299/mo</Text>
            {FEATURES_PRO.map((f, i) => (
              <View key={i} style={styles.featureRow}>
                <Text style={[styles.featureDot, { color: '#FFFFFF' }]}>✓</Text>
                <Text style={[styles.featureText, styles.featureTextPro]}>{f.text}</Text>
              </View>
            ))}
          </View>

        </View>

        {/* CTA Button */}
        <TouchableOpacity
          style={[styles.upgradeBtn, loading && { opacity: 0.7 }]}
          onPress={handleUpgrade}
          disabled={loading}>
          {loading
            ? <ActivityIndicator color="#FFFFFF" />
            : <Text style={styles.upgradeBtnText}>🚀 Upgrade to Pro — ₹299/month</Text>
          }
        </TouchableOpacity>

        {/* Skip */}
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={() => navigation.navigate(fromScreen)}>
          <Text style={styles.skipBtnText}>Continue with Free (5 recordings)</Text>
        </TouchableOpacity>

        {/* Trust signals */}
        <View style={styles.trustRow}>
          <Text style={styles.trustItem}>🔒 Secure payment</Text>
          <Text style={styles.trustItem}>🇮🇳 Made for India</Text>
          <Text style={styles.trustItem}>💳 Razorpay</Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#F0F4F8' },
  scroll:           { padding: 20, paddingBottom: 40 },

  header:           { alignItems: 'center', marginBottom: 24 },
  headerBadge:      { fontSize: 13, color: '#1A56A0', fontWeight: '700',
                      letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  headerTitle:      { fontSize: 28, fontWeight: 'bold', color: '#0D3B7A',
                      textAlign: 'center', marginBottom: 8 },
  headerSub:        { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 22 },

  priceCard:        { backgroundColor: '#0D3B7A', borderRadius: 16, padding: 24,
                      alignItems: 'center', marginBottom: 24 },
  priceAmount:      { fontSize: 48, fontWeight: 'bold', color: '#FFFFFF' },
  pricePer:         { fontSize: 16, color: '#AACFEE', marginTop: 4 },
  priceNote:        { fontSize: 12, color: '#7FA8CC', marginTop: 8 },

  plansRow:         { flexDirection: 'row', gap: 12, marginBottom: 24 },

  planCard:         { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 14,
                      padding: 16, borderWidth: 1, borderColor: '#E5E7EB' },
  planCardPro:      { backgroundColor: '#1A56A0', borderColor: '#1A56A0' },
  proBadge:         { backgroundColor: '#FCD34D', borderRadius: 6, paddingHorizontal: 8,
                      paddingVertical: 3, alignSelf: 'flex-start', marginBottom: 8 },
  proBadgeText:     { fontSize: 10, fontWeight: '800', color: '#92400E', letterSpacing: 0.5 },
  planTitle:        { fontSize: 16, fontWeight: '700', color: '#0D3B7A', marginBottom: 4 },
  planTitlePro:     { color: '#FFFFFF' },
  planPrice:        { fontSize: 18, fontWeight: 'bold', color: '#1A56A0', marginBottom: 12 },
  planPricePro:     { color: '#93C5FD' },

  featureRow:       { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6, gap: 6 },
  featureDot:       { fontSize: 13, fontWeight: '700', width: 16 },
  featureText:      { flex: 1, fontSize: 12, color: '#374151', lineHeight: 18 },
  featureTextDim:   { color: '#9CA3AF' },
  featureTextPro:   { color: '#E0EEFF' },

  upgradeBtn:       { backgroundColor: '#1A56A0', padding: 18, borderRadius: 14,
                      alignItems: 'center', marginBottom: 12 },
  upgradeBtnText:   { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold' },

  skipBtn:          { alignItems: 'center', paddingVertical: 14 },
  skipBtnText:      { color: '#888', fontSize: 14, textDecorationLine: 'underline' },

  trustRow:         { flexDirection: 'row', justifyContent: 'center',
                      gap: 16, marginTop: 8 },
  trustItem:        { fontSize: 12, color: '#888' },
});