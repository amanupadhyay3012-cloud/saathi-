import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Dimensions,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import { useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Audio } from 'expo-av';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';
import { Accelerometer } from 'expo-sensors';
import * as Battery from 'expo-battery';
// ⬇️ CHANGE THIS to your deployed backend URL (no trailing slash).
// After deploying to Render, paste your URL here, e.g. 'https://saathi-backend.onrender.com'.
// For local testing on the same WiFi, use your laptop IP e.g. 'http://192.168.1.5:5000'.
const BASE_URL = 'https://saathi-backend-ckqe.onrender.com';

const BG_LOCATION_TASK = 'saathi-background-location';
TaskManager.defineTask(BG_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const locs = data && data.locations;
  if (!locs || !locs.length) return;
  const { latitude, longitude } = locs[locs.length - 1].coords;
  try {
    const token = await SecureStore.getItemAsync('token');
    if (!token) return;
    const status = (await SecureStore.getItemAsync('bgShareStatus')) || 'trip';
    if (status === 'idle') return;
    const tripId = await SecureStore.getItemAsync('bgTripId');
    await fetch(`${BASE_URL}/api/circles/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status, lat: latitude, lng: longitude }),
    });
    if (tripId) {
      await fetch(`${BASE_URL}/api/trips/${tripId}/location`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ lat: latitude, lng: longitude, speed: 0, heading: 0 }),
      });
    }
  } catch (e) { console.log('BG location post failed', e); }
});

async function startBackgroundLocation(status, tripId) {
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') return false;
    await Location.requestBackgroundPermissionsAsync().catch(() => {});
    await SecureStore.setItemAsync('bgShareStatus', status);
    if (tripId) { await SecureStore.setItemAsync('bgTripId', String(tripId)); }
    else { await SecureStore.deleteItemAsync('bgTripId').catch(() => {}); }
    const already = await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK).catch(() => false);
    if (already) await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK).catch(() => {});
    await Location.startLocationUpdatesAsync(BG_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 10000,
      distanceInterval: 20,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'SAATHI is sharing your location',
        notificationBody: 'Active during your trip or SOS.',
        notificationColor: '#7C5CBF',
      },
    });
    return true;
  } catch (e) { console.log('startBackgroundLocation failed', e); return false; }
}

async function stopBackgroundLocation() {
  try {
    await SecureStore.setItemAsync('bgShareStatus', 'idle').catch(() => {});
    await SecureStore.deleteItemAsync('bgTripId').catch(() => {});
    const started = await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK).catch(() => false);
    if (started) await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK);
  } catch (e) { console.log('stopBackgroundLocation failed', e); }
}

const { width } = Dimensions.get('window');

const C = {
  bg: '#0C0D0F',
  bg2: '#141517',
  card: '#191B1F',
  cardBorder: '#26292F',
  purple: '#C2C7D0',
  pink: '#D14152',
  teal: '#9AA3B2',
  yellow: '#C2C7D0',
  white: '#F4F5F7',
  white70: 'rgba(244,245,247,0.72)',
  white60: 'rgba(244,245,247,0.6)',
  white40: 'rgba(244,245,247,0.42)',
  white15: 'rgba(244,245,247,0.15)',
  white08: 'rgba(255,255,255,0.05)',
};
const CONTACTS_KEY = 'SAATHI_TRUSTED_CONTACTS';
const LAST_LOCATION_KEY = 'SAATHI_LAST_KNOWN_LOCATION';
const EVIDENCE_DELETE_PIN = '1234';
const PROFILE_KEY = 'SAATHI_USER_PROFILE';
const EVIDENCE_HISTORY_KEY = 'SAATHI_EVIDENCE_HISTORY';
// Ringtone for the fake-call feature. Vibration always works; this sound is a bonus.
// Swap for your own hosted file, or set to '' to use vibration only.
const RINGTONE_URL = 'https://actions.google.com/sounds/v1/alarms/phone_alerts_and_rings.ogg';
const SIREN_URL = 'https://actions.google.com/sounds/v1/alarms/emergency_siren_long.ogg';

const DEFAULT_CONTACTS = [
  {
    id: '1',
    name: 'Mom',
    phone: '+91 98765 43210',
    rel: 'Mother',
    emoji: '👩',
    color: C.pink,
  },
  {
    id: '2',
    name: 'Priya',
    phone: '+91 87654 32109',
    rel: 'Friend',
    emoji: '👧',
    color: C.purple,
  },
];

async function secureGetJSON(key, fallback = null) {
  try {
    const secureValue = await SecureStore.getItemAsync(key);

    if (secureValue) {
      return JSON.parse(secureValue);
    }

    const oldValue = await AsyncStorage.getItem(key);

    if (oldValue) {
      await SecureStore.setItemAsync(key, oldValue);
      await AsyncStorage.removeItem(key);
      return JSON.parse(oldValue);
    }

    return fallback;
  } catch (error) {
    console.log('Secure get error:', key, error);
    return fallback;
  }
}

async function secureSetJSON(key, value) {
  try {
    await SecureStore.setItemAsync(key, JSON.stringify(value));
  } catch (error) {
    console.log('Secure set error:', key, error);
  }
}

async function secureRemove(key) {
  try {
    await SecureStore.deleteItemAsync(key);
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.log('Secure remove error:', key, error);
  }
}
function cleanText(value) {
  return String(value || '').trim();
}

function cleanPhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidIndianPhone(value) {
  const phone = cleanPhone(value);
  return phone.length === 10;
}

function isValidAge(value) {
  const age = Number(value);
  return Number.isInteger(age) && age > 0 && age <= 120;
}

function isValidBloodGroup(value) {
  const blood = cleanText(value).toUpperCase();

  if (!blood) return true;

  return ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].includes(blood);
}

function isValidPin(value) {
  return /^\d{4,6}$/.test(String(value || ''));
}
async function saveLastKnownLocation(locationData) {
  try {
    if (!locationData?.latitude || !locationData?.longitude) return;

    const lastLocation = {
      latitude: locationData.latitude,
      longitude: locationData.longitude,
      mapsUrl: locationData.mapsUrl,
      savedAt: new Date().toISOString(),
    };

    await secureSetJSON(LAST_LOCATION_KEY, lastLocation);
    console.log('Last known location saved:', lastLocation);
  } catch (error) {
    console.log('Save last known location error:', error);
  }
}

async function getLastKnownLocation() {
  try {
 const lastLocation = await secureGetJSON(LAST_LOCATION_KEY);

if (!lastLocation) return null;

    const mapsUrl =
      lastLocation.mapsUrl ||
      `https://maps.google.com/?q=${lastLocation.latitude},${lastLocation.longitude}`;

    const savedTime = lastLocation.savedAt
      ? new Date(lastLocation.savedAt).toLocaleString()
      : 'Earlier';

    const emergencyMessage = `🚨 SAATHI EMERGENCY ALERT

I may be in danger and need help.

⚠️ Live location was unavailable.
Using my last known location.

📍 Last known location:
${mapsUrl}

🕒 Last updated:
${savedTime}

⏰ Alert Time:
${new Date().toLocaleString()}

Please call me immediately or contact emergency services.

Emergency Number: 112`;

    return {
      available: true,
      isLastKnown: true,
      latitude: lastLocation.latitude,
      longitude: lastLocation.longitude,
      mapsUrl,
      savedAt: lastLocation.savedAt,
      message: emergencyMessage,
    };
  } catch (error) {
    console.log('Get last known location error:', error);
    return null;
  }
}
// Stage 3 helper
async function publishCircleLocation(status, lat, lng) {
  try {
    const token = await SecureStore.getItemAsync('token');
    if (!token) return;
    const body = status === 'idle' ? { status: 'idle' } : { status, lat, lng };
    await fetch(`${BASE_URL}/api/circles/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (err) { console.log('Circle location update failed', err); }
}

async function triggerBackendSOS(lat, lng, contacts) {
  try {
    const token = await SecureStore.getItemAsync('token');
    if (!token) return null;
    const res = await fetch(`${BASE_URL}/api/sos/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ triggerType: 'button', lat, lng, contacts: (contacts || []).map((c) => ({ name: c.name, phone: c.phone })) }),
    });
    const data = await res.json();
    return res.ok ? data : null;
  } catch (err) { console.log('Backend SOS trigger failed', err); return null; }
}

async function getCurrentLocation() {
  try {
    const servicesEnabled = await Location.hasServicesEnabledAsync();

    if (!servicesEnabled) {
      Alert.alert(
        'Location Off',
        'Please turn on Location Services from your phone settings.'
      );
      return null;
    }

    const { status } = await Location.requestForegroundPermissionsAsync();

    if (status !== 'granted') {
      Alert.alert(
        'Location Permission Needed',
        'SAATHI needs location permission to send your emergency location.'
      );
      return null;
    }

    let position = null;

    try {
      position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Lowest,
      });
    } catch (error1) {
      console.log('Current location failed:', error1);

      try {
        position = await Location.getLastKnownPositionAsync({
          maxAge: 1000 * 60 * 10,
        });
      } catch (error2) {
        console.log('Last known location failed:', error2);
      }
    }

    if (!position) {
      console.log('No location found after all attempts');
      return null;
    }

    const { latitude, longitude } = position.coords;
    const mapsUrl = `https://maps.google.com/?q=${latitude},${longitude}`;

    const emergencyMessage = `🚨 SAATHI EMERGENCY ALERT

I may be in danger and need help.

📍 My live location:
${mapsUrl}

⏰ Time: ${new Date().toLocaleString()}

Please call me immediately or contact emergency services.

Emergency Number: 112`;

    return {
      available: true,
      latitude,
      longitude,
      mapsUrl,
      message: emergencyMessage,
    };
  } catch (error) {
    console.log('Location error full:', error);
    return null;
  }
}
async function getSOSLocation() {
  try {
    console.log('📍 Starting SOS location fetch...');

    const servicesEnabled = await Location.hasServicesEnabledAsync();
    console.log('📍 Location services enabled:', servicesEnabled);

    if (!servicesEnabled) {
      Alert.alert(
        'Location Off',
        'Please turn on Location Services from your phone settings.'
      );

      const lastLocation = await getLastKnownLocation();

      if (lastLocation) {
        console.log('📍 Location off, using last known location:', lastLocation);
        return lastLocation;
      }

      return {
        available: false,
      };
    }

    const permission = await Location.requestForegroundPermissionsAsync();
    console.log('📍 Location permission:', permission.status);

    if (permission.status !== 'granted') {
      Alert.alert(
        'Location Permission Needed',
        'Please allow location permission for SAATHI / Expo Go.'
      );

      const lastLocation = await getLastKnownLocation();

      if (lastLocation) {
        console.log('📍 Permission denied, using last known location:', lastLocation);
        return lastLocation;
      }

      return {
        available: false,
      };
    }

    let position = null;

    try {
      position = await Location.getCurrentPositionAsync({});
      console.log('📍 Current location success:', position);
    } catch (error) {
      console.log('📍 Current location failed:', error);

      try {
        position = await Location.getLastKnownPositionAsync();
        console.log('📍 Device last known location:', position);
      } catch (lastError) {
        console.log('📍 Device last known location failed:', lastError);
      }
    }

    if (!position) {
      console.log('📍 No current position found, trying saved last known location');

      const lastLocation = await getLastKnownLocation();

      if (lastLocation) {
        console.log('📍 Using saved last known location:', lastLocation);
        return lastLocation;
      }

      return {
        available: false,
      };
    }

    const { latitude, longitude } = position.coords;

    const mapsUrl = `https://maps.google.com/?q=${latitude},${longitude}`;

    const emergencyMessage = `🚨 SAATHI EMERGENCY ALERT

I may be in danger and need help.

📍 My live location:
${mapsUrl}

⏰ Time: ${new Date().toLocaleString()}

Please call me immediately or contact emergency services.

Emergency Number: 112`;

    const locationData = {
      available: true,
      isLastKnown: false,
      latitude,
      longitude,
      mapsUrl,
      message: emergencyMessage,
    };

    await saveLastKnownLocation(locationData);

    return locationData;
  } catch (error) {
    console.log('📍 SOS location error full:', error);

    const lastLocation = await getLastKnownLocation();

    if (lastLocation) {
      console.log('📍 Error happened, using saved last known location:', lastLocation);
      return lastLocation;
    }

    return {
      available: false,
    };
  }
}
function GlowCircle() {
  // Background glow decorations removed for a cleaner, darker look.
  return null;
}
function OfflineBanner({ isOffline }) {
  if (!isOffline) return null;

  return (
    <View
      style={{
        marginHorizontal: 20,
        marginTop: 12,
        padding: 12,
        borderRadius: 16,
        backgroundColor: 'rgba(255, 179, 71, 0.16)',
        borderWidth: 1,
        borderColor: 'rgba(255, 179, 71, 0.35)',
      }}
    >
      <Text style={{ color: C.yellow, fontWeight: '900', fontSize: 13 }}>
        ⚠️ Offline Mode Active
      </Text>

      <Text style={{ color: C.white60, fontSize: 12, marginTop: 4, lineHeight: 18 }}>
        Emergency call, SMS, audio recording, saved contacts, and last known location still work.
      </Text>
    </View>
  );
}
function PinModal({ visible, pin, setPin, onCancel, onConfirm }) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.72)',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <GlassCard style={{ gap: 14, borderColor: C.pink + '45' }}>
          <Text style={{ fontSize: 34 }}>🔐</Text>

          <Text style={{ color: C.white, fontSize: 20, fontWeight: '900' }}>
            Enter PIN to delete
          </Text>

          <Text style={{ color: C.white60, fontSize: 13, lineHeight: 20 }}>
            Evidence records are sensitive. Enter your delete PIN to continue.
          </Text>

          <TextInput
            style={styles.glassInput}
            placeholder="Enter PIN"
            placeholderTextColor={C.white40}
            keyboardType="number-pad"
            secureTextEntry
            value={pin}
            onChangeText={setPin}
            maxLength={6}
          />

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: C.pink }]}
            onPress={onConfirm}
          >
            <Text style={styles.primaryBtnText}>Delete Evidence</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              {
                backgroundColor: 'transparent',
                borderWidth: 1,
                borderColor: C.white15,
              },
            ]}
            onPress={onCancel}
          >
            <Text style={[styles.primaryBtnText, { color: C.white70 }]}>Cancel</Text>
          </TouchableOpacity>
        </GlassCard>
      </View>
    </Modal>
  );
}
function GlassCard({ children, style, onPress }) {
  const Wrapper = onPress ? TouchableOpacity : View;

  return (
    <Wrapper
      onPress={onPress}
      style={[
        {
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: C.cardBorder,
          borderRadius: 20,
          padding: 16,
        },
        style,
      ]}
    >
      {children}
    </Wrapper>
  );
}

function SplashScreen({ onDone }) {
  const scale = useRef(new Animated.Value(0.5)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        tension: 40,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(onDone, 1600);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center' }]}>
      <GlowCircle color={C.purple} size={300} style={{ top: -60, left: -90 }} />
      <GlowCircle color={C.pink} size={220} style={{ bottom: 60, right: -80 }} />

      <Animated.View style={{ alignItems: 'center', opacity, transform: [{ scale }] }}>
        <View style={styles.splashLogo}>
          <Text style={{ fontSize: 44 }}>🛡️</Text>
        </View>

        <Text style={styles.splashTitle}>SAATHI</Text>
        <Text style={styles.splashSub}>Your Safety Companion</Text>
      </Animated.View>
    </View>
  );
}

const SLIDES = [
  {
    emoji: '🛡️',
    title: 'Always Protected',
    sub: 'Hold SOS, capture location, call emergency, and alert trusted contacts.',
    color: C.purple,
  },
  {
    emoji: '🎙️',
    title: 'Audio Evidence',
    sub: 'Record audio during SOS and share it as evidence.',
    color: C.pink,
  },
  {
    emoji: '🗺️',
    title: 'Safe Trip',
    sub: 'Share trip status, start timer, and check in safely.',
    color: C.teal,
  },
];

