import * as AuthSession from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_TOKEN_KEY    = 'voxnote_google_access_token';
const GOOGLE_EXPIRY_KEY   = 'voxnote_google_token_expiry';
const GOOGLE_EMAIL_KEY    = 'voxnote_google_email';

// ─── Replace with your Web client ID from Google Cloud Console ───────────────
export const GOOGLE_WEB_CLIENT_ID = '452558234220-17cu[fullstring].apps.googleusercontent.com';

// ─── Save token after successful OAuth ───────────────────────────────────────
export const saveGoogleToken = async (token, expiresIn, email) => {
  try {
    const expiry = Date.now() + (expiresIn || 3600) * 1000;
    await AsyncStorage.setItem(GOOGLE_TOKEN_KEY,  token);
    await AsyncStorage.setItem(GOOGLE_EXPIRY_KEY, String(expiry));
    if (email) await AsyncStorage.setItem(GOOGLE_EMAIL_KEY, email);
  } catch (err) {
    console.error('Failed to save Google token:', err.message);
  }
};

// ─── Get stored token (returns null if expired or not set) ───────────────────
export const getGoogleToken = async () => {
  try {
    const token  = await AsyncStorage.getItem(GOOGLE_TOKEN_KEY);
    const expiry = await AsyncStorage.getItem(GOOGLE_EXPIRY_KEY);
    if (!token || !expiry) return null;
    if (Date.now() > parseInt(expiry) - 60000) {
      // Token expired or expiring within 1 min — clear it
      await clearGoogleToken();
      return null;
    }
    return token;
  } catch {
    return null;
  }
};

// ─── Check if Google is connected ────────────────────────────────────────────
export const isGoogleConnected = async () => {
  const token = await getGoogleToken();
  return !!token;
};

// ─── Get stored email ─────────────────────────────────────────────────────────
export const getGoogleEmail = async () => {
  try {
    return await AsyncStorage.getItem(GOOGLE_EMAIL_KEY);
  } catch {
    return null;
  }
};

// ─── Clear all Google auth data ──────────────────────────────────────────────
export const clearGoogleToken = async () => {
  try {
    await AsyncStorage.removeItem(GOOGLE_TOKEN_KEY);
    await AsyncStorage.removeItem(GOOGLE_EXPIRY_KEY);
    await AsyncStorage.removeItem(GOOGLE_EMAIL_KEY);
  } catch (err) {
    console.error('Failed to clear Google token:', err.message);
  }
};

// ─── Custom hook — use inside a component ────────────────────────────────────
// Usage:
//   const { promptAsync, loading } = useGoogleCalendarAuth(onSuccess);
//   <Button onPress={promptAsync} />

export const useGoogleCalendarAuth = (onSuccess) => {
  const [request, response, promptAsync] = Google.useAuthRequest({
    clientId: GOOGLE_WEB_CLIENT_ID,
    scopes: [
      'openid',
      'profile',
      'email',
      'https://www.googleapis.com/auth/calendar.readonly',
    ],
  });

  // Handle response whenever it changes
  const handleResponse = async () => {
    if (response?.type === 'success') {
      const { authentication } = response;
      const token = authentication?.accessToken;
      const expiresIn = authentication?.expiresIn;

      // Fetch user's email from Google userinfo
      let email = null;
      try {
        const userInfo = await fetch(
          'https://www.googleapis.com/oauth2/v3/userinfo',
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await userInfo.json();
        email = data.email;
      } catch {}

      await saveGoogleToken(token, expiresIn, email);
      if (onSuccess) onSuccess(token, email);
    }
  };

  // Call handleResponse when response changes
  // (caller must call this in a useEffect watching response)
  return { request, response, promptAsync, handleResponse };
};