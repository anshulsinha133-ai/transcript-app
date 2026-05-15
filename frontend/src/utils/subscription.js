// src/utils/subscription.js
// Manages free/pro status for VoxNote
// Free tier: 5 recordings lifetime
// Pro tier: ₹299/month via Razorpay

import AsyncStorage from '@react-native-async-storage/async-storage';

const PRO_STATUS_KEY    = 'voxnote_pro_status';
const PRO_EXPIRY_KEY    = 'voxnote_pro_expiry';
const FREE_LIMIT        = 5;

// ─── Check if user is Pro ─────────────────────────────────────────────────────
export const isProUser = async () => {
  try {
    const status = await AsyncStorage.getItem(PRO_STATUS_KEY);
    if (status !== 'true') return false;
    // Check expiry
    const expiry = await AsyncStorage.getItem(PRO_EXPIRY_KEY);
    if (!expiry) return false;
    const expiryDate = new Date(expiry);
    if (expiryDate < new Date()) {
      // Expired — clear pro status
      await AsyncStorage.removeItem(PRO_STATUS_KEY);
      await AsyncStorage.removeItem(PRO_EXPIRY_KEY);
      return false;
    }
    return true;
  } catch (err) {
    console.error('isProUser error:', err.message);
    return false;
  }
};

// ─── Set Pro status after successful payment ──────────────────────────────────
export const setProStatus = async (expiryDate) => {
  try {
    await AsyncStorage.setItem(PRO_STATUS_KEY, 'true');
    await AsyncStorage.setItem(PRO_EXPIRY_KEY, expiryDate.toISOString());
    console.log('Pro status set until:', expiryDate.toISOString());
    return true;
  } catch (err) {
    console.error('setProStatus error:', err.message);
    return false;
  }
};

// ─── Clear Pro status (on logout or expiry) ───────────────────────────────────
export const clearProStatus = async () => {
  try {
    await AsyncStorage.removeItem(PRO_STATUS_KEY);
    await AsyncStorage.removeItem(PRO_EXPIRY_KEY);
  } catch (err) {
    console.error('clearProStatus error:', err.message);
  }
};

// ─── Get Pro expiry date ──────────────────────────────────────────────────────
export const getProExpiry = async () => {
  try {
    const expiry = await AsyncStorage.getItem(PRO_EXPIRY_KEY);
    return expiry ? new Date(expiry) : null;
  } catch (err) {
    return null;
  }
};

// ─── Check if user can record (free limit check) ─────────────────────────────
export const canRecord = async (currentRecordingCount) => {
  const pro = await isProUser();
  if (pro) return { allowed: true, isPro: true };
  if (currentRecordingCount < FREE_LIMIT) {
    return {
      allowed:    true,
      isPro:      false,
      remaining:  FREE_LIMIT - currentRecordingCount,
    };
  }
  return {
    allowed:   false,
    isPro:     false,
    remaining: 0,
    reason:    `Free limit reached (${FREE_LIMIT} recordings). Upgrade to Pro for unlimited recordings.`,
  };
};

export const FREE_RECORDING_LIMIT = FREE_LIMIT;