function OnboardingScreen({ onDone }) {
  const [index, setIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;

  const next = () => {
    if (index < SLIDES.length - 1) {
      Animated.timing(fade, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start(() => {
        setIndex(index + 1);
        Animated.timing(fade, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }).start();
      });
    } else {
      onDone();
    }
  };

  const slide = SLIDES[index];

  return (
    <View style={[styles.screen, { justifyContent: 'space-between', paddingBottom: 50 }]}>
      <GlowCircle
        color={slide.color}
        size={380}
        style={{ top: -120, left: width / 2 - 190 }}
      />

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={{ alignItems: 'center', opacity: fade }}>
          <View style={[styles.onboardIcon, { borderColor: slide.color + '50' }]}>
            <Text style={{ fontSize: 64 }}>{slide.emoji}</Text>
          </View>

          <Text style={styles.onboardTitle}>{slide.title}</Text>
          <Text style={styles.onboardSub}>{slide.sub}</Text>
        </Animated.View>
      </View>

      <View style={{ alignItems: 'center', gap: 20 }}>
        <View style={styles.dotsRow}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === index && {
                  width: 24,
                  backgroundColor: slide.color,
                },
              ]}
            />
          ))}
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: slide.color }]}
          onPress={next}
        >
          <Text style={styles.primaryBtnText}>
            {index === SLIDES.length - 1 ? "Let's Go →" : 'Next →'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function LoginScreen({ onLogin }) {
  const [phone, setPhone] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { justifyContent: 'center', paddingHorizontal: 24 }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <GlowCircle color={C.purple} size={300} style={{ top: -90, right: -90 }} />
      <GlowCircle color={C.pink} size={200} style={{ bottom: 120, left: -70 }} />

      <Text style={styles.loginTitle}>Welcome to{'\n'}SAATHI 🛡️</Text>
      <Text style={styles.loginSub}>Enter your phone number to get started</Text>

      {!otpSent ? (
        <View style={{ marginTop: 32, gap: 16 }}>
          <View style={styles.inputRow}>
            <View style={styles.countryCode}>
              <Text style={{ color: C.white, fontSize: 15 }}>🇮🇳 +91</Text>
            </View>

            <TextInput
              style={styles.input}
              placeholder="98765 43210"
              placeholderTextColor={C.white40}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
              maxLength={10}
            />
          </View>

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              {
                backgroundColor: C.purple,
                opacity: phone.length < 10 ? 0.5 : 1,
              },
            ]}
            onPress={async () => {
              if (phone.length < 10 || busy) return;
              setBusy(true);
              try {
                const res = await fetch(`${BASE_URL}/api/auth/send-otp`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ phone: '+91' + phone }),
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                  Alert.alert('Could not send OTP', data.error || 'Please try again.');
                } else {
                  setOtpSent(true);
                }
              } catch (e) {
                Alert.alert('Connection error', 'Could not reach the server. Check the server URL and your internet.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Send OTP →</Text>
            )}
          </TouchableOpacity>

          <Text style={{ color: C.white40, fontSize: 12, textAlign: 'center' }}>
            Dev mode: use any number
          </Text>
        </View>
      ) : (
        <View style={{ marginTop: 32, gap: 16 }}>
          <Text style={{ color: C.white70, textAlign: 'center' }}>OTP sent to +91 {phone}</Text>

          <TextInput
            style={[
              styles.input,
              {
                textAlign: 'center',
                fontSize: 24,
                letterSpacing: 8,
                borderRadius: 16,
                backgroundColor: C.white08,
              },
            ]}
            placeholder="------"
            placeholderTextColor={C.white40}
            keyboardType="numeric"
            value={otp}
            onChangeText={setOtp}
            maxLength={6}
          />

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              {
                backgroundColor: C.purple,
                opacity: otp.length < 4 ? 0.5 : 1,
              },
            ]}
            onPress={async () => {
              if (otp.length < 4 || busy) return;
              setBusy(true);
              try {
                const res = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ phone: '+91' + phone, code: otp }),
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                  Alert.alert('Login failed', data.error || 'Invalid or expired OTP.');
                  return;
                }
                await SecureStore.setItemAsync('token', data.accessToken);
                if (data.refreshToken) await SecureStore.setItemAsync('refreshToken', data.refreshToken);
                if (data.user) await SecureStore.setItemAsync('user', JSON.stringify(data.user));
                onLogin();
              } catch (e) {
                Alert.alert('Connection error', 'Could not reach the server. Check your internet and try again.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Verify & Enter →</Text>
            )}
          </TouchableOpacity>

          <Text style={{ color: C.white40, fontSize: 12, textAlign: 'center' }}>
            Dev mode: enter code 123456
          </Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function HomeScreen({ navigate, contacts, isOffline }) {
  const pulse = useRef(new Animated.Value(1)).current;
  ;
  const [sosHeld, setSosHeld] = useState(false);
  const holdProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.08,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const handleSosIn = () => {
    setSosHeld(true);

    Animated.timing(holdProgress, {
      toValue: 1,
      duration: 1500,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        setSosHeld(false);
        holdProgress.setValue(0);

        navigate('sos');
      }
    });
  };

  const handleSosOut = () => {
    setSosHeld(false);
    holdProgress.stopAnimation();
    holdProgress.setValue(0);
  };

  const progressWidth = holdProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.screen}>


      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.homeHeader}>
          <View>
            <Text style={styles.homeName}>Stay Safe</Text>
          </View>

          <TouchableOpacity style={styles.avatarBtn} onPress={() => navigate('profile')}>
  <Text style={{ fontSize: 22 }}>👤</Text>
</TouchableOpacity>
        </View>
