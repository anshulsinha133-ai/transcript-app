import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL  = 'https://jypejqomwgvxwrdmeacu.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_mlyzMzKgr62FZQJr9355og_g1ZCK_Nl';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage:          AsyncStorage,
    autoRefreshToken: true,
    persistSession:   true,
    detectSessionInUrl: false,
  },
});