<OfflineBanner isOffline={isOffline} />
        <View style={styles.statusChip}>
          <View style={styles.statusDot} />
          <Text style={styles.statusChipText}>Protected • Hold SOS for emergency</Text>
        </View>

        <View style={{ alignItems: 'center', marginVertical: 36 }}>
          <Text style={styles.sosHint}>HOLD 1.5s TO TRIGGER SOS</Text>

          <Animated.View style={[styles.sosOuter, { transform: [{ scale: pulse }] }]}>
            <TouchableOpacity onPressIn={handleSosIn} onPressOut={handleSosOut} activeOpacity={0.9}>
              <View style={styles.sosInner}>
                <View style={styles.sosCore}>
                  <Text style={styles.sosBtnText}>SOS</Text>
                </View>

                <Animated.View style={[styles.sosProgress, { width: progressWidth }]} />
              </View>
            </TouchableOpacity>
          </Animated.View>
          <Text style={styles.sosBtnSub}>
            {sosHeld ? 'Getting location…' : 'Hold to activate'}
          </Text>

          <Text style={{ color: C.white40, fontSize: 12, marginTop: 16 }}>
            GPS location will be captured
          </Text>
        </View>

        <Text style={styles.sectionLabel}>QUICK ACTIONS</Text>

        <View style={styles.actionGrid}>
          {[
            { icon: 'call-outline', label: 'Fake\nCall', color: C.purple, screen: 'fakecall' },
            { icon: 'map-outline', label: 'Safe\nTrip', color: C.teal, screen: 'trip' },
            { icon: 'time-outline', label: 'Check\nIn', color: C.yellow, screen: 'checkin' },
            { icon: 'medkit-outline', label: 'Nearby\nHelp', color: C.pink, screen: 'nearby' },
            { icon: 'compass-outline', label: 'Safety\nGuide', color: C.yellow, screen: 'guide' },
            { icon: 'alarm-light-outline', label: 'Siren\nAlarm', color: C.pink, screen: 'siren' },
            { icon: 'medical-outline', label: 'Med\nCard', color: C.teal, screen: 'emergencyCard' },
            { icon: 'airplane-outline', label: 'Tourist\nMode', color: C.teal, screen: 'tourist' },
            { icon: 'people-outline', label: 'Family\nCircles', color: C.purple, screen: 'circles' },
          ].map((item) => (
            <TouchableOpacity key={item.label} style={styles.actionCard} onPress={() => navigate(item.screen)}>
              <View
                style={[
                  styles.actionIconWrap,
                  {
                    backgroundColor: item.color + '20',
                    borderColor: item.color + '40',
                  },
                ]}
              >
                <Ionicons name={item.icon} size={26} color={item.color} />
              </View>

              <Text style={styles.actionLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
<TouchableOpacity
  style={[styles.primaryBtn, { backgroundColor: C.purple, marginHorizontal: 20, marginTop: 16 }]}
  onPress={() => navigate('evidence')}
>
  <Text style={styles.primaryBtnText}>📁 Evidence History</Text>
</TouchableOpacity>
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>TRUSTED CIRCLE</Text>

        <GlassCard style={{ gap: 12, marginHorizontal: 20, marginTop: 12 }}>
          {contacts.length === 0 ? (
            <Text style={{ color: C.white40, textAlign: 'center' }}>No contacts added yet</Text>
          ) : (
            contacts.map((c) => (
              <View key={c.id} style={styles.contactRow}>
                <View
                  style={[
                    styles.contactAvatar,
                    {
                      backgroundColor: (c.color || C.purple) + '30',
                      borderColor: (c.color || C.purple) + '50',
                    },
                  ]}
                >
                  <Text style={{ fontSize: 20 }}>{c.emoji || '👤'}</Text>
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.white, fontWeight: '600', fontSize: 15 }}>{c.name}</Text>
                  <Text style={{ color: C.white40, fontSize: 12 }}>
                    {c.rel || 'Trusted Contact'} • Ready for SOS
                  </Text>
                </View>

                <View style={styles.onlineDot} />
              </View>
            ))
          )}

          <TouchableOpacity style={styles.addContactBtn} onPress={() => navigate('contacts')}>
            <Text style={{ color: C.purple, fontWeight: '600', fontSize: 14 }}>+ Manage Contacts</Text>
          </TouchableOpacity>
        </GlassCard>
      </ScrollView>
    </View>
  );
}
function SOSScreen({ navigate, sosData, contacts, saveEvidenceRecord }) {
  const [elapsed, setElapsed] = useState(0);
  const [recording, setRecording] = useState(null);
  const [recordingUri, setRecordingUri] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [sosSteps, setSosSteps] = useState([
    {
      id: 'activated',
      icon: '🚨',
      title: 'SOS activated',
      sub: 'Emergency mode started',
      done: true,
    },
  ]);

  const pulse = useRef(new Animated.Value(1)).current;
  const recordingRef = useRef(null);

  const addStep = (step) => {
    setSosSteps((prev) => {
      const alreadyExists = prev.some((item) => item.id === step.id);
      if (alreadyExists) {
        return prev.map((item) => (item.id === step.id ? { ...item, ...step } : item));
      }
      return [...prev, step];
    });
  };

  const fmt = (s) =>
    `${Math.floor(s / 60)
      .toString()
      .padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const sosHandledRef = useRef(false);
  useEffect(() => {
    if (!sosData || !sosData.available || sosData.latitude == null || sosHandledRef.current) return;
    sosHandledRef.current = true;
    addStep({
      id: 'location',
      icon: sosData.isLastKnown ? '⚠️' : '📍',
      title: sosData.isLastKnown ? 'Using last known location' : 'Location captured',
      sub: `${sosData.latitude.toFixed(5)}, ${sosData.longitude.toFixed(5)}`,
      done: true,
    });
    startBackgroundLocation('sos', null);
    if (contacts.length) {
      triggerBackendSOS(sosData.latitude, sosData.longitude, contacts).then((r) => {
        if (r && r.success) {
          addStep({ id: 'auto-alert', icon: r.delivery === 'live' ? '✅' : '⚠️', title: r.delivery === 'live' ? `Alert sent to ${r.contactsAlerted} contact(s)` : 'Test mode: alert simulated', sub: r.delivery === 'live' ? 'Your contacts were notified by SMS/WhatsApp' : 'No real SMS sent yet — enable Twilio to send for real', done: r.delivery === 'live' });
        } else {
          addStep({ id: 'auto-alert', icon: '⚠️', title: 'Auto-alert could not be sent', sub: 'Use "SMS Trusted Contacts" below as a backup', done: false });
        }
      });
    }
  }, [sosData]);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);

Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

setTimeout(() => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
}, 300);

setTimeout(() => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
}, 650);
    if (sosData?.available) {
      addStep({
  id: 'location',
  icon: sosData?.isLastKnown ? '⚠️' : '📍',
  title: sosData?.isLastKnown ? 'Using last known location' : 'Location captured',
  sub: `${sosData.latitude.toFixed(5)}, ${sosData.longitude.toFixed(5)}`,
  done: true,
});
    } else {
      addStep({
        id: 'location',
        icon: '📍',
        title: 'Location unavailable',
        sub: 'You can still record and call emergency services',
        done: false,
      });
    }

    addStep({
      id: 'contacts',
      icon: '👥',
      title: contacts.length
        ? `${contacts.length} trusted contact${contacts.length === 1 ? '' : 's'} ready`
        : 'No trusted contacts added',
      sub: contacts.length
        ? 'Tap SMS Trusted Contacts to send alert'
        : 'Add contacts later from the contacts screen',
      done: contacts.length > 0,
    });

    setTimeout(() => {
      startRecording();
    }, 600);

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.2,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    ).start();

    return () => {
      clearInterval(timer);
      // Release the mic if the user leaves SOS without tapping Cancel.
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }
      Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    };
  }, []);

  const callEmergency = () => {
    addStep({
      id: 'call',
      icon: '📞',
      title: 'Emergency call opened',
      sub: 'Calling 112 from your phone',
      done: true,
    });

    Linking.openURL('tel:112');
  };

  const shareLocation = async () => {
    if (!sosData?.available) {
      Alert.alert('No Location', 'Location is not available yet.');
      return;
    }

    addStep({
      id: 'location-share',
      icon: '📤',
      title: 'Location share opened',
      sub: 'Share your live emergency location',
      done: true,
    });

    await Share.share({
      message: sosData.message,
    });
  };

  const openMaps = () => {
    if (!sosData?.mapsUrl) {
      Alert.alert('No Location', 'Location is not available yet.');
      return;
    }

    Linking.openURL(sosData.mapsUrl);
  };

  const smsTrustedContacts = () => {
    if (!sosData?.available) {
      Alert.alert('No Location', 'Location is not available yet.');
      return;
    }

    if (!contacts.length) {
      Alert.alert('No Contacts', 'Please add trusted contacts first.');
      return;
    }

    addStep({
      id: 'sms',
      icon: '💬',
      title: 'SMS alert prepared',
      sub: 'Send the message from your SMS app',
      done: true,
    });

    const numbers = contacts.map((c) => c.phone.replace(/\s/g, '')).join(',');
    const body = encodeURIComponent(sosData.message);
    const separator = Platform.OS === 'ios' ? '&' : '?';

    Linking.openURL(`sms:${numbers}${separator}body=${body}`);
  };

  const startRecording = async () => {
    try {
      if (isRecording || recording) return;

      const permission = await Audio.requestPermissionsAsync();

      if (permission.status !== 'granted') {
        addStep({
          id: 'recording',
          icon: '🎙️',
          title: 'Recording permission denied',
          sub: 'Microphone permission is needed for audio evidence',
          done: false,
        });

        Alert.alert(
          'Microphone Permission Needed',
          'SAATHI needs microphone permission to record evidence.'
        );
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      setRecording(newRecording);
      recordingRef.current = newRecording;
      setIsRecording(true);
      setRecordingUri(null);

      addStep({
        id: 'recording',
        icon: '🎙️',
        title: 'Audio recording started',
        sub: 'Evidence is being captured in the background',
        done: true,
      });
    } catch (error) {
      addStep({
        id: 'recording',
        icon: '🎙️',
        title: 'Recording failed',
        sub: 'Could not start audio evidence recording',
        done: false,
      });

      Alert.alert('Recording Error', 'Could not start recording.');
    }
  };

  const stopRecording = async () => {
    try {
      if (!recording) return;

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();

let savedAudioUri = uri;

try {
  const fileName = `saathi-evidence-${Date.now()}.m4a`;
  const permanentPath = `${FileSystem.documentDirectory}${fileName}`;

  await FileSystem.copyAsync({
    from: uri,
    to: permanentPath,
  });

  savedAudioUri = permanentPath;

  console.log('Audio saved permanently:', savedAudioUri);
} catch (copyError) {
  console.log('Permanent audio save failed, using original URI:', copyError);
}

setRecording(null);
recordingRef.current = null;
setIsRecording(false);
setRecordingUri(savedAudioUri);
if (saveEvidenceRecord) {
  saveEvidenceRecord({
  id: Date.now().toString(),
  createdAt: new Date().toISOString(),
  audioUri: savedAudioUri,
  locationAvailable: !!sosData?.available,
  latitude: sosData?.latitude || null,
  longitude: sosData?.longitude || null,
  mapsUrl: sosData?.mapsUrl || null,
  message: sosData?.message || '',
  trustedContacts: contacts.map((c) => ({
    name: c.name,
    phone: c.phone,
    relation: c.rel || 'Trusted Contact',
  })),
});
}

      addStep({
        id: 'recording-saved',
        icon: '✅',
        title: 'Audio evidence saved',
        sub: 'Recording is ready to share',
        done: true,
      });

      Alert.alert('Recording Saved', 'Audio evidence has been saved inside the app.');
    } catch (error) {
      Alert.alert('Recording Error', 'Could not stop recording.');
    }
  };

  const shareRecording = async () => {
    try {
      if (!recordingUri) {
        Alert.alert('No Recording', 'Please stop and save the recording first.');
        return;
      }

      setIsSharing(true);

      const canShare = await Sharing.isAvailableAsync();

      if (!canShare) {
        setIsSharing(false);
        Alert.alert('Sharing Not Available', 'Sharing is not available on this device.');
        return;
      }

      await Sharing.shareAsync(recordingUri, {
        dialogTitle: 'Share SAATHI Audio Evidence',
        mimeType: 'audio/m4a',
        UTI: 'public.audio',
      });

      addStep({
        id: 'recording-shared',
        icon: '📤',
        title: 'Audio share opened',
        sub: 'Send the recording through any app',
        done: true,
      });

      setIsSharing(false);
    } catch (error) {
      setIsSharing(false);
      console.log('Share recording error:', error);
      Alert.alert(
        'Share Error',
        error?.message || 'Could not share the audio recording. Try recording again.'
      );
    }
  };

  const cancelSOS = () => {
    Alert.alert(
      'Cancel SOS?',
      'Are you safe now? This will close emergency mode.',
      [
        {
          text: 'Stay in SOS',
          style: 'cancel',
        },
        {
          text: 'I am Safe',
          style: 'destructive',
          onPress: async () => {
            if (isRecording && recording) {
              try {
                await stopRecording();
              } catch (error) {
                console.log('Stop recording while cancelling failed:', error);
              }
            }

            navigate('home');
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: '#160B0E' }]}>
      <GlowCircle
        color="#D9637A"
        size={400}
        style={{ top: -100, alignSelf: 'center', left: width / 2 - 200 }}
      />

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ alignItems: 'center', marginTop: 60 }}>
          <View style={styles.liveRow}>
            <View style={styles.liveDot2} />
            <Text style={styles.liveText2}>SOS ACTIVE</Text>
            <Text style={styles.elapsedText}>{fmt(elapsed)}</Text>
          </View>

          <Animated.View style={[styles.sosActivePulse, { transform: [{ scale: pulse }] }]}>
            <View style={styles.sosActiveCircle}>
              <Text style={{ fontSize: 64 }}>🚨</Text>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 3 }}>
                EMERGENCY
              </Text>
            </View>
          </Animated.View>

          <Text style={{ color: C.white60, fontSize: 13, marginTop: 10 }}>
            Stay calm. Evidence and location are being prepared.
          </Text>
        </View>

        <View style={{ paddingHorizontal: 24, gap: 12, marginTop: 24 }}>
          <GlassCard style={{ borderColor: 'rgba(255,0,64,0.3)', gap: 14 }}>
            <Text style={{ color: C.white, fontSize: 16, fontWeight: '800' }}>
              Emergency Status
            </Text>

            {sosSteps.map((item) => (
              <View key={item.id} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <Text style={{ fontSize: 22 }}>{item.icon}</Text>

                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.white, fontWeight: '700', fontSize: 14 }}>
                    {item.title}
                  </Text>
                  <Text style={{ color: C.white40, fontSize: 12 }}>{item.sub}</Text>
                </View>

                <Text style={{ color: item.done ? '#00C87A' : C.yellow, fontSize: 16 }}>
                  {item.done ? '✓' : '!'}
                </Text>
              </View>
            ))}
          </GlassCard>

          <GlassCard style={{ borderColor: 'rgba(255,255,255,0.08)', gap: 10 }}>
            <Text style={{ color: C.white, fontSize: 16, fontWeight: '800' }}>
              Evidence Recorder
            </Text>

            <Text style={{ color: C.white40, fontSize: 13 }}>
              {isRecording
                ? 'Recording is active. Stop it before sharing.'
                : recordingUri
                  ? 'Recording saved. You can share it now.'
                  : 'Recording will start automatically when SOS opens.'}
            </Text>

            <TouchableOpacity
              style={[
                styles.primaryBtn,
                {
                  backgroundColor: isRecording ? '#FF3B30' : C.yellow,
                  marginTop: 6,
                },
              ]}
              onPress={isRecording ? stopRecording : startRecording}
            >
              <Text style={styles.primaryBtnText}>
                {isRecording ? '⏹️ Stop & Save Recording' : '🎙️ Start Recording'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.primaryBtn,
                {
                  backgroundColor: C.purple,
                  opacity: recordingUri && !isSharing ? 1 : 0.5,
                },
              ]}
              onPress={shareRecording}
              disabled={!recordingUri || isSharing}
            >
              <Text style={styles.primaryBtnText}>
                {isSharing ? 'Preparing Share...' : '📤 Share Audio Evidence'}
              </Text>
            </TouchableOpacity>
          </GlassCard>

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: '#00C87A' }]}
            onPress={callEmergency}
          >
            <Text style={styles.primaryBtnText}>📞 Call Emergency 112</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              {
                backgroundColor: C.pink,
                opacity: sosData?.available && contacts.length ? 1 : 0.5,
              },
            ]}
            onPress={smsTrustedContacts}
          >
            <Text style={styles.primaryBtnText}>💬 SMS Trusted Contacts</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              {
                backgroundColor: C.teal,
                opacity: sosData?.available ? 1 : 0.5,
              },
            ]}
            onPress={openMaps}
          >
            <Text style={styles.primaryBtnText}>🗺️ Open Location in Maps</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              {
                backgroundColor: 'transparent',
                borderWidth: 1,
                borderColor: C.white15,
              },
            ]}
            onPress={shareLocation}
          >
            <Text style={[styles.primaryBtnText, { color: C.white70 }]}>
              📤 Share My Location
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              {
                backgroundColor: 'transparent',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.2)',
              },
            ]}
            onPress={cancelSOS}
          >
            <Text style={[styles.primaryBtnText, { color: C.white70 }]}>I am Safe / Cancel SOS</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function FakeCallScreen({ navigate }) {
  const [calling, setCalling] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [caller, setCaller] = useState('Mom');
  const [delaySec, setDelaySec] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [timer, setTimer] = useState(0);
  const pulse = useRef(new Animated.Value(1)).current;
  const soundRef = useRef(null);

  // Ring (vibration + optional ringtone) while the call is incoming and not yet answered.
  useEffect(() => {
    let active = true;

    const startRinging = async () => {
      try {
        Vibration.vibrate([0, 800, 1000, 800, 1000], true);
      } catch (e) {}

      if (!RINGTONE_URL) return;
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const { sound } = await Audio.Sound.createAsync(
          { uri: RINGTONE_URL },
          { shouldPlay: true, isLooping: true }
        );
        if (!active) {
          await sound.unloadAsync();
          return;
        }
        soundRef.current = sound;
      } catch (e) {
        console.log('Ringtone unavailable (vibration still rings):', e?.message);
      }
    };

    const stopRinging = async () => {
      try { Vibration.cancel(); } catch (e) {}
      if (soundRef.current) {
        try {
          await soundRef.current.stopAsync();
          await soundRef.current.unloadAsync();
        } catch (e) {}
        soundRef.current = null;
      }
    };

    if (calling && !answered) {
      startRinging();
    } else {
      stopRinging();
    }

    return () => {
      active = false;
      stopRinging();
    };
  }, [calling, answered]);

  // Pulse while the call screen is open; in-call timer starts once answered.
  useEffect(() => {
    if (!calling) return;

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    ).start();

    if (!answered) return;

    const t = setInterval(() => setTimer((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [calling, answered]);

  // Countdown for the delayed trigger; at 0 the call comes in.
  useEffect(() => {
    if (countdown <= 0) return;

    const id = setTimeout(() => {
      const next = countdown - 1;
      if (next <= 0) {
        setCountdown(0);
        setCalling(true);
      } else {
        setCountdown(next);
      }
    }, 1000);

    return () => clearTimeout(id);
  }, [countdown]);

  const fmt = (s) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const triggerCall = () => {
    setAnswered(false);
    setTimer(0);
    if (delaySec <= 0) {
      setCalling(true);
    } else {
      setCountdown(delaySec);
    }
  };

  const cancelPending = () => setCountdown(0);

  const endCall = () => {
    setCalling(false);
    setAnswered(false);
    setTimer(0);
  };

  if (calling) {
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: '#080E1A', justifyContent: 'space-between', paddingBottom: 60 },
        ]}
      >
        <GlowCircle
          color="#1A8FFF"
          size={300}
          style={{ top: -60, alignSelf: 'center', left: width / 2 - 150 }}
        />

        <View style={{ alignItems: 'center', marginTop: 80 }}>
          <Animated.View style={[styles.callerAvatar, { transform: [{ scale: pulse }] }]}>
            <Text style={{ fontSize: 60 }}>👩</Text>
          </Animated.View>

          <Text style={styles.callerName}>{caller}</Text>
          <Text style={styles.callerStatus}>{answered ? fmt(timer) : 'Incoming call…'}</Text>
        </View>

        <View style={styles.callBtns}>
          {!answered && (
            <TouchableOpacity style={styles.answerBtn} onPress={() => setAnswered(true)}>
              <Text style={{ fontSize: 32 }}>📞</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.hangupBtn} onPress={endCall}>
            <Text style={{ fontSize: 32 }}>📵</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <GlowCircle color={C.purple} size={250} style={{ top: -50, right: -50 }} />

      <View style={styles.screenHeader}>
        <TouchableOpacity onPress={() => navigate('home')}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.screenTitle}>Fake Call</Text>

        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 120 }}>
        <GlassCard style={{ alignItems: 'center', paddingVertical: 28 }}>
          <View style={styles.callerPreview}>
            <Text style={{ fontSize: 52 }}>👩</Text>
          </View>

          <Text style={{ color: C.white, fontSize: 22, fontWeight: '700', marginTop: 12 }}>
            {caller}
          </Text>

          <Text style={{ color: C.white40, fontSize: 14 }}>Fake incoming call</Text>
        </GlassCard>

        <Text style={styles.sectionLabel}>CHOOSE CALLER</Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {['Mom', 'Dad', 'Priya', 'Office'].map((name) => (
            <TouchableOpacity
              key={name}
              style={[
                styles.callerChip,
                caller === name && { backgroundColor: C.purple, borderColor: C.purple },
              ]}
              onPress={() => setCaller(name)}
            >
              <Text style={{ color: caller === name ? '#fff' : C.white70, fontWeight: '600' }}>
                {name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>RING AFTER</Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {[
            { label: 'Now', value: 0 },
            { label: '5s', value: 5 },
            { label: '10s', value: 10 },
            { label: '30s', value: 30 },
          ].map((opt) => (
            <TouchableOpacity
              key={opt.label}
              style={[
                styles.callerChip,
                delaySec === opt.value && { backgroundColor: C.teal, borderColor: C.teal },
              ]}
              onPress={() => setDelaySec(opt.value)}
            >
              <Text style={{ color: delaySec === opt.value ? '#001018' : C.white70, fontWeight: '600' }}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {countdown > 0 ? (
          <GlassCard style={{ alignItems: 'center', gap: 12, borderColor: C.teal + '50' }}>
            <Text style={{ color: C.teal, fontSize: 16, fontWeight: '700' }}>
              {caller} will call in {countdown}s…
            </Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: C.pink, width: '100%' }]}
              onPress={cancelPending}
            >
              <Text style={styles.primaryBtnText}>Cancel</Text>
            </TouchableOpacity>
          </GlassCard>
        ) : (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: C.teal, marginTop: 8 }]}
            onPress={triggerCall}
          >
            <Text style={styles.primaryBtnText}>
              {delaySec > 0 ? `📞 Schedule Call (${delaySec}s)` : '📞 Start Fake Call Now'}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}
function SafeTripScreen({ navigate }) {
  const [tripId, setTripId] = useState(null);
const [shareLink, setShareLink] = useState(null);
const [token, setToken] = useState('');
  const [starting, setStarting] = useState(false);
  const [active, setActive] = useState(false);
  const [dest, setDest] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [checkInMinutes, setCheckInMinutes] = useState('15');
  const [tripLocation, setTripLocation] = useState(null);
  const [tripStartedAt, setTripStartedAt] = useState(null);
  const [checkInDue, setCheckInDue] = useState(false);

  const battery15Fired = useRef(false);
  const battery5Fired = useRef(false);

  const sendLowBatteryAlert = async (level, critical) => {
    const loc = await getCurrentLocation();
    const mapsUrl = loc?.mapsUrl || 'Location unavailable';
    const pct = Math.round(level * 100);

    const message = critical
      ? `🔴 SAATHI CRITICAL: My phone is about to die (${pct}%) and may turn off soon.\n\nMy last known location:\n${mapsUrl}\n\nPlease reach me or contact help.\n\nEmergency Number: 112`
      : `⚠️ SAATHI: My phone battery is low (${pct}%) and may die soon.\n\nMy current location:\n${mapsUrl}\n\nPlease check on me.`;

    try {
      await Share.share({ message });
    } catch (e) {
      console.log('Low battery alert share error:', e);
    }
  };

  useEffect(() => {
    if (!active) return;

    let sub = null;

    const checkLevel = (level) => {
      if (level <= 0.05 && !battery5Fired.current) {
        battery5Fired.current = true;
        sendLowBatteryAlert(level, true);
      } else if (level <= 0.15 && level > 0.05 && !battery15Fired.current) {
        battery15Fired.current = true;
        sendLowBatteryAlert(level, false);
      }
    };

    (async () => {
      try {
        const current = await Battery.getBatteryLevelAsync();
        checkLevel(current);
        sub = Battery.addBatteryLevelListener(({ batteryLevel }) => checkLevel(batteryLevel));
      } catch (e) {
        console.log('Battery monitor error:', e);
      }
    })();

    return () => {
      if (sub) sub.remove();
    };
  }, [active]);

  useEffect(() => {
    const restoreTrip = async () => {
    const savedTrip =
      await SecureStore.getItemAsync('activeTrip');

    if (!savedTrip) return;

    const trip = JSON.parse(savedTrip);

    setTripId(trip.tripId);
    setShareLink(trip.shareLink);
    setDest(trip.destination);
    const startedAt = new Date(trip.startedAt);
    setTripStartedAt(startedAt);
    setElapsed(Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000)));
    setActive(true);
  };

  restoreTrip();
}, []);
useEffect(() => {
  const loadToken = async () => {
    const savedToken = await SecureStore.getItemAsync('token');
    if (savedToken) {
      setToken(savedToken);
    }
  };

  loadToken();
}, []);

  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
  if (!active || !tripId) return;

  const interval = setInterval(async () => {
    try {
      const loc = await getCurrentLocation();

      if (!loc) return;

      await fetch(
        `${BASE_URL}/api/trips/${tripId}/location`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            lat: loc.latitude,
            lng: loc.longitude,
            speed: 0,
            heading: 0,
          }),
        }
      );
      await publishCircleLocation('trip', loc.latitude, loc.longitude);
    } catch (err) {
      console.log('Location update failed', err);
    }
  }, 10000);

  return () => clearInterval(interval);
}, [active, tripId, token]);

  useEffect(() => {
    if (!active) return;

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.05,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    ).start();

    const timer = setInterval(() => {
      setElapsed((s) => {
        const next = s + 1;
        const checkSeconds = Number(checkInMinutes || 15) * 60;

        if (next >= checkSeconds) {
          setCheckInDue(true);
        }

        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [active, checkInMinutes]);

  const fmt = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}m ${sec}s`;
  };

  const startTrip = async () => {
    if (!dest.trim()) {
      Alert.alert('Destination Needed', 'Please enter your destination first.');
      return;
    }

setStarting(true);
const currentLocation = await getCurrentLocation();
if (!currentLocation) { setStarting(false); return; }
const token = await SecureStore.getItemAsync('token');

console.log('DESTINATION:', dest);

try {
  console.log('CALLING START TRIP API...');

  const response = await fetch(`${BASE_URL}/api/trips/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      destination: dest,
      durationMins: Number(checkInMinutes),
      lat: currentLocation.latitude,
      lng: currentLocation.longitude,
      checkinIntervalMins: Number(checkInMinutes),
    }),
  });

  console.log('STATUS:', response.status);
  console.log('OK:', response.ok);

  const data = await response.json();

  console.log('TRIP RESPONSE FULL:', JSON.stringify(data, null, 2));

  setTripId(data.tripId);
  await startBackgroundLocation('trip', data.tripId);
  setShareLink(data.trackingUrl);

  await SecureStore.setItemAsync(
    'activeTrip',
    JSON.stringify({
      tripId: data.tripId,
      shareLink: data.trackingUrl,
      destination: dest,
      startedAt: new Date().toISOString(),
    })
  );
} catch (error) {
  console.log('START TRIP ERROR:', error);
}

setTripLocation(currentLocation);    setTripStartedAt(new Date());
    setElapsed(0);
    setCheckInDue(false);
    setActive(true);
    setStarting(false);
};
  const shareTripStatus = async () => {
    // After an app restart the in-memory tripLocation is gone, so fetch a fresh one.
    let loc = tripLocation;
    if (!loc) {
      loc = await getCurrentLocation();
      if (loc) setTripLocation(loc);
    }
    if (!loc) {
      Alert.alert('No Trip Location', 'Could not get your location. Start Safe Trip first.');
      return;
    }

    const startedTime = tripStartedAt
      ? tripStartedAt.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'Just now';

    const message = `SAATHI Safe Trip Update

I have started a safe trip.

Destination: ${dest || 'Not set'}
Started at: ${startedTime}
Trip time: ${fmt(elapsed)}
Live tracking: ${shareLink}

I will check in soon.`;

    await Share.share({
      message,
    });
  };
  const reachedSafely = async () => {
  try {
    if (tripId) {
      await fetch(
        `${BASE_URL}/api/trips/${tripId}/end`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
    }
  } catch (error) {
    console.log(error);
  }

  await publishCircleLocation('idle');
  await stopBackgroundLocation();

  Alert.alert('Trip Completed', 'Glad you reached safely.');
await SecureStore.deleteItemAsync('activeTrip');
  setActive(false);
  setElapsed(0);
  setTripLocation(null);
  setTripStartedAt(null);
  setCheckInDue(false);
  setTripId(null);
};

  const triggerTripSOS = () => {
    navigate('sos');
  };

  const resetCheckIn = () => {
    setElapsed(0);
    setCheckInDue(false);
    Alert.alert('Check-in Confirmed', 'Timer restarted. Stay safe.');
  };

  return (
    <View style={styles.screen}>
      <GlowCircle color={C.teal} size={250} style={{ top: -50, left: -50 }} />

      <View style={styles.screenHeader}>
        <TouchableOpacity onPress={() => navigate('home')}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.screenTitle}>Safe Trip</Text>

        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 120 }}>
        {active ? (
          <>
            <GlassCard style={{ alignItems: 'center', paddingVertical: 28, borderColor: C.teal + '40' }}>
              <Animated.View
                style={[
                  styles.tripPin,
                  {
                    transform: [{ scale: pulse }],
                  },
                ]}
              >
                <Text style={{ fontSize: 36 }}>📍</Text>
              </Animated.View>

              <View style={styles.liveRow2}>
                <View style={[styles.liveDot2, { backgroundColor: checkInDue ? C.pink : C.teal }]} />
                <Text style={[styles.liveText2, { color: checkInDue ? C.pink : C.teal }]}>
                  {checkInDue ? 'CHECK-IN NEEDED' : 'LIVE TRIP ACTIVE'}
                </Text>
              </View>

              <Text style={{ color: C.white, fontSize: 18, fontWeight: '700', marginTop: 8 }}>
                {dest || 'Your destination'}
              </Text>

              <Text style={{ color: C.white40, fontSize: 14, marginTop: 4 }}>
                Trip active: {fmt(elapsed)}
              </Text>

              <Text style={{ color: C.white40, fontSize: 12, marginTop: 8, textAlign: 'center' }}>
                {tripLocation
                  ? `${tripLocation.latitude.toFixed(5)}, ${tripLocation.longitude.toFixed(5)}`
                  : 'Location loading...'}
              </Text>
            </GlassCard>

            {checkInDue && (
              <GlassCard style={{ borderColor: C.pink + '50', gap: 12 }}>
                <Text style={{ color: C.pink, fontSize: 18, fontWeight: '800' }}>Are you safe?</Text>

                <Text style={{ color: C.white60, fontSize: 13, lineHeight: 20 }}>
                  Your check-in timer is over. Confirm you are safe or trigger SOS.
                </Text>

                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: C.teal }]}
                  onPress={resetCheckIn}
                >
                  <Text style={styles.primaryBtnText}>✅ Yes, I’m Safe</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: C.pink }]}
                  onPress={triggerTripSOS}
                >
                  <Text style={styles.primaryBtnText}>🚨 Trigger SOS</Text>
                </TouchableOpacity>
              </GlassCard>
            )}

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: C.purple }]}
              onPress={shareTripStatus}
            >
              <Text style={styles.primaryBtnText}>📤 Share Trip Status</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: C.teal }]}
              onPress={reachedSafely}
            >
              <Text style={styles.primaryBtnText}>✅ I Reached Safely</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: C.pink }]}
              onPress={triggerTripSOS}
            >
              <Text style={styles.primaryBtnText}>🚨 Trigger SOS Now</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <GlassCard style={{ gap: 14 }}>
              <Text style={styles.inputLabel}>DESTINATION</Text>

              <TextInput
                style={styles.glassInput}
                placeholder="e.g. Home, Office, College"
                placeholderTextColor={C.white40}
                value={dest}
                onChangeText={setDest}
              />
            </GlassCard>

            <GlassCard style={{ gap: 14 }}>
              <Text style={styles.inputLabel}>CHECK-IN TIMER</Text>

              <TextInput
                style={styles.glassInput}
                placeholder="15"
                placeholderTextColor={C.white40}
                keyboardType="numeric"
                value={checkInMinutes}
                onChangeText={setCheckInMinutes}
              />

              <Text style={{ color: C.white40, fontSize: 12 }}>
                After this many minutes, SAATHI will ask if you are safe.
              </Text>
            </GlassCard>

            <GlassCard style={{ gap: 10 }}>
              <Text style={styles.inputLabel}>WHAT HAPPENS</Text>

              {[
                'Captures your current GPS location',
                'Starts a live trip timer',
                'Lets you share trip status with location',
                'Shows check-in alert when timer ends',
                'Can trigger SOS directly from Safe Trip',
              ].map((t) => (
                <View key={t} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                  <Text style={{ color: C.teal, fontSize: 14 }}>→</Text>
                  <Text style={{ color: C.white70, fontSize: 13, flex: 1 }}>{t}</Text>
                </View>
              ))}
            </GlassCard>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: C.teal, opacity: starting ? 0.7 : 1 }]}
              onPress={startTrip}
              disabled={starting}
            >
              {starting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>🗺️ Start Safe Trip</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function CheckInScreen({ navigate }) {
  const [active, setActive] = useState(false);
  const [minutes, setMinutes] = useState('15');

  return (
    <View style={styles.screen}>
      <GlowCircle color={C.yellow} size={260} style={{ top: -50, right: -50 }} />

      <View style={styles.screenHeader}>
        <TouchableOpacity onPress={() => navigate('home')}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.screenTitle}>Check In</Text>

        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 120 }}>
        <GlassCard style={{ alignItems: 'center', paddingVertical: 30 }}>
          <View style={styles.checkIcon}>
            <Text style={{ fontSize: 42 }}>⏱️</Text>
          </View>

          <Text style={{ color: C.white, fontSize: 24, fontWeight: '800', marginTop: 16 }}>
            {active ? 'Check-in Active' : 'Set Safety Timer'}
          </Text>

          <Text
            style={{
              color: C.white40,
              fontSize: 14,
              textAlign: 'center',
              marginTop: 8,
              lineHeight: 22,
            }}
          >
            {active
              ? `SAATHI will ask you to check in after ${minutes} minutes.`
              : 'If you do not check in on time, your trusted circle can be alerted later.'}
          </Text>
        </GlassCard>

        {!active && (
          <GlassCard style={{ gap: 14 }}>
            <Text style={styles.inputLabel}>TIMER IN MINUTES</Text>

            <TextInput
              style={styles.glassInput}
              placeholder="15"
              placeholderTextColor={C.white40}
              keyboardType="numeric"
              value={minutes}
              onChangeText={setMinutes}
            />
          </GlassCard>
        )}

        <TouchableOpacity
          style={[
            styles.primaryBtn,
            {
              backgroundColor: active ? '#FF3B30' : C.yellow,
            },
          ]}
          onPress={() => setActive(!active)}
        >
          <Text style={styles.primaryBtnText}>{active ? 'Cancel Check In' : 'Start Check In'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
// ============================================================
// TOURIST MODE — paste this whole block into App.js
// (place it right BEFORE  function EmergencyCardScreen(  )
// ============================================================

const TOURIST_DATA = [
  {
    code: 'IN', flag: '🇮🇳', name: 'India',
    numbers: { Emergency: '112', Police: '100', Ambulance: '108', Fire: '101' },
    lang: 'Hindi',
    phrases: [
      { en: 'I need help', local: 'मुझे मदद चाहिए' },
      { en: 'Call the police', local: 'पुलिस को बुलाओ' },
      { en: 'I need a doctor', local: 'मुझे डॉक्टर चाहिए' },
      { en: 'I am lost', local: 'मैं रास्ता भटक गया हूँ' },
      { en: 'Where is the hospital?', local: 'अस्पताल कहाँ है?' },
      { en: 'Please help me', local: 'कृपया मेरी मदद करें' },
    ],
  },
  {
    code: 'US', flag: '🇺🇸', name: 'USA',
    numbers: { Emergency: '911' },
    lang: 'English',
    phrases: [
      { en: 'I need help', local: 'I need help' },
      { en: 'Call the police', local: 'Call the police' },
      { en: 'I need a doctor', local: 'I need a doctor' },
      { en: 'I am lost', local: 'I am lost' },
      { en: 'Where is the hospital?', local: 'Where is the hospital?' },
      { en: 'Please help me', local: 'Please help me' },
    ],
  },
  {
    code: 'GB', flag: '🇬🇧', name: 'United Kingdom',
    numbers: { Emergency: '999', Alternate: '112' },
    lang: 'English',
    phrases: [
      { en: 'I need help', local: 'I need help' },
      { en: 'Call the police', local: 'Call the police' },
      { en: 'I need a doctor', local: 'I need a doctor' },
      { en: 'I am lost', local: 'I am lost' },
      { en: 'Where is the hospital?', local: 'Where is the hospital?' },
      { en: 'Please help me', local: 'Please help me' },
    ],
  },
  {
    code: 'FR', flag: '🇫🇷', name: 'France',
    numbers: { Emergency: '112', Police: '17', Ambulance: '15', Fire: '18' },
    lang: 'French',
    phrases: [
      { en: 'I need help', local: "J'ai besoin d'aide" },
      { en: 'Call the police', local: 'Appelez la police' },
      { en: 'I need a doctor', local: "J'ai besoin d'un médecin" },
      { en: 'I am lost', local: 'Je suis perdu(e)' },
      { en: 'Where is the hospital?', local: "Où est l'hôpital ?" },
      { en: 'Please help me', local: "Aidez-moi, s'il vous plaît" },
    ],
  },
  {
    code: 'JP', flag: '🇯🇵', name: 'Japan',
    numbers: { Police: '110', 'Ambulance/Fire': '119' },
    lang: 'Japanese',
    phrases: [
      { en: 'I need help', local: '助けてください (Tasukete kudasai)' },
      { en: 'Call the police', local: '警察を呼んでください (Keisatsu o yonde kudasai)' },
      { en: 'I need a doctor', local: '医者が必要です (Isha ga hitsuyō desu)' },
      { en: 'I am lost', local: '道に迷いました (Michi ni mayoimashita)' },
      { en: 'Where is the hospital?', local: '病院はどこですか (Byōin wa doko desu ka)' },
      { en: 'Please help me', local: '助けて (Tasukete)' },
    ],
  },
  {
    code: 'AE', flag: '🇦🇪', name: 'UAE',
    numbers: { Police: '999', Ambulance: '998', Fire: '997' },
    lang: 'Arabic',
    phrases: [
      { en: 'I need help', local: 'أحتاج مساعدة (Ahtaj musaada)' },
      { en: 'Call the police', local: 'اتصل بالشرطة (Ittasil bil-shurta)' },
      { en: 'I need a doctor', local: 'أحتاج طبيب (Ahtaj tabib)' },
      { en: 'I am lost', local: 'أنا تائه (Ana taeh)' },
      { en: 'Where is the hospital?', local: 'أين المستشفى؟ (Ayna al-mustashfa?)' },
      { en: 'Please help me', local: 'ساعدني من فضلك (Saidni min fadlik)' },
    ],
  },
  {
    code: 'TH', flag: '🇹🇭', name: 'Thailand',
    numbers: { Emergency: '112', Police: '191', Ambulance: '1669', Fire: '199' },
    lang: 'Thai',
    phrases: [
      { en: 'I need help', local: 'ช่วยด้วย (Chuay duay)' },
      { en: 'Call the police', local: 'เรียกตำรวจ (Riak tamruat)' },
      { en: 'I need a doctor', local: 'ฉันต้องการหมอ (Chan tongkan mor)' },
      { en: 'I am lost', local: 'ฉันหลงทาง (Chan long thang)' },
      { en: 'Where is the hospital?', local: 'โรงพยาบาลอยู่ที่ไหน (Rong phayaban yu thi nai)' },
      { en: 'Please help me', local: 'กรุณาช่วยฉัน (Karuna chuay chan)' },
    ],
  },
  {
    code: 'SG', flag: '🇸🇬', name: 'Singapore',
    numbers: { Police: '999', 'Ambulance/Fire': '995', Alternate: '112' },
    lang: 'English',
    phrases: [
      { en: 'I need help', local: 'I need help' },
      { en: 'Call the police', local: 'Call the police' },
      { en: 'I need a doctor', local: 'I need a doctor' },
      { en: 'I am lost', local: 'I am lost' },
      { en: 'Where is the hospital?', local: 'Where is the hospital?' },
      { en: 'Please help me', local: 'Please help me' },
    ],
  },
  {
    code: 'AU', flag: '🇦🇺', name: 'Australia',
    numbers: { Emergency: '000', Alternate: '112' },
    lang: 'English',
    phrases: [
      { en: 'I need help', local: 'I need help' },
      { en: 'Call the police', local: 'Call the police' },
      { en: 'I need a doctor', local: 'I need a doctor' },
      { en: 'I am lost', local: 'I am lost' },
      { en: 'Where is the hospital?', local: 'Where is the hospital?' },
      { en: 'Please help me', local: 'Please help me' },
    ],
  },
  {
    code: 'DE', flag: '🇩🇪', name: 'Germany',
    numbers: { Emergency: '112', Police: '110' },
    lang: 'German',
    phrases: [
      { en: 'I need help', local: 'Ich brauche Hilfe' },
      { en: 'Call the police', local: 'Rufen Sie die Polizei' },
      { en: 'I need a doctor', local: 'Ich brauche einen Arzt' },
      { en: 'I am lost', local: 'Ich habe mich verlaufen' },
      { en: 'Where is the hospital?', local: 'Wo ist das Krankenhaus?' },
      { en: 'Please help me', local: 'Bitte helfen Sie mir' },
    ],
  },
  {
    code: 'IT', flag: '🇮🇹', name: 'Italy',
    numbers: { Emergency: '112' },
    lang: 'Italian',
    phrases: [
      { en: 'I need help', local: 'Ho bisogno di aiuto' },
      { en: 'Call the police', local: 'Chiami la polizia' },
      { en: 'I need a doctor', local: 'Ho bisogno di un medico' },
      { en: 'I am lost', local: 'Mi sono perso(a)' },
      { en: 'Where is the hospital?', local: "Dov'è l'ospedale?" },
      { en: 'Please help me', local: 'Per favore aiutami' },
    ],
  },
  {
    code: 'ES', flag: '🇪🇸', name: 'Spain',
    numbers: { Emergency: '112' },
    lang: 'Spanish',
    phrases: [
      { en: 'I need help', local: 'Necesito ayuda' },
      { en: 'Call the police', local: 'Llame a la policía' },
      { en: 'I need a doctor', local: 'Necesito un médico' },
      { en: 'I am lost', local: 'Estoy perdido(a)' },
      { en: 'Where is the hospital?', local: '¿Dónde está el hospital?' },
      { en: 'Please help me', local: 'Por favor, ayúdeme' },
    ],
  },
];

function TouristModeScreen({ navigate }) {
  const [selected, setSelected] = useState(null);
const [embassyCountry, setEmbassyCountry] = useState('');
  const openEmbassy = () => {
    const country = embassyCountry.trim();
    const query = country
      ? `${country} embassy in ${selected.name}`
      : `embassy in ${selected.name}`;
    const url = 'https://www.google.com/maps/search/' + encodeURIComponent(query);
    Linking.openURL(url);
  };

  if (selected) {
    return (
      <View style={styles.screen}>
        <View style={styles.screenHeader}>
          <TouchableOpacity onPress={() => setSelected(null)}>
            <Text style={styles.backBtn}>← Countries</Text>
          </TouchableOpacity>
          <Text style={styles.screenTitle}>{selected.name}</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 120 }}>
          <GlassCard style={{ gap: 6, borderColor: C.teal + '45' }}>
            <Text style={{ fontSize: 34 }}>{selected.flag}</Text>
            <Text style={{ color: C.white, fontSize: 22, fontWeight: '900' }}>{selected.name}</Text>
            <Text style={{ color: C.white60, fontSize: 13 }}>Local language: {selected.lang}</Text>
          </GlassCard>

          <Text style={styles.sectionLabel}>EMERGENCY NUMBERS</Text>
          {Object.keys(selected.numbers).map((key) => (
            <TouchableOpacity
              key={key}
              style={[styles.primaryBtn, { backgroundColor: C.pink }]}
              onPress={() => Linking.openURL(`tel:${selected.numbers[key]}`)}
            >
              <Text style={styles.primaryBtnText}>📞 {key}: {selected.numbers[key]}</Text>
            </TouchableOpacity>
          ))}

          <Text style={[styles.sectionLabel, { marginTop: 8 }]}>USEFUL PHRASES</Text>
          <Text style={{ color: C.white40, fontSize: 12, paddingHorizontal: 4, marginBottom: 4 }}>
            Show this screen to a local for help.
          </Text>
          {selected.phrases.map((p, i) => (
            <GlassCard key={i} style={{ gap: 4 }}>
              <Text style={{ color: C.white60, fontSize: 13 }}>{p.en}</Text>
              <Text style={{ color: C.white, fontSize: 17, fontWeight: '700' }}>{p.local}</Text>
            </GlassCard>
          ))}

          <Text style={[styles.sectionLabel, { marginTop: 8 }]}>EMBASSY</Text>
          <TextInput
            style={styles.glassInput}
            placeholder="Your home country e.g. India"
            placeholderTextColor={C.white40}
            value={embassyCountry}
            onChangeText={setEmbassyCountry}
          />
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: C.teal }]}
            onPress={openEmbassy}
          >
            <Text style={[styles.primaryBtnText, { color: '#001018' }]}>🏛️ Find My Embassy</Text>
          </TouchableOpacity>
          <Text style={{ color: C.white40, fontSize: 12, textAlign: 'center' }}>
            Searches for your country's embassy in {selected.name}.
          </Text>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.screenHeader}>
        <TouchableOpacity onPress={() => navigate('home')}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Tourist Mode</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 120 }}>
        <GlassCard style={{ gap: 8, borderColor: C.teal + '45' }}>
          <Text style={{ fontSize: 34 }}>🧳</Text>
          <Text style={{ color: C.white, fontSize: 22, fontWeight: '900' }}>Tourist Safety</Text>
          <Text style={{ color: C.white60, fontSize: 13, lineHeight: 20 }}>
            Pick the country you're visiting for local emergency numbers, key phrases, and embassy help. Works offline.
          </Text>
        </GlassCard>

        <Text style={styles.sectionLabel}>SELECT COUNTRY</Text>
        {TOURIST_DATA.map((c) => (
          <TouchableOpacity key={c.code} onPress={() => setSelected(c)}>
            <GlassCard style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Text style={{ fontSize: 28 }}>{c.flag}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.white, fontWeight: '700', fontSize: 15 }}>{c.name}</Text>
                <Text style={{ color: C.white40, fontSize: 12 }}>{c.lang}</Text>
              </View>
              <Text style={{ color: C.teal, fontSize: 18 }}>→</Text>
            </GlassCard>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function EmergencyCardScreen({ navigate, profile, contacts }) {
  const [responderMode, setResponderMode] = useState(false);

  const row = (label, value) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.cardBorder }}>
      <Text style={{ color: C.white60, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: C.white, fontSize: 14, fontWeight: '700', flex: 1, textAlign: 'right' }}>{value || '—'}</Text>
    </View>
  );

  const bigRow = (label, value) => (
    <View style={{ marginBottom: 22 }}>
      <Text style={{ color: '#444', fontSize: 16, fontWeight: '700', letterSpacing: 1 }}>{label}</Text>
      <Text style={{ color: '#111', fontSize: 30, fontWeight: '900' }}>{value || '—'}</Text>
    </View>
  );

  if (responderMode) {
    return (
      <View style={[styles.screen, { backgroundColor: '#FFFFFF' }]}>
        <ScrollView contentContainerStyle={{ padding: 26, paddingTop: 70 }}>
          <Text style={{ color: '#C8374A', fontSize: 22, fontWeight: '900', letterSpacing: 1, marginBottom: 4 }}>
            ⚕️ EMERGENCY MEDICAL INFO
          </Text>
          <Text style={{ color: '#666', fontSize: 13, marginBottom: 28 }}>
            For first responders / medical staff
          </Text>

          {bigRow('NAME', profile?.name)}
          {bigRow('BLOOD GROUP', profile?.bloodGroup)}
          {bigRow('ALLERGIES', profile?.allergies)}
          {bigRow('CONDITIONS', profile?.medicalCondition)}
          {bigRow('MEDICATIONS', profile?.medications)}
          {bigRow('AGE', profile?.age)}
          {bigRow('DOCTOR / MEDICAL CONTACT', profile?.doctorContact)}

          {contacts && contacts.length ? (
            <View style={{ marginBottom: 22 }}>
              <Text style={{ color: '#444', fontSize: 16, fontWeight: '700', letterSpacing: 1 }}>EMERGENCY CONTACTS</Text>
              {contacts.map((c) => (
                <Text key={c.id} style={{ color: '#111', fontSize: 22, fontWeight: '800', marginTop: 4 }}>
                  {c.name}: {c.phone}
                </Text>
              ))}
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: '#111', marginTop: 10 }]}
            onPress={() => setResponderMode(false)}
          >
            <Text style={styles.primaryBtnText}>Exit Responder View</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.screenHeader}>
        <TouchableOpacity onPress={() => navigate('home')}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Emergency Card</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 120 }}>
        <GlassCard style={{ gap: 10, borderColor: C.pink + '45' }}>
          <Text style={{ fontSize: 34 }}>⚕️</Text>
          <Text style={{ color: C.white, fontSize: 22, fontWeight: '900' }}>Emergency Info Card</Text>
          <Text style={{ color: C.white60, fontSize: 13, lineHeight: 20 }}>
            Critical medical info for first responders. Tap "Show to Responders" for a large, easy-to-read view.
          </Text>
        </GlassCard>

        <GlassCard style={{ gap: 2 }}>
          {row('Name', profile?.name)}
          {row('Age', profile?.age)}
          {row('Blood Group', profile?.bloodGroup)}
          {row('Allergies', profile?.allergies)}
          {row('Conditions', profile?.medicalCondition)}
          {row('Medications', profile?.medications)}
          {row('Doctor / Contact', profile?.doctorContact)}
        </GlassCard>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: C.pink }]}
          onPress={() => setResponderMode(true)}
        >
          <Text style={styles.primaryBtnText}>🔆 Show to Responders</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.white15 }]}
          onPress={() => navigate('profile')}
        >
          <Text style={[styles.primaryBtnText, { color: C.white70 }]}>✏️ Edit My Info</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
function SirenScreen({ navigate }) {
  const [active, setActive] = useState(false);
  const sirenRef = useRef(null);
  const flash = useRef(new Animated.Value(0)).current;

  const startSiren = async () => {
    setActive(true);
    try {
      Vibration.vibrate([0, 600, 300, 600, 300], true);
    } catch (e) {}

    Animated.loop(
      Animated.sequence([
        Animated.timing(flash, { toValue: 1, duration: 350, useNativeDriver: false }),
        Animated.timing(flash, { toValue: 0, duration: 350, useNativeDriver: false }),
      ])
    ).start();

    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: SIREN_URL },
        { shouldPlay: true, isLooping: true, volume: 1.0 }
      );
      sirenRef.current = sound;
    } catch (e) {
      console.log('Siren sound error:', e);
    }
  };

  const stopSiren = async () => {
    setActive(false);
    try { Vibration.cancel(); } catch (e) {}
    flash.stopAnimation();
    flash.setValue(0);
    if (sirenRef.current) {
      try {
        await sirenRef.current.stopAsync();
        await sirenRef.current.unloadAsync();
      } catch (e) {}
      sirenRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (sirenRef.current) {
        sirenRef.current.stopAsync().catch(() => {});
        sirenRef.current.unloadAsync().catch(() => {});
      }
      try { Vibration.cancel(); } catch (e) {}
    };
  }, []);

  const bg = flash.interpolate({
    inputRange: [0, 1],
    outputRange: [C.bg, C.pink],
  });

  return (
    <Animated.View style={[styles.screen, { backgroundColor: active ? bg : C.bg }]}>
      <View style={styles.screenHeader}>
        <TouchableOpacity onPress={() => { stopSiren(); navigate('home'); }}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Siren Alarm</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 24 }}>
        <Text style={{ fontSize: 64 }}>{active ? '🔊' : '🚨'}</Text>

        <Text style={{ color: C.white, fontSize: 22, fontWeight: '800', textAlign: 'center' }}>
          {active ? 'Siren is blaring' : 'Loud Siren Alarm'}
        </Text>

        <Text style={{ color: C.white60, fontSize: 14, textAlign: 'center', lineHeight: 21 }}>
          {active
            ? 'A loud siren and flashing screen are running to attract attention. Tap stop when you are safe.'
            : 'Plays a loud siren and flashes the screen to attract attention or scare off a threat. Turn your volume up first.'}
        </Text>

        {!active ? (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: C.pink, width: '100%' }]}
            onPress={startSiren}
          >
            <Text style={styles.primaryBtnText}>🚨 Start Siren</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: C.white, width: '100%' }]}
            onPress={stopSiren}
          >
            <Text style={[styles.primaryBtnText, { color: '#111' }]}>⏹️ Stop Siren</Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}
function SafetyGuideScreen({ navigate }) {
  const emergencySteps = [
    {
      icon: '📞',
      title: 'Call emergency services',
      text: 'Call 112 immediately if you are in danger. This works even without internet.',
    },
    {
      icon: '👥',
      title: 'Move to a public place',
      text: 'Try to move toward people, shops, security guards, police, or a well-lit area.',
    },
    {
      icon: '🎙️',
      title: 'Keep evidence recording on',
      text: 'If safe, keep audio recording active. Do not risk your safety just to record.',
    },
    {
      icon: '💬',
      title: 'Send SMS to trusted contacts',
      text: 'If internet is unavailable, use SMS. SAATHI can prepare an emergency message for you.',
    },
    {
      icon: '📍',
      title: 'Use last known location',
      text: 'If live GPS fails, SAATHI can use your last saved location as a backup.',
    },
    {
      icon: '🧾',
      title: 'Preserve evidence',
      text: 'Do not delete audio, messages, call logs, or location records after the incident.',
    },
    {
      icon: '🚫',
      title: 'Do not confront alone',
      text: 'Avoid arguing or fighting unless you have no other option. Your first goal is escape.',
    },
    {
      icon: '📞',
      title: 'Use fake call if needed',
      text: 'In uncomfortable situations, a fake call can help you leave without escalating things.',
    },
  ];

  return (
    <View style={styles.screen}>
      <GlowCircle color={C.yellow} size={280} style={{ top: -80, right: -90 }} />
      <GlowCircle color={C.purple} size={220} style={{ bottom: 120, left: -90 }} />

      <View style={styles.screenHeader}>
        <TouchableOpacity onPress={() => navigate('home')}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.screenTitle}>Safety Guide</Text>

        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 120 }}>
        <GlassCard style={{ gap: 10, borderColor: C.yellow + '45' }}>
          <Text style={{ fontSize: 36 }}>🧭</Text>

          <Text style={{ color: C.white, fontSize: 22, fontWeight: '900' }}>
            Offline Safety Guide
          </Text>

          <Text style={{ color: C.white60, fontSize: 13, lineHeight: 20 }}>
            These steps work as a quick emergency reference even when internet is unavailable.
          </Text>
        </GlassCard>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: '#00C87A' }]}
          onPress={() => Linking.openURL('tel:112')}
        >
          <Text style={styles.primaryBtnText}>📞 Call Emergency 112</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: C.pink }]}
          onPress={() => Linking.openURL('tel:1091')}
        >
          <Text style={styles.primaryBtnText}>📞 Women Helpline 1091</Text>
        </TouchableOpacity>

        <Text style={[styles.sectionLabel, { marginTop: 8 }]}>WHAT TO DO</Text>

        {emergencySteps.map((step, index) => (
          <GlassCard key={index} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ fontSize: 26 }}>{step.icon}</Text>

              <View style={{ flex: 1 }}>
                <Text style={{ color: C.white, fontSize: 15, fontWeight: '800' }}>
                  {index + 1}. {step.title}
                </Text>

                <Text style={{ color: C.white50 || C.white40, fontSize: 12, marginTop: 4, lineHeight: 18 }}>
                  {step.text}
                </Text>
              </View>
            </View>
          </GlassCard>
        ))}

        <GlassCard style={{ gap: 8, borderColor: C.pink + '40' }}>
          <Text style={{ color: C.pink, fontSize: 15, fontWeight: '900' }}>
            Important
          </Text>

          <Text style={{ color: C.white60, fontSize: 13, lineHeight: 20 }}>
            SAATHI is a safety support app. In real danger, always contact local emergency services,
            police, or nearby trusted people as quickly as possible.
          </Text>
        </GlassCard>
      </ScrollView>
    </View>
  );
}
function NearbyScreen({ navigate }) {
  const [places, setPlaces] = useState([]);
const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('police');
  const fetchNearbyPlaces = async (selectedType) => {
    console.log('fetchNearbyPlaces called:', selectedType);
  try {
    setLoading(true);

    const location =
      await Location.getCurrentPositionAsync({});

    const lat = location.coords.latitude;
    const lng = location.coords.longitude;
console.log(
  `${BASE_URL}/api/nearby?lat=${lat}&lng=${lng}&type=${selectedType}`
);
   const token = await SecureStore.getItemAsync('token');

console.log('BEFORE FETCH');

const response = await fetch(
  
  `${BASE_URL}/api/nearby?lat=${lat}&lng=${lng}&type=${selectedType}`,
  {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }
);

const data = await response.json();
console.log('API RESPONSE FULL:');
console.log(JSON.stringify(data, null, 2));

console.log('Fetching:', selectedType);
console.log('Response:', data);

console.log('PLACES COUNT:', data.places?.length);

setPlaces(data.places || []);
  } catch (err) {
    console.log('Nearby error:', err);
  } finally {
    setLoading(false);
  }
};
  useEffect(() => {
  fetchNearbyPlaces(tab);
}, [tab]);
  const openNearbyInMaps = async (type) => {
  try {
    const location = await getCurrentLocation();

    let url = '';

    if (location?.latitude && location?.longitude) {
      const searchType =
  type === 'women_help'
    ? 'women help center'
    : type === 'safe_spots'
    ? 'shopping mall supermarket'
    : type;

url = `https://www.google.com/maps/search/${encodeURIComponent(
  searchType
)}/@${location.latitude},${location.longitude},15z`;
    } else {
      url = `https://www.google.com/maps/search/${encodeURIComponent(
        type + ' near me'
      )}`;
    }

    Linking.openURL(url);
  } catch (error) {
    console.log('Nearby map error:', error);

    Linking.openURL(
      `https://www.google.com/maps/search/${encodeURIComponent(
        type + ' near me'
      )}`
    );
  }
};
  return (
    <View style={styles.screen}>
      <GlowCircle color={C.pink} size={250} style={{ top: -50, right: -50 }} />

      <View style={styles.screenHeader}>
        <TouchableOpacity onPress={() => navigate('home')}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.screenTitle}>Nearby Help</Text>

        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}>
        
  <GlassCard
  style={{
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    width: '100%',
    padding: 6,
    marginBottom: 16,
  }}>
  {[
  { key: 'police', label: '👮 Police' },
  { key: 'hospital', label: '🏥 Hospital' },
  { key: 'pharmacy', label: '💊 Pharmacy' },
  { key: 'women_help', label: '👩 Women Help' },
  { key: 'safe_spots', label: '🛟 Safe Spots' },
].map((item) => (
    <TouchableOpacity
      key={item.key}
      style={[
  styles.tabBtn,
  {
    width: '48%',
    marginBottom: 10,
  },
  tab === item.key && {
  backgroundColor: C.purple,
},
]}
      onPress={() => {
  setTab(item.key);
  openNearbyInMaps(item.key);
}}
    >
      <Text
  style={{
    color: tab === item.key ? '#fff' : C.white60,
    fontWeight: '600',
    textAlign: 'center',
  }}
>
  {item.label}
</Text>
    </TouchableOpacity>
  ))}
</GlassCard>

        <View style={styles.emergencyRow}>
          <TouchableOpacity
            style={[styles.emergencyBtn, { backgroundColor: C.pink + '20', borderColor: C.pink + '40' }]}
            onPress={() => Linking.openURL('tel:112')}
          >
            <Text style={{ color: C.pink, fontWeight: '700' }}>🚨 Call 112</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.emergencyBtn, { backgroundColor: C.purple + '20', borderColor: C.purple + '40' }]}
            onPress={() => Linking.openURL('tel:1091')}
          >
            <Text style={{ color: C.purple, fontWeight: '700' }}>📞 Women 1091</Text>
          </TouchableOpacity>
        </View>
                <GlassCard style={{ padding: 20 }}>
  <Text style={{ color: 'white' }}>
    Nearby Help Test
  </Text>
</GlassCard>

        {places.map((p) => (
          <GlassCard
           key={p.id}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 }}
          >
            <View
              style={[
                styles.placeIcon,
                {
                  backgroundColor: tab === 'police' ? C.purple + '20' : C.pink + '20',
                },
              ]}
            >
              <Text style={{ fontSize: 22 }}>{
  tab === 'police'
    ? '👮'
    : tab === 'hospital'
    ? '🏥'
    : tab === 'pharmacy'
    ? '💊'
    : '👩'
}</Text>
            </View>

            <View style={{ flex: 1 }}>
              <Text style={{ color: C.white, fontWeight: '600', fontSize: 14 }}>{p.name}</Text>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                <Text style={{ color: C.white40, fontSize: 12 }}>📍 {`${(p.distance / 1000).toFixed(1)} km`}</Text>
                <Text style={{ color: p.openNow ? C.teal : C.pink, fontSize: 12 }}>
                  {p.openNow ? '● Open' : '● Closed'}
                </Text>
              </View>
            </View>

            <TouchableOpacity
  style={styles.navBtn}
  onPress={() => Linking.openURL(p.mapsUrl)}
>
              <Text style={{ color: C.purple, fontSize: 12, fontWeight: '600' }}>Go →</Text>
            </TouchableOpacity>
          </GlassCard>
        ))}
      </ScrollView>
    </View>
  );
}
function EvidenceDetailScreen({ navigate, record, deleteEvidenceRecord }) {
  const [deletePin, setDeletePin] = useState('');
const [showDeletePin, setShowDeletePin] = useState(false);
  if (!record) {
    return (
      <View style={styles.screen}>
        <View style={styles.screenHeader}>
          <TouchableOpacity onPress={() => navigate('evidence')}>
            <Text style={styles.backBtn}>← Back</Text>
          </TouchableOpacity>

          <Text style={styles.screenTitle}>Evidence Details</Text>

          <View style={{ width: 60 }} />
        </View>

        <View style={{ padding: 20 }}>
          <GlassCard style={{ alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 34 }}>📁</Text>
            <Text style={{ color: C.white, fontWeight: '800' }}>No evidence selected</Text>
          </GlassCard>
        </View>
      </View>
    );
  }

  const dateObj = new Date(record.createdAt);
  const date = dateObj.toLocaleDateString();
  const time = dateObj.toLocaleTimeString();

  const shareAudio = async () => {
    try {
      if (!record.audioUri) {
        Alert.alert('No Audio', 'This record does not have audio evidence.');
        return;
      }

      const canShare = await Sharing.isAvailableAsync();

      if (!canShare) {
        Alert.alert('Sharing Not Available', 'Sharing is not available on this device.');
        return;
      }

      await Sharing.shareAsync(record.audioUri, {
        dialogTitle: 'Share SAATHI Audio Evidence',
        mimeType: 'audio/m4a',
        UTI: 'public.audio',
      });
    } catch (error) {
      console.log('Share detail audio error:', error);
      Alert.alert('Share Error', 'Could not share this audio evidence.');
    }
  };

  const shareLocation = async () => {
    if (!record.mapsUrl) {
      Alert.alert('No Location', 'This evidence does not have location data.');
      return;
    }

    await Share.share({
      message: record.message || `SAATHI location evidence: ${record.mapsUrl}`,
    });
  };

  const openMaps = () => {
    if (!record.mapsUrl) {
      Alert.alert('No Location', 'This evidence does not have location data.');
      return;
    }

    Linking.openURL(record.mapsUrl);
  };

  const shareFullReport = async () => {
    try {
      const contactsText =
        record.trustedContacts && record.trustedContacts.length
          ? record.trustedContacts
              .map((c, index) => `${index + 1}. ${c.name} (${c.relation}) - ${c.phone}`)
              .join('\n')
          : 'No trusted contacts saved in this record.';

      const locationText = record.mapsUrl
        ? `${record.mapsUrl}

Coordinates:
Latitude: ${record.latitude}
Longitude: ${record.longitude}`
        : 'Location was not available for this SOS record.';

      const audioText = record.audioUri
        ? `Audio evidence was saved in the app.

Audio File:
${record.audioUri}

Use the Audio button in Evidence Details to share the recording file.`
        : 'No audio evidence saved.';

      const report = `🛡️ SAATHI EMERGENCY REPORT

Date: ${date}
Time: ${time}

Location:
${locationText}

Audio Evidence:
${audioText}

Trusted Contacts:
${contactsText}

Emergency Message:
${record.message || 'No emergency message saved.'}

Generated by SAATHI Safety App`;

      await Share.share({
        message: report,
      });
    } catch (error) {
      console.log('Share detail report error:', error);
      Alert.alert('Report Error', 'Could not share the emergency report.');
    }
  };

  const confirmDelete = () => {
  setDeletePin('');
  setShowDeletePin(true);
};

const confirmDeleteWithPin = () => {
  if (!isValidPin(deletePin)) {
    Alert.alert('Invalid PIN', 'PIN must be 4 to 6 digits.');
    return;
  }

  if (deletePin !== EVIDENCE_DELETE_PIN) {
    Alert.alert('Wrong PIN', 'Please enter the correct delete PIN.');
    return;
  }

  deleteEvidenceRecord(record.id);
  setShowDeletePin(false);
  setDeletePin('');
  navigate('evidence');
};
  return (
    <View style={styles.screen}>
      <GlowCircle color={C.pink} size={280} style={{ top: -80, right: -90 }} />

      <View style={styles.screenHeader}>
        <TouchableOpacity onPress={() => navigate('evidence')}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.screenTitle}>Evidence Details</Text>

        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 120 }}>
        <GlassCard style={{ gap: 12, borderColor: C.pink + '40' }}>
          <Text style={{ fontSize: 34 }}>🎙️</Text>

          <Text style={{ color: C.white, fontSize: 22, fontWeight: '900' }}>
            SOS Evidence
          </Text>

          <Text style={{ color: C.white40, fontSize: 13 }}>
            Saved emergency audio and location record
          </Text>
        </GlassCard>

        <GlassCard style={{ gap: 10 }}>
          <Text style={styles.inputLabel}>DATE & TIME</Text>

          <Text style={{ color: C.white, fontSize: 15, fontWeight: '700' }}>
            Date: {date}
          </Text>

          <Text style={{ color: C.white, fontSize: 15, fontWeight: '700' }}>
            Time: {time}
          </Text>
        </GlassCard>

        <GlassCard style={{ gap: 10 }}>
          <Text style={styles.inputLabel}>LOCATION</Text>

          {record.mapsUrl ? (
            <>
              <Text style={{ color: C.white70, fontSize: 13 }}>
                Latitude: {record.latitude}
              </Text>

              <Text style={{ color: C.white70, fontSize: 13 }}>
                Longitude: {record.longitude}
              </Text>

              <Text style={{ color: C.white40, fontSize: 12 }} numberOfLines={2}>
                {record.mapsUrl}
              </Text>
            </>
          ) : (
            <Text style={{ color: C.yellow, fontSize: 13 }}>
              Location was not available for this record.
            </Text>
          )}
        </GlassCard>

        <GlassCard style={{ gap: 10 }}>
          <Text style={styles.inputLabel}>TRUSTED CONTACTS</Text>

          {record.trustedContacts && record.trustedContacts.length ? (
            record.trustedContacts.map((c, index) => (
              <View key={`${c.phone}-${index}`} style={{ gap: 2 }}>
                <Text style={{ color: C.white, fontWeight: '700', fontSize: 14 }}>
                  {index + 1}. {c.name}
                </Text>
                <Text style={{ color: C.white40, fontSize: 12 }}>
                  {c.relation} • {c.phone}
                </Text>
              </View>
            ))
          ) : (
            <Text style={{ color: C.white40, fontSize: 13 }}>
              No trusted contacts saved in this record.
            </Text>
          )}
        </GlassCard>

        <GlassCard style={{ gap: 10 }}>
          <Text style={styles.inputLabel}>EMERGENCY MESSAGE</Text>

          <Text style={{ color: C.white60, fontSize: 13, lineHeight: 20 }}>
            {record.message || 'No emergency message saved.'}
          </Text>
        </GlassCard>

        <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: C.purple }]} onPress={shareAudio}>
          <Text style={styles.primaryBtnText}>📤 Share Audio Evidence</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: record.mapsUrl ? C.teal : C.white15, opacity: record.mapsUrl ? 1 : 0.5 }]}
          onPress={shareLocation}
          disabled={!record.mapsUrl}
        >
          <Text style={styles.primaryBtnText}>📍 Share Location</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: record.mapsUrl ? '#00C87A' : C.white15, opacity: record.mapsUrl ? 1 : 0.5 }]}
          onPress={openMaps}
          disabled={!record.mapsUrl}
        >
          <Text style={styles.primaryBtnText}>🗺️ Open in Maps</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: C.yellow }]} onPress={shareFullReport}>
          <Text style={styles.primaryBtnText}>🛡️ Share Full Report</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.primaryBtn,
            {
              backgroundColor: 'transparent',
              borderWidth: 1,
              borderColor: C.pink + '60',
            },
          ]}
          onPress={confirmDelete}
        >
          <Text style={[styles.primaryBtnText, { color: C.pink }]}>Delete Evidence</Text>
        </TouchableOpacity>
            </ScrollView>

      <PinModal
        visible={showDeletePin}
        pin={deletePin}
        setPin={setDeletePin}
        onCancel={() => {
          setShowDeletePin(false);
          setDeletePin('');
        }}
        onConfirm={confirmDeleteWithPin}
      />
    </View>
  );
}
function EvidenceHistoryScreen({ navigate, evidenceHistory, deleteEvidenceRecord }) {
  const [deletePin, setDeletePin] = useState('');
const [pendingDeleteRecord, setPendingDeleteRecord] = useState(null);
  const shareAudio = async (record) => {
    try {
      if (!record.audioUri) {
        Alert.alert('No Audio', 'This record does not have audio evidence.');
        return;
      }

      const canShare = await Sharing.isAvailableAsync();

      if (!canShare) {
        Alert.alert('Sharing Not Available', 'Sharing is not available on this device.');
        return;
      }

      await Sharing.shareAsync(record.audioUri, {
        dialogTitle: 'Share SAATHI Audio Evidence',
        mimeType: 'audio/m4a',
        UTI: 'public.audio',
      });
    } catch (error) {
      console.log('Share evidence error:', error);
      Alert.alert('Share Error', 'Could not share this audio evidence.');
    }
  };

  const shareLocation = async (record) => {
    if (!record.mapsUrl) {
      Alert.alert('No Location', 'This record does not have location data.');
      return;
    }

    await Share.share({
      message: record.message || `SAATHI location evidence: ${record.mapsUrl}`,
    });
  };
const shareFullReport = async (record) => {
  try {
    const dateObj = new Date(record.createdAt);

    const date = dateObj.toLocaleDateString();
    const time = dateObj.toLocaleTimeString();

    const contactsText =
      record.trustedContacts && record.trustedContacts.length
        ? record.trustedContacts
            .map(
              (c, index) =>
                `${index + 1}. ${c.name} (${c.relation}) - ${c.phone}`
            )
            .join('\n')
        : 'No trusted contacts saved in this record.';

    const locationText = record.mapsUrl
      ? `${record.mapsUrl}

Coordinates:
Latitude: ${record.latitude}
Longitude: ${record.longitude}`
      : 'Location was not available for this SOS record.';

    const audioText = record.audioUri
      ? `Audio evidence was saved in the app.

Audio File:
${record.audioUri}

Use the "Audio" button in Evidence History to share the recording file.`
      : 'No audio evidence saved.';

    const report = `🛡️ SAATHI EMERGENCY REPORT

Date: ${date}
Time: ${time}

Location:
${locationText}

Audio Evidence:
${audioText}

Trusted Contacts:
${contactsText}

Emergency Message:
${record.message || 'No emergency message saved.'}

Generated by SAATHI Safety App`;

    await Share.share({
      message: report,
    });
  } catch (error) {
    console.log('Share full report error:', error);
    Alert.alert('Report Error', 'Could not share the emergency report.');
  }
};
  const confirmDelete = (record) => {
  setDeletePin('');
  setPendingDeleteRecord(record);
};

const confirmDeleteWithPin = () => {
  if (!pendingDeleteRecord) return;

  if (!isValidPin(deletePin)) {
    Alert.alert('Invalid PIN', 'PIN must be 4 to 6 digits.');
    return;
  }

  if (deletePin !== EVIDENCE_DELETE_PIN) {
    Alert.alert('Wrong PIN', 'Please enter the correct delete PIN.');
    return;
  }

  deleteEvidenceRecord(pendingDeleteRecord.id);
  setPendingDeleteRecord(null);
  setDeletePin('');
};

  return (
    <View style={styles.screen}>
      <GlowCircle color={C.pink} size={260} style={{ top: -60, right: -80 }} />

      <View style={styles.screenHeader}>
        <TouchableOpacity onPress={() => navigate('home')}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.screenTitle}>Evidence History</Text>

        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 120 }}>
        <View style={styles.planChip}>
          <Text style={{ color: C.pink, fontSize: 12, fontWeight: '600' }}>
            Saved SOS Records • {evidenceHistory.length}
          </Text>
        </View>

        {evidenceHistory.length === 0 ? (
          <GlassCard style={{ alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 36 }}>📁</Text>
            <Text style={{ color: C.white, fontWeight: '800', fontSize: 16 }}>
              No evidence saved yet
            </Text>
            <Text style={{ color: C.white40, fontSize: 12, textAlign: 'center' }}>
              Stop and save an SOS recording. It will appear here.
            </Text>
          </GlassCard>
        ) : (
          evidenceHistory.map((record, index) => {
            const date = new Date(record.createdAt);

            return (
              <GlassCard key={record.id} style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={styles.contactAvatar}>
                    <Text style={{ fontSize: 24 }}>🎙️</Text>
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.white, fontWeight: '800', fontSize: 15 }}>
                      SOS Evidence #{evidenceHistory.length - index}
                    </Text>

                    <Text style={{ color: C.white40, fontSize: 12 }}>
                      {date.toLocaleString()}
                    </Text>

                    <Text
                      style={{
                        color: record.locationAvailable ? '#00C87A' : C.yellow,
                        fontSize: 11,
                        marginTop: 3,
                      }}
                    >
                      {record.locationAvailable ? '📍 Location saved' : '📍 No location saved'}
                    </Text>
                  </View>

                  <TouchableOpacity onPress={() => confirmDelete(record)}>
                    <Text style={{ color: C.pink, fontWeight: '900', fontSize: 22 }}>×</Text>
                  </TouchableOpacity>
                </View>

                {record.mapsUrl ? (
                  <Text style={{ color: C.white40, fontSize: 12 }} numberOfLines={1}>
                    {record.mapsUrl}
                  </Text>
                ) : null}

                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      {
                        flex: 1,
                        backgroundColor: 'rgba(155, 109, 255, 0.18)',
                        borderWidth: 1,
                        borderColor: 'rgba(155, 109, 255, 0.35)',
                        paddingVertical: 12,
                      },
                    ]}
                    onPress={() => shareAudio(record)}
                  >
                    <Text style={[styles.primaryBtnText, { fontSize: 12 }]}>📤 Audio</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      {
                        flex: 1,
                        backgroundColor: record.mapsUrl
                          ? 'rgba(0, 200, 122, 0.18)'
                          : 'rgba(255,255,255,0.08)',
                        borderWidth: 1,
                        borderColor: record.mapsUrl
                          ? 'rgba(0, 200, 122, 0.35)'
                          : 'rgba(255,255,255,0.12)',
                        paddingVertical: 12,
                        opacity: record.mapsUrl ? 1 : 0.5,
                      },
                    ]}
                    onPress={() => shareLocation(record)}
                    disabled={!record.mapsUrl}
                  >
                    <Text style={[styles.primaryBtnText, { fontSize: 12 }]}>📍 Location</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
  style={[
    styles.primaryBtn,
    {
      backgroundColor: 'rgba(255, 179, 71, 0.18)',
      borderWidth: 1,
      borderColor: 'rgba(255, 179, 71, 0.35)',
      paddingVertical: 12,
    },
  ]}
  onPress={() => shareFullReport(record)}
>
  <Text style={[styles.primaryBtnText, { fontSize: 12 }]}>
    🛡️ Share Emergency Report
  </Text>
</TouchableOpacity>
<TouchableOpacity
  style={[
    styles.primaryBtn,
    {
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.14)',
      paddingVertical: 12,
    },
  ]}
  onPress={() => navigate('evidenceDetail', record)}
>
  <Text style={[styles.primaryBtnText, { fontSize: 12 }]}>
    View Full Details →
  </Text>
</TouchableOpacity>
              </GlassCard>
            );
          })
        )}
            </ScrollView>

      <PinModal
        visible={!!pendingDeleteRecord}
        pin={deletePin}
        setPin={setDeletePin}
        onCancel={() => {
          setPendingDeleteRecord(null);
          setDeletePin('');
        }}
        onConfirm={confirmDeleteWithPin}
      />
    </View>
  );
}
function PrivacyPolicyScreen({ navigate }) {
  return (
    <View style={styles.screen}>
      <GlowCircle color={C.teal} size={280} style={{ top: -80, right: -90 }} />

      <View style={styles.screenHeader}>
        <TouchableOpacity onPress={() => navigate('profile')}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.screenTitle}>Privacy Policy</Text>

        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 120 }}>
        <GlassCard style={{ gap: 10, borderColor: C.teal + '45' }}>
          <Text style={{ fontSize: 36 }}>🔐</Text>

          <Text style={{ color: C.white, fontSize: 22, fontWeight: '900' }}>
            SAATHI Privacy Policy
          </Text>

          <Text style={{ color: C.white60, fontSize: 13, lineHeight: 20 }}>
            SAATHI is designed as a safety support app. This policy explains what data the app uses and why.
          </Text>
        </GlassCard>

        {[
          {
            title: '1. Data we use',
            text:
              'SAATHI may use your trusted contacts, phone number, location, audio evidence, SOS history, medical profile, and app usage data needed for safety features.',
          },
          {
            title: '2. Why we use this data',
            text:
              'We use this data to help you trigger SOS alerts, share emergency location, call emergency services, send SMS to trusted contacts, record audio evidence, show nearby help, and save safety records.',
          },
          {
            title: '3. Local storage',
            text:
              'Sensitive data such as contacts, medical profile, last known location, and evidence history is stored locally on your device. We use secure local storage where possible.',
          },
          {
            title: '4. Location',
            text:
              'Location is used only for safety features such as SOS, Safe Trip, nearby help, and last known location backup. Location is not used for advertising.',
          },
          {
            title: '5. Audio evidence',
            text:
              'Audio recording starts only during SOS or when you choose to record. Audio evidence is saved so you can share it if needed.',
          },
          {
            title: '6. Sharing',
            text:
              'SAATHI may help you share emergency messages, location links, reports, or audio evidence through your phone apps. You control when this information is shared.',
          },
          {
            title: '7. Emergency contacts',
            text:
              'Trusted contacts are used only for emergency alerts and safety communication features.',
          },
          {
            title: '8. Data deletion',
            text:
              'You can delete evidence records from the app. Some deleted data may still exist in external apps if you already shared it outside SAATHI.',
          },
          {
            title: '9. Security',
            text:
              'We use local secure storage, PIN protection for evidence deletion, backend rate limits, and safer backend headers. No system can be guaranteed 100% secure.',
          },
          {
            title: '10. Contact',
            text:
              'For privacy questions, contact: amanupadhyay.3012@gmail.com',
          },
        ].map((item) => (
          <GlassCard key={item.title} style={{ gap: 8 }}>
            <Text style={{ color: C.white, fontSize: 15, fontWeight: '900' }}>
              {item.title}
            </Text>
            <Text style={{ color: C.white60, fontSize: 13, lineHeight: 20 }}>
              {item.text}
            </Text>
          </GlassCard>
        ))}

        <GlassCard style={{ gap: 8, borderColor: C.yellow + '40' }}>
          <Text style={{ color: C.yellow, fontSize: 15, fontWeight: '900' }}>
            Note
          </Text>

          <Text style={{ color: C.white60, fontSize: 13, lineHeight: 20 }}>
            This is a draft privacy policy for development/testing. Before public launch, review it with a legal professional.
          </Text>
        </GlassCard>
      </ScrollView>
    </View>
  );
}
function TermsScreen({ navigate }) {
  return (
    <View style={styles.screen}>
      <GlowCircle color={C.pink} size={280} style={{ top: -80, right: -90 }} />

      <View style={styles.screenHeader}>
        <TouchableOpacity onPress={() => navigate('profile')}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.screenTitle}>Terms</Text>

        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 120 }}>
        <GlassCard style={{ gap: 10, borderColor: C.pink + '45' }}>
          <Text style={{ fontSize: 36 }}>📜</Text>

          <Text style={{ color: C.white, fontSize: 22, fontWeight: '900' }}>
            SAATHI Terms & Safety Disclaimer
          </Text>

          <Text style={{ color: C.white60, fontSize: 13, lineHeight: 20 }}>
            These terms explain how SAATHI should be used during safety situations.
          </Text>
        </GlassCard>

        {[
          {
            title: '1. Safety support only',
            text:
              'SAATHI is a safety support app. It does not replace police, emergency services, legal help, medical help, or professional security services.',
          },
          {
            title: '2. Emergency services',
            text:
              'In real danger, call local emergency services immediately. In India, you can call 112.',
          },
          {
            title: '3. Accuracy limitations',
            text:
              'Location, network, SMS, calls, audio recording, maps, and nearby results may fail or be inaccurate due to device, network, permission, battery, GPS, or third-party service issues.',
          },
          {
            title: '4. User responsibility',
            text:
              'Use SAATHI responsibly. Do not misuse SOS, fake call, emergency numbers, audio recording, or evidence features.',
          },
          {
            title: '5. Consent and recording',
            text:
              'Audio recording laws and consent rules may vary by location. Use recording features responsibly and only for safety/evidence purposes.',
          },
          {
            title: '6. No guarantee',
            text:
              'SAATHI cannot guarantee prevention of harm, rescue, police response, message delivery, or emergency outcome.',
          },
          {
            title: '7. Data sharing',
            text:
              'When you share reports, audio, SMS, or location outside SAATHI, those external apps and recipients may handle the data under their own policies.',
          },
          {
            title: '8. Changes',
            text:
              'These terms may be updated as SAATHI develops and adds more production features.',
          },
        ].map((item) => (
          <GlassCard key={item.title} style={{ gap: 8 }}>
            <Text style={{ color: C.white, fontSize: 15, fontWeight: '900' }}>
              {item.title}
            </Text>
            <Text style={{ color: C.white60, fontSize: 13, lineHeight: 20 }}>
              {item.text}
            </Text>
          </GlassCard>
        ))}

        <GlassCard style={{ gap: 8, borderColor: C.yellow + '40' }}>
          <Text style={{ color: C.yellow, fontSize: 15, fontWeight: '900' }}>
            Development note
          </Text>

          <Text style={{ color: C.white60, fontSize: 13, lineHeight: 20 }}>
            This is a draft terms page for testing. Before Play Store launch, review it legally.
          </Text>
        </GlassCard>
      </ScrollView>
    </View>
  );
}
function ProfileScreen({ navigate, profile, saveProfile, onLogout }) {
  const [name, setName] = useState(profile?.name || '');
  const [age, setAge] = useState(profile?.age || '');
  const [bloodGroup, setBloodGroup] = useState(profile?.bloodGroup || '');
  const [medicalCondition, setMedicalCondition] = useState(profile?.medicalCondition || '');
  const [allergies, setAllergies] = useState(profile?.allergies || '');
  const [medications, setMedications] = useState(profile?.medications || '');
  const [doctorContact, setDoctorContact] = useState(profile?.doctorContact || '');
  const [homeAddress, setHomeAddress] = useState(profile?.homeAddress || '');
  const [emergencyNote, setEmergencyNote] = useState(profile?.emergencyNote || '');

  const handleSave = () => {
  const cleanName = cleanText(name);
  const cleanAge = cleanText(age);
  const cleanBloodGroup = cleanText(bloodGroup).toUpperCase();
  const cleanMedicalCondition = cleanText(medicalCondition);
  const cleanHomeAddress = cleanText(homeAddress);
  const cleanEmergencyNote = cleanText(emergencyNote);

  if (!cleanName) {
    Alert.alert('Name Required', 'Please enter your full name.');
    return;
  }

  if (cleanAge && !isValidAge(cleanAge)) {
    Alert.alert('Invalid Age', 'Please enter a valid age.');
    return;
  }

  if (cleanBloodGroup && !isValidBloodGroup(cleanBloodGroup)) {
    Alert.alert('Invalid Blood Group', 'Use format like O+, A+, B-, AB+.');
    return;
  }

  saveProfile({
    name: cleanName,
    age: cleanAge,
    bloodGroup: cleanBloodGroup,
    medicalCondition: cleanMedicalCondition || 'None',
    allergies: cleanText(allergies) || 'None',
    medications: cleanText(medications) || 'None',
    doctorContact: cleanText(doctorContact),
    homeAddress: cleanHomeAddress,
    emergencyNote: cleanEmergencyNote,
  });
};
  return (
    <View style={styles.screen}>
      <GlowCircle color={C.purple} size={280} style={{ top: -80, right: -90 }} />
      <GlowCircle color={C.teal} size={220} style={{ bottom: 120, left: -90 }} />

      <View style={styles.screenHeader}>
        <TouchableOpacity onPress={() => navigate('home')}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.screenTitle}>Medical Profile</Text>

        <View style={{ width: 60 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 120 }}>
        <GlassCard style={{ gap: 10, borderColor: C.purple + '45' }}>
          <Text style={{ fontSize: 36 }}>👤</Text>

          <Text style={{ color: C.white, fontSize: 22, fontWeight: '900' }}>
            Safety Identity
          </Text>

          <Text style={{ color: C.white60, fontSize: 13, lineHeight: 20 }}>
            Save important medical and emergency details that can help during a crisis.
          </Text>
        </GlassCard>

        <GlassCard style={{ gap: 12 }}>
          <Text style={styles.inputLabel}>FULL NAME</Text>
          <TextInput
            style={styles.glassInput}
            placeholder="Your name"
            placeholderTextColor={C.white40}
            value={name}
            onChangeText={setName}
          />

          <Text style={styles.inputLabel}>AGE</Text>
          <TextInput
            style={styles.glassInput}
            placeholder="21"
            placeholderTextColor={C.white40}
            keyboardType="number-pad"
            value={age}
            onChangeText={setAge}
          />

          <Text style={styles.inputLabel}>BLOOD GROUP</Text>
          <TextInput
            style={styles.glassInput}
            placeholder="e.g. O+, A+, B-"
            placeholderTextColor={C.white40}
            value={bloodGroup}
            onChangeText={setBloodGroup}
          />

          <Text style={styles.inputLabel}>MEDICAL CONDITION</Text>
          <TextInput
            style={styles.glassInput}
            placeholder="e.g. Asthma, Diabetes, None"
            placeholderTextColor={C.white40}
            value={medicalCondition}
            onChangeText={setMedicalCondition}
          />
<Text style={styles.inputLabel}>ALLERGIES</Text>
          <TextInput
            style={styles.glassInput}
            placeholder="e.g. Penicillin, Peanuts, None"
            placeholderTextColor={C.white40}
            value={allergies}
            onChangeText={setAllergies}
          />

          <Text style={styles.inputLabel}>CURRENT MEDICATIONS</Text>
          <TextInput
            style={styles.glassInput}
            placeholder="e.g. Insulin, None"
            placeholderTextColor={C.white40}
            value={medications}
            onChangeText={setMedications}
          />

          <Text style={styles.inputLabel}>DOCTOR / EMERGENCY MEDICAL CONTACT</Text>
          <TextInput
            style={styles.glassInput}
            placeholder="Name & phone"
            placeholderTextColor={C.white40}
            value={doctorContact}
            onChangeText={setDoctorContact}
          />
          <Text style={styles.inputLabel}>HOME ADDRESS</Text>
          <TextInput
            style={[styles.glassInput, { minHeight: 80, textAlignVertical: 'top' }]}
            placeholder="Your home address"
            placeholderTextColor={C.white40}
            value={homeAddress}
            onChangeText={setHomeAddress}
            multiline
          />

          <Text style={styles.inputLabel}>EMERGENCY NOTE</Text>
          <TextInput
            style={[styles.glassInput, { minHeight: 90, textAlignVertical: 'top' }]}
            placeholder="Anything important responders should know"
            placeholderTextColor={C.white40}
            value={emergencyNote}
            onChangeText={setEmergencyNote}
            multiline
          />
        </GlassCard>

        <TouchableOpacity
  style={[styles.primaryBtn, { backgroundColor: C.purple }]}
  onPress={handleSave}
>
  <Text style={styles.primaryBtnText}>💾 Save Medical Profile</Text>
</TouchableOpacity>
<TouchableOpacity
  style={[styles.primaryBtn, { backgroundColor: '#4CAF50' }]}
  onPress={() => openNearbyInMaps('pharmacy')}
>
  <Text style={styles.primaryBtnText}>💊 Nearby Pharmacies</Text>
</TouchableOpacity>

<TouchableOpacity
  style={[styles.primaryBtn, { backgroundColor: '#FF9800' }]}
  onPress={() => openNearbyInMaps('women help center')}
>
  <Text style={styles.primaryBtnText}>👩 Women Help Centers</Text>
</TouchableOpacity>

<TouchableOpacity
  style={[
    styles.primaryBtn,
    {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: C.teal + '60',
    },
  ]}
  onPress={() => navigate('privacy')}
>
  <Text style={[styles.primaryBtnText, { color: C.teal }]}>🔐 Privacy Policy</Text>
</TouchableOpacity>

<TouchableOpacity
  style={[
    styles.primaryBtn,
    {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: C.pink + '60',
    },
  ]}
  onPress={() => navigate('terms')}
>
  <Text style={[styles.primaryBtnText, { color: C.pink }]}>📜 Terms & Safety Disclaimer</Text>
</TouchableOpacity>
<TouchableOpacity
  style={[
    styles.primaryBtn,
    {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: '#FF3B3070',
    },
  ]}
  onPress={() =>
    Alert.alert('Log Out?', 'You will need to verify your number again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: onLogout },
    ])
  }
>
  <Text style={[styles.primaryBtnText, { color: '#FF3B30' }]}>🚪 Log Out</Text>
</TouchableOpacity>

        <GlassCard style={{ gap: 8, borderColor: C.yellow + '40' }}>
          <Text style={{ color: C.yellow, fontSize: 15, fontWeight: '900' }}>
            Privacy Note
          </Text>

          <Text style={{ color: C.white60, fontSize: 13, lineHeight: 20 }}>
            This profile is stored locally on your phone using app storage.
          </Text>
        </GlassCard>
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
// ============================================================
// FAMILY CIRCLES SCREEN  (Stages 2-5, map-free stable version)
// Create / join circles, see who's sharing live (trip/SOS),
// tap to view their location in Google Maps, privacy controls.
// Auto-refreshes every 8s. No native map = no Google key needed.
// ============================================================
function CirclesScreen({ navigate }) {
  const [circles, setCircles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);

  const loadCircles = async (silent) => {
    try {
      const token = await SecureStore.getItemAsync('token');
      const res = await fetch(`${BASE_URL}/api/circles`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCircles(data.circles || []);
      } else if (!silent) {
        Alert.alert('Could not load circles', data.message || 'Please try again.');
      }
    } catch (e) {
      if (!silent) Alert.alert('Connection error', 'Could not reach the server.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadCircles(false);
    const interval = setInterval(() => loadCircles(true), 8000);
    return () => clearInterval(interval);
  }, []);

  // Everyone (across all circles) currently sharing a location.
  const sharing = [];
  const seen = {};
  circles.forEach((c) => {
    c.members.forEach((m) => {
      const lat = Number(m.lat);
      const lng = Number(m.lng);
      const ok = m.lat != null && m.lng != null && !isNaN(lat) && !isNaN(lng);
      if (ok && !seen[m.user_id]) {
        seen[m.user_id] = true;
        sharing.push({ ...m, latNum: lat, lngNum: lng, circleName: c.name });
      }
    });
  });

  // Am I sharing right now?
  let iAmSharing = false;
  let myStatus = 'idle';
  circles.forEach((c) => {
    c.members.forEach((m) => {
      if (m.is_me && m.lat != null && m.lng != null) {
        iAmSharing = true;
        myStatus = m.status || 'trip';
      }
    });
  });

  const openInMaps = (lat, lng) => {
    Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`).catch(() => {
      Alert.alert('Could not open maps', 'No map app is available.');
    });
  };

  const handleStopSharing = async () => {
    setBusy(true);
    try {
      await publishCircleLocation('idle');
      await stopBackgroundLocation();
      await loadCircles(false);
      Alert.alert('Sharing stopped', 'Your location is no longer shared with your circles.');
    } catch (e) {
      Alert.alert('Error', 'Could not stop sharing. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) {
      Alert.alert('Name needed', 'Please type a name for your circle.');
      return;
    }
    setBusy(true);
    try {
      const token = await SecureStore.getItemAsync('token');
      const res = await fetch(`${BASE_URL}/api/circles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNewName('');
        Alert.alert('Circle created', `Share this code so others can join:\n\n${data.circle.invite_code}`);
        await loadCircles(false);
      } else {
        Alert.alert('Could not create', data.message || 'Please try again.');
      }
    } catch (e) {
      Alert.alert('Connection error', 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async () => {
    if (!joinCode.trim()) {
      Alert.alert('Code needed', 'Please type the 6-character invite code.');
      return;
    }
    setBusy(true);
    try {
      const token = await SecureStore.getItemAsync('token');
      const res = await fetch(`${BASE_URL}/api/circles/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: joinCode.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setJoinCode('');
        Alert.alert('Joined!', `You joined "${data.circle.name}".`);
        await loadCircles(false);
      } else {
        Alert.alert('Could not join', data.message || 'Check the code and try again.');
      }
    } catch (e) {
      Alert.alert('Connection error', 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <GlowCircle color={C.purple} size={280} style={{ top: -80, right: -90 }} />
      <GlowCircle color={C.teal} size={220} style={{ bottom: 120, left: -90 }} />

      <View style={styles.screenHeader}>
        <TouchableOpacity onPress={() => navigate('home')}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Family Circles</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 120 }}>
        {/* Who's sharing right now */}
        <Text style={styles.sectionLabel}>SHARING NOW</Text>
        {sharing.length === 0 ? (
          <GlassCard>
            <Text style={{ color: C.white40, textAlign: 'center' }}>
              No one is sharing right now.
            </Text>
            <Text style={{ color: C.white40, textAlign: 'center', marginTop: 6, fontSize: 12 }}>
              Members appear here only during a trip or SOS.
            </Text>
          </GlassCard>
        ) : (
          sharing.map((m) => (
            <GlassCard key={m.user_id} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={[styles.onlineDot, { backgroundColor: m.status === 'sos' ? C.pink : C.teal }]} />
                <Text style={{ color: C.white, fontSize: 16, fontWeight: '700', flex: 1 }}>
                  {m.name || m.phone}{m.is_me ? ' (you)' : ''}
                </Text>
                <Text style={{ color: m.status === 'sos' ? C.pink : C.teal, fontSize: 12, fontWeight: '700' }}>
                  {m.status === 'sos' ? 'SOS' : 'On a trip'}
                </Text>
              </View>
              <Text style={{ color: C.white40, fontSize: 12 }}>{m.circleName}</Text>
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: C.purple }]}
                onPress={() => openInMaps(m.latNum, m.lngNum)}
              >
                <Text style={styles.primaryBtnText}>View location on map</Text>
              </TouchableOpacity>
            </GlassCard>
          ))
        )}

        {/* Privacy controls */}
        <GlassCard style={{ gap: 10 }}>
          <Text style={styles.sectionLabel}>PRIVACY</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={[styles.onlineDot, { backgroundColor: iAmSharing ? (myStatus === 'sos' ? C.pink : C.teal) : C.white15 }]} />
            <Text style={{ color: C.white, fontSize: 15, fontWeight: '700', flex: 1 }}>
              {iAmSharing
                ? (myStatus === 'sos' ? 'You are sharing (SOS)' : 'You are sharing your location')
                : 'You are not sharing'}
            </Text>
          </View>
          <Text style={{ color: C.white40, fontSize: 12, lineHeight: 18 }}>
            Your location is shared with your circles only during an active trip or SOS — never at other times.
          </Text>
          {iAmSharing && (
            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: C.pink }]} onPress={handleStopSharing} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Stop sharing now</Text>}
            </TouchableOpacity>
          )}
        </GlassCard>

        {/* Create a circle */}
        <GlassCard style={{ gap: 12 }}>
          <Text style={styles.sectionLabel}>CREATE A CIRCLE</Text>
          <TextInput
            style={styles.input}
            placeholder="Circle name (e.g. Family)"
            placeholderTextColor={C.white40}
            value={newName}
            onChangeText={setNewName}
          />
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: C.purple }]} onPress={handleCreate} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>+ Create circle</Text>}
          </TouchableOpacity>
        </GlassCard>

        {/* Join by code */}
        <GlassCard style={{ gap: 12 }}>
          <Text style={styles.sectionLabel}>JOIN BY CODE</Text>
          <TextInput
            style={styles.input}
            placeholder="6-character code"
            placeholderTextColor={C.white40}
            value={joinCode}
            onChangeText={setJoinCode}
            autoCapitalize="characters"
            maxLength={6}
          />
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: C.teal }]} onPress={handleJoin} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Join circle</Text>}
          </TouchableOpacity>
        </GlassCard>

        {/* My circles */}
        <Text style={[styles.sectionLabel, { marginTop: 8 }]}>MY CIRCLES</Text>
        {loading ? (
          <ActivityIndicator color={C.purple} style={{ marginTop: 20 }} />
        ) : circles.length === 0 ? (
          <GlassCard>
            <Text style={{ color: C.white40, textAlign: 'center' }}>
              You're not in any circle yet. Create one or join with a code.
            </Text>
          </GlassCard>
        ) : (
          circles.map((circle) => (
            <GlassCard key={circle.id} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: C.white, fontSize: 17, fontWeight: '800' }}>{circle.name}</Text>
                <Text style={{ color: C.purple, fontWeight: '700', letterSpacing: 1 }}>{circle.invite_code}</Text>
              </View>
              <Text style={{ color: C.white40, fontSize: 12 }}>
                {circle.members.length} member{circle.members.length === 1 ? '' : 's'}
              </Text>
              {circle.members.map((m) => {
                const isSharing = m.lat != null && m.lng != null;
                return (
                  <View key={m.user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <View style={[styles.onlineDot, { backgroundColor: isSharing ? (m.status === 'sos' ? C.pink : C.teal) : C.white15 }]} />
                    <Text style={{ color: C.white70, fontSize: 14, flex: 1 }}>
                      {m.name || m.phone}{m.is_me ? ' (you)' : ''}{m.role === 'owner' ? ' • owner' : ''}
                    </Text>
                    <Text style={{ color: C.white40, fontSize: 11 }}>
                      {isSharing ? (m.status === 'sos' ? 'SOS' : 'sharing') : 'idle'}
                    </Text>
                  </View>
                );
              })}
            </GlassCard>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function ContactsScreen({ navigate, contacts, addContact, deleteContact }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relation, setRelation] = useState('');

  const cleanPhone = (value) => value.replace(/[^\d+]/g, '');

  const isValidPhone = (value) => {
    const cleaned = cleanPhone(value);
    const digitsOnly = cleaned.replace(/\D/g, '');
    return digitsOnly.length >= 10 && digitsOnly.length <= 15;
  };

  const relationEmoji = (value) => {
    const v = value.toLowerCase();

    if (v.includes('mom') || v.includes('mother')) return '👩';
    if (v.includes('dad') || v.includes('father')) return '👨';
    if (v.includes('brother')) return '👦';
    if (v.includes('sister')) return '👧';
    if (v.includes('friend')) return '🧑‍🤝‍🧑';
    if (v.includes('police')) return '👮';

    return '👤';
  };

  const testSMS = (contact) => {
    const message = encodeURIComponent(
      `SAATHI test alert from ${contact.name}. This is only a test message to confirm you are added as a trusted contact.`
    );

    const separator = Platform.OS === 'ios' ? '&' : '?';
    Linking.openURL(`sms:${contact.phone}${separator}body=${message}`);
  };

  const callContact = (contact) => {
    Linking.openURL(`tel:${contact.phone}`);
  };

  const handleDelete = (contact) => {
    Alert.alert(
      'Delete Contact?',
      `Remove ${contact.name} from your trusted circle?`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteContact(contact.id),
        },
      ]
    );
  };

  const handleAdd = () => {
  const cleanName = cleanText(name);
  const cleanPhoneNumber = cleanPhone(phone);
  const cleanRelation = cleanText(relation);

  if (!cleanName) {
    Alert.alert('Name Required', 'Please enter contact name.');
    return;
  }

  if (!isValidIndianPhone(cleanPhoneNumber)) {
    Alert.alert('Invalid Phone', 'Please enter a valid 10-digit phone number.');
    return;
  }

  if (contacts.length >= 5) {
    Alert.alert(
      'Contact Limit Reached',
      'You can keep up to 5 trusted contacts for fast SOS alerts.'
    );
    return;
  }

  const alreadyExists = contacts.some(
    (c) => cleanPhone(c.phone).endsWith(cleanPhoneNumber)
  );

  if (alreadyExists) {
    Alert.alert('Duplicate Contact', 'This phone number is already added.');
    return;
  }

  addContact({
    id: Date.now().toString(),
    name: cleanName,
    phone: `+91 ${cleanPhoneNumber}`,
    rel: cleanRelation || 'Trusted Contact',
    emoji: relationEmoji(`${cleanName} ${cleanRelation}`),
    color: C.purple,
  });

  Alert.alert('Contact Added', `${cleanName} is now in your trusted circle.`);

  setName('');
  setPhone('');
  setRelation('');
};

  return (
    <View style={styles.screen}>
      <GlowCircle color={C.purple} size={250} style={{ top: -50, left: -50 }} />

      <View style={styles.screenHeader}>
        <TouchableOpacity onPress={() => navigate('home')}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.screenTitle}>Trusted Circle</Text>

        <View style={{ width: 60 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 120 }}>
        <View style={styles.planChip}>
          <Text style={{ color: C.purple, fontSize: 12, fontWeight: '600' }}>
            Saved Contacts • {contacts.length}/5
          </Text>
        </View>

        <GlassCard style={{ gap: 12 }}>
          <Text style={styles.inputLabel}>ADD TRUSTED CONTACT</Text>

          <Text style={{ color: C.white40, fontSize: 12, lineHeight: 18 }}>
            These contacts will receive your emergency location through SMS when SOS is active.
          </Text>

          <TextInput
            style={styles.glassInput}
            placeholder="Name e.g. Mom"
            placeholderTextColor={C.white40}
            value={name}
            onChangeText={setName}
          />

          <TextInput
            style={styles.glassInput}
            placeholder="Phone e.g. +91 9876543210"
            placeholderTextColor={C.white40}
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
          />

          <TextInput
            style={styles.glassInput}
            placeholder="Relation e.g. Mother / Friend"
            placeholderTextColor={C.white40}
            value={relation}
            onChangeText={setRelation}
          />

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              {
                backgroundColor: contacts.length >= 5 ? C.white15 : C.purple,
                opacity: contacts.length >= 5 ? 0.6 : 1,
              },
            ]}
            onPress={handleAdd}
            disabled={contacts.length >= 5}
          >
            <Text style={styles.primaryBtnText}>
              {contacts.length >= 5 ? 'Contact Limit Reached' : '+ Save Contact'}
            </Text>
          </TouchableOpacity>
        </GlassCard>

        {contacts.length === 0 ? (
          <GlassCard style={{ alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 34 }}>👥</Text>
            <Text style={{ color: C.white, fontWeight: '800', fontSize: 16 }}>
              No trusted contacts yet
            </Text>
            <Text style={{ color: C.white40, fontSize: 12, textAlign: 'center' }}>
              Add at least one person who should receive your SOS alert.
            </Text>
          </GlassCard>
        ) : (
          contacts.map((c) => (
            <GlassCard key={c.id} style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View
                  style={[
                    styles.contactAvatar,
                    {
                      backgroundColor: (c.color || C.purple) + '30',
                      borderColor: (c.color || C.purple) + '50',
                    },
                  ]}
                >
                  <Text style={{ fontSize: 24 }}>{c.emoji || '👤'}</Text>
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.white, fontWeight: '800', fontSize: 15 }}>
                    {c.name}
                  </Text>
                  <Text style={{ color: C.white40, fontSize: 12 }}>{c.phone}</Text>
                  <Text style={{ color: c.color || C.purple, fontSize: 11, marginTop: 2 }}>
                    {c.rel || 'Trusted Contact'}
                  </Text>
                </View>

                <TouchableOpacity onPress={() => handleDelete(c)}>
                  <Text style={{ color: C.pink, fontWeight: '800', fontSize: 24 }}>×</Text>
                </TouchableOpacity>
              </View>

              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={[
                    styles.primaryBtn,
                    {
                      flex: 1,
                      backgroundColor: 'rgba(0, 200, 122, 0.18)',
                      borderWidth: 1,
                      borderColor: 'rgba(0, 200, 122, 0.35)',
                      paddingVertical: 12,
                    },
                  ]}
                  onPress={() => callContact(c)}
                >
                  <Text style={[styles.primaryBtnText, { fontSize: 12 }]}>📞 Call</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.primaryBtn,
                    {
                      flex: 1,
                      backgroundColor: 'rgba(155, 109, 255, 0.18)',
                      borderWidth: 1,
                      borderColor: 'rgba(155, 109, 255, 0.35)',
                      paddingVertical: 12,
                    },
                  ]}
                  onPress={() => testSMS(c)}
                >
                  <Text style={[styles.primaryBtnText, { fontSize: 12 }]}>💬 Test SMS</Text>
                </TouchableOpacity>
              </View>
            </GlassCard>
          ))
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
function BottomNav({ current, navigate }) {
  const tabs = [
  { id: 'home', icon: 'shield-checkmark-outline', label: 'Home' },
  { id: 'trip', icon: 'map-outline', label: 'Trip' },
  { id: 'evidence', icon: 'folder-outline', label: 'Evidence' },
  { id: 'contacts', icon: 'people-outline', label: 'Contacts' },
  { id: 'nearby', icon: 'location-outline', label: 'Nearby' },
];

  return (
    <View style={styles.bottomNav}>
      {tabs.map((t) => (
        <TouchableOpacity key={t.id} style={styles.navTab} onPress={() => navigate(t.id)}>
          <Ionicons
            name={t.icon}
            size={22}
            color={current === t.id ? C.purple : C.white40}
            style={current === t.id && { transform: [{ scale: 1.1 }] }}
          />

          <Text style={[styles.navLabel, { color: current === t.id ? C.purple : C.white40 }]}>
            {t.label}
          </Text>

          {current === t.id && <View style={styles.navActiveDot} />}
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function App() {
 const [profile, setProfile] = useState({
  name: '',
  age: '',
  bloodGroup: '',
  medicalCondition: '',
  allergies: '',
  medications: '',
  doctorContact: '',
  homeAddress: '',
  emergencyNote: '',
});
const loadProfile = async () => {
  try {
    const saved = await secureGetJSON(PROFILE_KEY);

if (saved) {
  setProfile(saved);
}
  } catch (error) {
    console.log('Load profile error:', error);
  }
};

const saveProfile = async (newProfile) => {
  try {
    setProfile(newProfile);
    await secureSetJSON(PROFILE_KEY, newProfile);
    Alert.alert('Profile Saved', 'Your medical safety profile has been saved.');
  } catch (error) {
    console.log('Save profile error:', error);
    Alert.alert('Save Error', 'Could not save profile.');
  }
};
  const [isOffline, setIsOffline] = useState(false);
  const [screen, setScreen] = useState('splash');
  const [sosData, setSosData] = useState(null);
  const [contacts, setContacts] = useState(DEFAULT_CONTACTS);
  const [evidenceHistory, setEvidenceHistory] = useState([]);
  const [selectedEvidence, setSelectedEvidence] = useState(null);
  useEffect(() => {
  loadContacts();
  loadEvidenceHistory();
  loadProfile();
}, []);
useEffect(() => {
  const unsubscribe = NetInfo.addEventListener((state) => {
    const offline = !state.isConnected || state.isInternetReachable === false;
    setIsOffline(offline);
  });

  return () => unsubscribe();
}, []);

  const loadContacts = async () => {
    try {
  const saved = await secureGetJSON(CONTACTS_KEY);

if (saved) {
  setContacts(saved);
}
    } catch (error) {
      console.log('Contact load error:', error);
    }
  };
  const loadEvidenceHistory = async () => {
  try {
    const saved = await secureGetJSON(EVIDENCE_HISTORY_KEY, []);

setEvidenceHistory(saved);
  } catch (error) {
    console.log('Load evidence history error:', error);
  }
};

const saveEvidenceRecord = async (record) => {
  try {
    const updatedHistory = [record, ...evidenceHistory];

    setEvidenceHistory(updatedHistory);

    await secureSetJSON(EVIDENCE_HISTORY_KEY, updatedHistory);
  } catch (error) {
    console.log('Save evidence error:', error);
  }
};

const deleteEvidenceRecord = async (id) => {
  try {
    const updatedHistory = evidenceHistory.filter((item) => item.id !== id);

    setEvidenceHistory(updatedHistory);

    await secureSetJSON(EVIDENCE_HISTORY_KEY, updatedHistory);
  } catch (error) {
    console.log('Delete evidence error:', error);
  }
};

  const saveContacts = async (nextContacts) => {
    try {
      setContacts(nextContacts);
await secureSetJSON(CONTACTS_KEY, nextContacts);    } catch (error) {
      Alert.alert('Save Error', 'Could not save contacts.');
    }
  };

  const addContact = (contact) => {
    const nextContacts = [...contacts, contact];
    saveContacts(nextContacts);
  };

  const deleteContact = (id) => {
    const nextContacts = contacts.filter((c) => c.id !== id);
    saveContacts(nextContacts);
  };

  const navigate = (s, data = null) => {
  if (s === 'sos') {
    // Show SOS instantly; fetch precise location in the background.
    setSosData(data && data.available ? data : { available: false });
    if (!(data && data.available)) {
      getSOSLocation().then((d) => {
        if (d) setSosData(d);
      });
    }
  }

  if (s === 'evidenceDetail') {
    setSelectedEvidence(data);
  }

  setScreen(s);
};
const handleLogout = async () => {
    try {
      await SecureStore.deleteItemAsync('token');
      await SecureStore.deleteItemAsync('refreshToken');
      await SecureStore.deleteItemAsync('user');
    } catch (e) {
      console.log('Logout error:', e);
    }
    setScreen('login');
  };

useEffect(() => {
  const onBack = () => {
    // On these "root" screens, let Android do its default (exit / nothing).
    if (['splash', 'onboarding', 'login', 'home'].includes(screen)) {
      return false;
    }
    // Detail screen returns to its list; everything else returns home.
    setScreen(screen === 'evidenceDetail' ? 'evidence' : 'home');
    return true; // we handled it
  };

  const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
  return () => sub.remove();
}, [screen]);

// Shake-to-SOS: several hard shakes launch emergency mode without opening any menu.
useEffect(() => {
  const armed = !['splash', 'onboarding', 'login', 'sos'].includes(screen);
  if (!armed) return;

  let shakeCount = 0;
  let lastSpike = 0;
  let lastTrigger = 0;

  Accelerometer.setUpdateInterval(100);
  const accelSub = Accelerometer.addListener(({ x, y, z }) => {
    const magnitude = Math.sqrt(x * x + y * y + z * z); // ~1 at rest (g units)
    const now = Date.now();

    if (magnitude > 1.8) {
      shakeCount = now - lastSpike < 1000 ? shakeCount + 1 : 1;
      lastSpike = now;

      // 3 strong shakes within ~1s, at most once every 4s, avoids pocket false-positives.
      if (shakeCount >= 3 && now - lastTrigger > 4000) {
        lastTrigger = now;
        shakeCount = 0;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        navigate('sos');
      }
    }
  });

  return () => accelSub.remove();
}, [screen]);
const showNav = [
  'home',
  'trip',
  'evidence',
  'contacts',
  'nearby',
  'checkin',
  'guide',
  'profile',
  'privacy',
  'terms',
].includes(screen);
return (
  <View style={{ flex: 1, backgroundColor: C.bg }}>
    <StatusBar barStyle="light-content" backgroundColor={C.bg} />

    {screen === 'splash' && (
      <SplashScreen onDone={async () => {
        const savedToken = await SecureStore.getItemAsync('token');
        setScreen(savedToken ? 'home' : 'onboarding');
      }} />
    )}
{screen === 'onboarding' && (
  <OnboardingScreen onDone={() => setScreen('login')} />
)}

{screen === 'login' && (
  <LoginScreen onLogin={() => setScreen('home')} />
)}

{screen === 'home' && (
  <>
    <HomeScreen navigate={navigate} contacts={contacts} isOffline={isOffline} />
  </>
)}
{screen === 'sos' && (
  <SOSScreen
    navigate={navigate}
    sosData={sosData}
    contacts={contacts}
    saveEvidenceRecord={saveEvidenceRecord}
  />
)}

{screen === 'fakecall' && (
  <FakeCallScreen navigate={navigate} />
)}

{screen === 'trip' && (
  <SafeTripScreen navigate={navigate} />
)}

{screen === 'checkin' && (
  <CheckInScreen navigate={navigate} />
)}

{screen === 'nearby' && (
  <NearbyScreen navigate={navigate} />
)}
{screen === 'circles' && (
  <CirclesScreen navigate={navigate} />
)}
{screen === 'guide' && (
  <SafetyGuideScreen navigate={navigate} />
)}
{screen === 'siren' && (
  <SirenScreen navigate={navigate} />
)}
{screen === 'emergencyCard' && (
  <EmergencyCardScreen navigate={navigate} profile={profile} contacts={contacts} />
)}
{screen === 'tourist' && (
  <TouristModeScreen navigate={navigate} />
)}
{screen === 'evidence' && (
  <EvidenceHistoryScreen
    navigate={navigate}
    evidenceHistory={evidenceHistory}
    deleteEvidenceRecord={deleteEvidenceRecord}
  />
)}

{screen === 'evidenceDetail' && (
  <EvidenceDetailScreen
    navigate={navigate}
    record={selectedEvidence}
    deleteEvidenceRecord={deleteEvidenceRecord}
  />
)}
{screen === 'profile' && (
  <ProfileScreen
    navigate={navigate}
    profile={profile}
    saveProfile={saveProfile}
    onLogout={handleLogout}
  />
)}
{screen === 'privacy' && (
  <PrivacyPolicyScreen navigate={navigate} />
)}

{screen === 'terms' && (
  <TermsScreen navigate={navigate} />
)}
{screen === 'contacts' && (
  <ContactsScreen
    navigate={navigate}
    contacts={contacts}
    addContact={addContact}
    deleteContact={deleteContact}
  />
)}
     {showNav && <BottomNav current={screen} navigate={navigate} />}
</View>
);
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.bg,
  },

  splashLogo: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: C.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },

  splashTitle: {
    fontSize: 40,
    fontWeight: '800',
    color: C.white,
    letterSpacing: 6,
    marginTop: 28,
  },

  splashSub: {
    fontSize: 15,
    color: C.white40,
    marginTop: 6,
    letterSpacing: 1,
  },

  onboardIcon: {
    width: 140,
    height: 140,
    borderRadius: 40,
    backgroundColor: C.white08,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },

  onboardTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: C.white,
    textAlign: 'center',
    marginBottom: 14,
  },

  onboardSub: {
    fontSize: 16,
    color: C.white40,
    textAlign: 'center',
    lineHeight: 26,
    paddingHorizontal: 24,
  },

  dotsRow: {
    flexDirection: 'row',
    gap: 8,
  },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.white15,
  },

  primaryBtn: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 16,
    alignItems: 'center',
  },

  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  loginTitle: {
    fontSize: 34,
    fontWeight: '800',
    color: C.white,
    lineHeight: 42,
    marginBottom: 10,
  },

  loginSub: {
    fontSize: 15,
    color: C.white40,
  },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.white08,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.cardBorder,
    overflow: 'hidden',
  },

  countryCode: {
    paddingHorizontal: 14,
    paddingVertical: 16,
    borderRightWidth: 1,
    borderRightColor: C.cardBorder,
    backgroundColor: C.white08,
  },

  input: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 16,
    fontSize: 18,
    color: C.white,
    backgroundColor: 'transparent',
  },

  homeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 56,
  },

  homeGreeting: {
    fontSize: 14,
    color: C.white40,
  },

  homeName: {
    fontSize: 24,
    fontWeight: '800',
    color: C.white,
    marginTop: 2,
  },

  avatarBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.white08,
    borderWidth: 1,
    borderColor: C.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },

  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.teal + '15',
    borderWidth: 1,
    borderColor: C.teal + '30',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: 'center',
    marginTop: 16,
  },

  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.teal,
  },

  statusChipText: {
    color: C.teal,
    fontSize: 13,
    fontWeight: '500',
  },

  sosHint: {
    color: C.white40,
    fontSize: 12,
    marginBottom: 16,
    letterSpacing: 1,
  },

  sosOuter: {
    width: 168,
    height: 168,
    borderRadius: 84,
    backgroundColor: 'rgba(217,99,122,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(217,99,122,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  sosInner: {
    width: 142,
    height: 142,
    borderRadius: 71,
    backgroundColor: 'rgba(217,99,122,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(217,99,122,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  sosCore: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: C.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },

  sosBtnText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 3,
  },

  sosBtnSub: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },

  sosProgress: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: C.white40,
    letterSpacing: 1.5,
    paddingHorizontal: 20,
  },

  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 16,
    paddingHorizontal: 20,
    marginTop: 12,
  },

  actionCard: {
    width: (width - 60) / 3,
    alignItems: 'center',
    gap: 8,
  },

  actionIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  actionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: C.white70,
    textAlign: 'center',
    lineHeight: 15,
  },

  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  contactAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.teal,
  },

  addContactBtn: {
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: C.cardBorder,
    marginTop: 4,
  },

  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.white08,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },

  liveDot2: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#D9637A',
  },

  liveText2: {
    fontSize: 13,
    fontWeight: '700',
    color: C.white,
    letterSpacing: 2,
  },

  elapsedText: {
    fontSize: 13,
    color: C.white40,
    marginLeft: 8,
  },

  sosActivePulse: {
    width: 200,
    height: 200,
    borderRadius: 100,
   backgroundColor: 'rgba(217,99,122,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(217,99,122,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
  },

  sosActiveCircle: {
    width: 170,
    height: 170,
   borderRadius: 85,
    backgroundColor: '#B23A50',
    alignItems: 'center',
    justifyContent: 'center',
  },

  callerAvatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: C.white08,
    borderWidth: 2,
    borderColor: C.white15,
    alignItems: 'center',
    justifyContent: 'center',
  },

  callerName: {
    fontSize: 34,
    fontWeight: '700',
    color: C.white,
    marginTop: 20,
  },

  callerStatus: {
    fontSize: 18,
    color: C.white40,
    marginTop: 6,
  },

  callBtns: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 40,
    paddingBottom: 40,
  },

  answerBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#00C87A',
    alignItems: 'center',
    justifyContent: 'center',
  },

  hangupBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
  },

  callerPreview: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: C.white08,
    borderWidth: 1,
    borderColor: C.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },

  callerChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },

  liveRow2: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },

  tripPin: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: C.teal + '20',
    borderWidth: 2,
    borderColor: C.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },

  checkIcon: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: C.yellow + '20',
    borderWidth: 1,
    borderColor: C.yellow + '50',
    alignItems: 'center',
    justifyContent: 'center',
  },

  glassInput: {
    backgroundColor: C.white08,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: C.white,
  },

  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: C.white40,
    letterSpacing: 1.5,
  },

  tabBtn: {
  width: '48%',
  paddingVertical: 16,
  borderRadius: 16,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(255,255,255,0.05)',
},
  emergencyRow: {
    flexDirection: 'row',
    gap: 10,
  },

  emergencyBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },

  placeIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  navBtn: {
    backgroundColor: C.purple + '20',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },

  planChip: {
    backgroundColor: C.purple + '15',
    borderWidth: 1,
    borderColor: C.purple + '30',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },

  bottomNav: {
    flexDirection: 'row',
    backgroundColor: C.bg2,
    borderTopWidth: 1,
    borderTopColor: C.cardBorder,
    paddingBottom: 28,
    paddingTop: 12,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },

  navTab: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    position: 'relative',
  },

  navIcon: {
    fontSize: 22,
  },

  navLabel: {
    fontSize: 11,
    fontWeight: '500',
  },

  navActiveDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.purple,
    marginTop: 2,
  },

  screenHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 16,
  },

  backBtn: {
    color: C.purple,
    fontSize: 15,
    fontWeight: '600',
  },

  screenTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.white,
  },
});