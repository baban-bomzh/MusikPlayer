import React, { useState, useEffect, useRef, useMemo, useContext, createContext } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, Modal, ScrollView, Alert, Switch, Image,
  Animated, Easing, AccessibilityInfo, Dimensions,
  StyleSheet, Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Необязательные пакеты: если не установлены, приложение работает без них
let FS;
try { FS = require('expo-file-system/legacy'); } catch (e) { FS = require('expo-file-system'); }
let Blur = null;
try { Blur = require('expo-blur').BlurView; } catch (e) {}
let LiquidGlass = null;
try {
  const g = require('expo-glass-effect');
  if (g.GlassView && (!g.isLiquidGlassAvailable || g.isLiquidGlassAvailable())) LiquidGlass = g.GlassView;
} catch (e) {}

const { width: W, height: H } = Dimensions.get('window');

// ---------- Темы и настройки ----------
const ACCENTS = ['#111111', '#4F46E5', '#FF6B8A', '#FFB020', '#2DD36F', '#FF7A2F'];
const THEMES = {
  light: {
    name: 'Светлая', dark: false, bg: '#F3F2EE', surface: '#FFFFFF', text: '#111114', muted: '#6A6A74',
    line: 'rgba(0,0,0,0.08)', bar: 'rgba(0,0,0,0.12)', glass: 'rgba(255,255,255,0.5)', glassSolid: '#FFFFFF',
    glassBorder: 'rgba(255,255,255,0.8)', pill: 'rgba(0,0,0,0.08)', tint: 'light', status: 'dark',
  },
  dark: {
    name: 'Тёмная', dark: true, bg: '#0C0D10', surface: '#1B1C22', text: '#F2F1EE', muted: '#A3A3AD',
    line: 'rgba(255,255,255,0.08)', bar: 'rgba(255,255,255,0.16)', glass: 'rgba(34,35,44,0.5)', glassSolid: '#24252D',
    glassBorder: 'rgba(255,255,255,0.16)', pill: 'rgba(255,255,255,0.14)', tint: 'dark', status: 'light',
  },
  amoled: {
    name: 'AMOLED', dark: true, bg: '#000000', surface: '#111114', text: '#F2F1EE', muted: '#A3A3AD',
    line: 'rgba(255,255,255,0.08)', bar: 'rgba(255,255,255,0.16)', glass: 'rgba(24,24,28,0.55)', glassSolid: '#1A1A1E',
    glassBorder: 'rgba(255,255,255,0.14)', pill: 'rgba(255,255,255,0.14)', tint: 'dark', status: 'light',
  },
};
const SHAPES = { round: 'Скруглённые', circle: 'Круглые', square: 'Квадратные' };
const DEFAULTS = {
  theme: 'light', accent: ACCENTS[0], shape: 'round', compact: false, letter: true, sort: 'new',
  wMode: 'auto', geo: null, fx: true, card: true,
};
const ART = ['#6B4FC4', '#2E9C8F', '#D98A2B', '#3F5E94', '#B34FB3', '#6E9A2E', '#C2506B', '#4A8FA8'];

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};
const effAccent = (accent, T) => (T.dark && lum(accent) < 0.25 ? '#F2F1EE' : accent);
const onColor = (hex) => (lum(hex) > 0.6 ? '#0F1013' : '#FFFFFF');

const ROOT = FS.documentDirectory || '';
const DIR = ROOT + 'tracks/';
const COVERS = ROOT + 'covers/';
const K_TRACKS = 'mp:tracks';
const K_CFG = 'mp:cfg2';
const K_PL = 'mp:playlists';

const fmt = (s) => (!s || s < 0 ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
function parseName(file) {
  const base = file.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const i = base.indexOf(' - ');
  if (i > 0) return { artist: base.slice(0, i).trim(), title: base.slice(i + 3).trim() || base };
  return { artist: 'Неизвестный исполнитель', title: base || 'Без названия' };
}
const hash = (str) => { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const uid = () => `${Date.now()}${Math.floor(Math.random() * 10000)}`;
const plural = (n, a, b, c) => {
  const m = n % 100, d = n % 10;
  if (m > 10 && m < 20) return c;
  if (d === 1) return a;
  if (d >= 2 && d <= 4) return b;
  return c;
};
const tracksWord = (n) => `${n} ${plural(n, 'трек', 'трека', 'треков')}`;

// ---------- Погода (Open-Meteo, без ключей) ----------
const KINDS = {
  clear: 'Ясно', clouds: 'Облачно', rain: 'Дождь', snow: 'Снег', storm: 'Гроза', fog: 'Туман',
};
const kindFromCode = (c) =>
  c === 0 ? 'clear' : c <= 3 ? 'clouds' : c === 45 || c === 48 ? 'fog'
    : (c >= 51 && c <= 67) || (c >= 80 && c <= 82) ? 'rain'
      : (c >= 71 && c <= 77) || c === 85 || c === 86 ? 'snow' : c >= 95 ? 'storm' : 'clouds';
const kindIcon = (k, isDay) =>
  k === 'clear' ? (isDay ? 'sunny' : 'moon') : k === 'clouds' ? 'partly-sunny' : k === 'rain' ? 'rainy'
    : k === 'snow' ? 'snow' : k === 'storm' ? 'thunderstorm' : 'cloud';
const TINTS = { clear: '#FFC857', clouds: '#8A94A6', rain: '#4A6A8A', snow: '#BFD7EE', storm: '#3B3F63', fog: '#9AA3A8' };

async function getJson(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`Ответ ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function geocode(name) {
  const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=ru`);
  const r = j.results && j.results[0];
  if (!r) return null;
  return { lat: r.latitude, lon: r.longitude, name: r.name };
}
async function fetchWeather(geo) {
  const j = await getJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,weather_code,is_day&timezone=auto`
  );
  const c = j.current;
  return { temp: Math.round(c.temperature_2m), kind: kindFromCode(c.weather_code), isDay: c.is_day === 1 };
}

// ---------- Контекст ----------
const Ctx = createContext(null);
const useUI = () => useContext(Ctx);

function makeStyles(T, A, OA) {
  return StyleSheet.create({
    head: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
    h1: { color: T.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.8 },
    count: { color: T.muted, fontSize: 13, fontWeight: '600', marginTop: 2 },
    addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: A, paddingHorizontal: 16, minHeight: 42, borderRadius: 21 },
    addTxt: { color: OA, fontSize: 14, fontWeight: '700' },
    iconBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: T.glass, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: T.glassBorder },
    search: { marginHorizontal: 20, marginBottom: 8, height: 46, borderRadius: 14, backgroundColor: T.glass, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: T.glassBorder },
    input: { flex: 1, color: T.text, fontSize: 16, fontWeight: '500' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 20, paddingRight: 8 },
    title: { color: T.text, fontSize: 15, fontWeight: '600' },
    sub: { color: T.muted, fontSize: 13, marginTop: 2 },
    empty: { alignItems: 'center', marginTop: 50, paddingHorizontal: 36, gap: 12 },
    emptyH: { color: T.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
    emptyP: { color: T.muted, fontSize: 15, textAlign: 'center', lineHeight: 21 },
    full: { flex: 1, backgroundColor: T.bg, paddingHorizontal: 28 },
    fullHead: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
    fullCap: { color: T.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
    fullTitle: { color: T.text, fontSize: 24, fontWeight: '800' },
    fullArtist: { color: T.muted, fontSize: 16, marginTop: 2 },
    bar: { height: 4, borderRadius: 2, backgroundColor: T.bar },
    times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
    timeTxt: { color: T.muted, fontSize: 12, fontWeight: '600' },
    controls: { marginTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
    playBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: A, alignItems: 'center', justifyContent: 'center' },
    sec: { color: T.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1, marginHorizontal: 20, marginTop: 22, marginBottom: 10 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20 },
    chip: { paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: 999, backgroundColor: T.glass, borderWidth: StyleSheet.hairlineWidth, borderColor: T.glassBorder },
    chipOn: { backgroundColor: A, borderColor: A },
    chipTxt: { color: T.text, fontSize: 14, fontWeight: '600' },
    chipTxtOn: { color: OA },
    swatches: { flexDirection: 'row', gap: 14, paddingHorizontal: 20 },
    sw: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: T.glassBorder },
    setRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, minHeight: 48 },
    setTxt: { color: T.text, fontSize: 16, fontWeight: '500' },
    note: { color: T.muted, fontSize: 13, lineHeight: 19, marginHorizontal: 20, marginTop: 8 },
    danger: { marginHorizontal: 20, marginTop: 24, minHeight: 48, borderRadius: 14, backgroundColor: T.glass, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: T.glassBorder },
    dangerTxt: { color: '#E5484D', fontSize: 15, fontWeight: '700' },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: T.bar, marginBottom: 12 },
    sheetTitle: { color: T.text, fontSize: 17, fontWeight: '800', paddingHorizontal: 22 },
    sheetSub: { color: T.muted, fontSize: 13, paddingHorizontal: 22, marginTop: 2, marginBottom: 8 },
    sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 22, minHeight: 52 },
    sheetTxt: { color: T.text, fontSize: 16, fontWeight: '500', flex: 1 },
    plTile: { alignItems: 'center', justifyContent: 'center', backgroundColor: T.glass },
    playAll: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginVertical: 10, minHeight: 46, borderRadius: 23, backgroundColor: A },
    tab: { flex: 1, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', gap: 2 },
    tabOn: { backgroundColor: T.pill },
    tabTxt: { color: T.muted, fontSize: 10, fontWeight: '700' },
  });
}

// ---------- Анимации ----------
let REDUCE = false;
AccessibilityInfo.isReduceMotionEnabled().then((v) => { REDUCE = v; }).catch(() => {});

function Press({ children, onPress, style, label }) {
  const sc = useRef(new Animated.Value(1)).current;
  const to = (v) => { if (!REDUCE) Animated.spring(sc, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 6 }).start(); };
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} onPressIn={() => to(0.92)} onPressOut={() => to(1)}>
      <Animated.View style={[style, { transform: [{ scale: sc }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

function FadeIn({ index = 0, children }) {
  const v = useRef(new Animated.Value(REDUCE ? 1 : 0)).current;
  useEffect(() => {
    if (REDUCE) return;
    Animated.timing(v, { toValue: 1, duration: 320, delay: Math.min(index, 8) * 40, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}

function EqBars({ playing, color }) {
  const base = [0.4, 0.8, 0.5];
  const vals = useRef(base.map((x) => new Animated.Value(x))).current;
  useEffect(() => {
    if (!playing || REDUCE) { vals.forEach((v, i) => v.setValue(base[i])); return; }
    const loops = vals.map((v, i) => Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 360 + i * 120, useNativeDriver: false }),
      Animated.timing(v, { toValue: 0.25, duration: 360 + i * 120, useNativeDriver: false }),
    ])));
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [playing]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 18, width: 18 }}>
      {vals.map((v, i) => (
        <Animated.View key={i} style={{ width: 4, borderRadius: 2, backgroundColor: color, height: v.interpolate({ inputRange: [0, 1], outputRange: [0, 18] }) }} />
      ))}
    </View>
  );
}

// ---------- Эффекты погоды ----------
function Fall({ c, color, kind }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.timing(v, { toValue: 1, duration: c.dur, delay: c.delay, easing: Easing.linear, useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, []);
  const ty = v.interpolate({ inputRange: [0, 1], outputRange: [-40, H + 40] });
  const tx = v.interpolate({ inputRange: [0, 1], outputRange: [0, c.drift] });
  return (
    <Animated.View style={{
      position: 'absolute', left: c.x, top: 0, opacity: c.o,
      transform: [{ translateY: ty }, { translateX: tx }, { rotate: kind === 'snow' ? '0deg' : '10deg' }],
    }}>
      {kind === 'snow'
        ? <View style={{ width: c.s, height: c.s, borderRadius: c.s / 2, backgroundColor: color }} />
        : <View style={{ width: 1.5, height: c.len, borderRadius: 1, backgroundColor: color }} />}
    </Animated.View>
  );
}

function Cloud({ y, dur, delay, size, color }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.timing(v, { toValue: 1, duration: dur, delay, easing: Easing.linear, useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, []);
  return (
    <Animated.View style={{
      position: 'absolute', top: y, left: 0, width: size, height: size * 0.32, borderRadius: size, backgroundColor: color, opacity: 0.22,
      transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-size, W] }) }],
    }} />
  );
}

function Pulse({ children, style, from = 0.15, to = 0.32, dur = 3000 }) {
  const v = useRef(new Animated.Value(from)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: to, duration: dur, useNativeDriver: true }),
      Animated.timing(v, { toValue: from, duration: dur, useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, []);
  return <Animated.View style={[style, { opacity: v }]}>{children}</Animated.View>;
}

function Flash() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let alive = true;
    const run = () => {
      if (!alive) return;
      Animated.sequence([
        Animated.delay(4000 + Math.random() * 6000),
        Animated.timing(v, { toValue: 0.45, duration: 60, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 140, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.3, duration: 60, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start(run);
    };
    run();
    return () => { alive = false; v.stopAnimation(); };
  }, []);
  return <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: v }]} />;
}

function WeatherFX({ kind, isDay, dark }) {
  const n = kind === 'rain' || kind === 'storm' ? 34 : kind === 'snow' ? 28 : 0;
  const items = useMemo(() => Array.from({ length: n }, () => ({
    x: Math.random() * W,
    dur: kind === 'snow' ? 7000 + Math.random() * 7000 : 800 + Math.random() * 700,
    delay: Math.random() * 3000,
    o: 0.25 + Math.random() * 0.3,
    s: 3 + Math.random() * 4,
    len: 12 + Math.random() * 14,
    drift: kind === 'snow' ? (Math.random() - 0.5) * 80 : 30,
  })), [kind]);
  const stars = useMemo(() => Array.from({ length: 16 }, () => ({ x: Math.random() * W, y: 40 + Math.random() * H * 0.5, s: 2 + Math.random() * 2 })), []);
  if (!kind || REDUCE) return null;
  const drop = dark ? '#BFD4EA' : '#5B7FA6';
  const flake = dark ? '#FFFFFF' : '#8FB0D0';
  const cloudColor = dark ? '#C9D3E0' : '#7C8AA0';
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {kind === 'clear' && isDay && (
        <Pulse style={{ position: 'absolute', top: -70, right: -50, width: 240, height: 240, borderRadius: 120, backgroundColor: '#FFC857' }} />
      )}
      {kind === 'clear' && !isDay && stars.map((s, i) => (
        <Pulse key={i} from={0.1} to={0.7} dur={1200 + i * 150} style={{ position: 'absolute', left: s.x, top: s.y, width: s.s, height: s.s, borderRadius: s.s, backgroundColor: dark ? '#fff' : '#334' }} />
      ))}
      {(kind === 'clouds' || kind === 'rain' || kind === 'storm' || kind === 'fog') && (
        <>
          <Cloud y={60} size={260} dur={60000} delay={0} color={cloudColor} />
          <Cloud y={190} size={200} dur={80000} delay={9000} color={cloudColor} />
          <Cloud y={320} size={300} dur={70000} delay={22000} color={cloudColor} />
        </>
      )}
      {kind === 'fog' && (
        <Pulse from={0.05} to={0.18} dur={5000} style={[StyleSheet.absoluteFill, { backgroundColor: cloudColor }]} />
      )}
      {(kind === 'rain' || kind === 'storm') && items.map((c, i) => <Fall key={i} c={c} color={drop} kind="rain" />)}
      {kind === 'snow' && items.map((c, i) => <Fall key={i} c={c} color={flake} kind="snow" />)}
      {kind === 'storm' && <Flash />}
    </View>
  );
}

// ---------- Стекло ----------
function Glass({ style, children, intensity = 45, radius = 24 }) {
  const { T } = useUI();
  const base = { borderRadius: radius, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: T.glassBorder };
  if (LiquidGlass) {
    return <LiquidGlass glassEffectStyle="regular" isInteractive style={[base, style]}>{children}</LiquidGlass>;
  }
  if (Blur) {
    return (
      <View style={[base, style]}>
        <Blur intensity={intensity} tint={T.tint} style={StyleSheet.absoluteFill} />
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: T.glass }]} />
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: T.glassBorder }} />
        {children}
      </View>
    );
  }
  return <View style={[base, style, { backgroundColor: T.glassSolid }]}>{children}</View>;
}

// ---------- Нижнее меню (sheet) ----------
function Sheet({ visible, title, subtitle, actions = [], note, onClose }) {
  const { S, A, T } = useUI();
  const y = useRef(new Animated.Value(400)).current;
  useEffect(() => {
    if (!visible) return;
    if (REDUCE) { y.setValue(0); return; }
    y.setValue(400);
    Animated.spring(y, { toValue: 0, useNativeDriver: true, speed: 16, bounciness: 4 }).start();
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={S.backdrop} onPress={onClose}>
        <Animated.View style={{ transform: [{ translateY: y }], maxHeight: '80%', marginHorizontal: 8, marginBottom: 10 }}>
          <Glass radius={30} style={{ paddingTop: 10, paddingBottom: 14 }}>
            <Pressable>
              <View style={S.grab} />
              {!!title && <Text style={S.sheetTitle} numberOfLines={1}>{title}</Text>}
              {!!subtitle && <Text style={S.sheetSub} numberOfLines={1}>{subtitle}</Text>}
              {!!note && <Text style={[S.sheetSub, { marginTop: 10, marginBottom: 6 }]}>{note}</Text>}
              <ScrollView bounces={false}>
                {actions.map((a, i) => (
                  <Pressable key={i} style={S.sheetRow} onPress={a.onPress}>
                    <Ionicons name={a.icon} size={22} color={a.danger ? '#E5484D' : A} />
                    <Text style={[S.sheetTxt, a.danger && { color: '#E5484D' }]} numberOfLines={1}>{a.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Glass>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

// ---------- Компоненты ----------
function Art({ track, size = 52 }) {
  const { cfg } = useUI();
  const radius = cfg.shape === 'circle' ? size / 2 : cfg.shape === 'square' ? 0 : Math.round(size * 0.2);
  if (track?.cover) {
    return <Image source={{ uri: COVERS + track.cover }} style={{ width: size, height: size, borderRadius: radius, backgroundColor: '#222' }} />;
  }
  const color = ART[hash(track ? track.title + track.artist : 'x') % ART.length];
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      {cfg.letter ? (
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.4 }}>{(track?.title || '?').trim().charAt(0).toUpperCase()}</Text>
      ) : (
        <Ionicons name="musical-notes" size={size * 0.4} color="#ffffffcc" />
      )}
    </View>
  );
}

function TrackRow({ track, index, active, playing, onPlay, onMore }) {
  const { S, A, T, cfg } = useUI();
  const size = cfg.compact ? 40 : 52;
  return (
    <FadeIn index={index}>
      <Pressable onPress={() => onPlay(track)} onLongPress={() => onMore(track)} style={[S.row, { paddingVertical: cfg.compact ? 4 : 7 }]}>
        <Art track={track} size={size} />
        <View style={{ flex: 1 }}>
          <Text style={[S.title, active && { fontWeight: '800' }]} numberOfLines={1}>{track.title}</Text>
          <Text style={S.sub} numberOfLines={1}>{track.artist}{track.dur ? ` · ${fmt(track.dur)}` : ''}</Text>
        </View>
        {active && <EqBars playing={playing} color={A} />}
        <Pressable onPress={() => onMore(track)} hitSlop={6} style={{ padding: 10 }} accessibilityLabel="Меню трека">
          <Ionicons name="ellipsis-horizontal" size={22} color={T.muted} />
        </Pressable>
      </Pressable>
    </FadeIn>
  );
}

function MiniPlayer({ track, playing, pos, dur, onToggle, onNext, onOpen }) {
  const { S, A, T } = useUI();
  const y = useRef(new Animated.Value(REDUCE ? 0 : 90)).current;
  const has = !!track;
  useEffect(() => {
    if (has && !REDUCE) {
      y.setValue(90);
      Animated.spring(y, { toValue: 0, useNativeDriver: true, speed: 14, bounciness: 8 }).start();
    }
  }, [has]);
  if (!track) return null;
  return (
    <Animated.View style={{ transform: [{ translateY: y }], marginHorizontal: 14, marginBottom: 10 }}>
      <Glass radius={26}>
        <Pressable onPress={onOpen} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8 }}>
          <Art track={track} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={[S.title, { fontSize: 14 }]} numberOfLines={1}>{track.title}</Text>
            <Text style={S.sub} numberOfLines={1}>{track.artist}</Text>
          </View>
          <Pressable onPress={onToggle} hitSlop={8} style={{ padding: 8 }} accessibilityLabel="Играть или пауза">
            <Ionicons name={playing ? 'pause' : 'play'} size={26} color={T.text} />
          </Pressable>
          <Pressable onPress={onNext} hitSlop={8} style={{ padding: 8, marginRight: 4 }} accessibilityLabel="Следующий">
            <Ionicons name="play-skip-forward" size={24} color={T.text} />
          </Pressable>
          <View style={{ position: 'absolute', left: 16, right: 16, bottom: 0, height: 2, backgroundColor: T.bar }}>
            <View style={{ width: `${dur ? Math.min((pos / dur) * 100, 100) : 0}%`, height: 2, backgroundColor: A }} />
          </View>
        </Pressable>
      </Glass>
    </Animated.View>
  );
}

function FullPlayer(p) {
  const { S, A, OA, T } = useUI();
  const barW = useRef(1);
  const [showQ, setShowQ] = useState(false);
  const sc = useRef(new Animated.Value(p.playing ? 1 : 0.88)).current;
  useEffect(() => {
    const v = p.playing ? 1 : 0.88;
    if (REDUCE) sc.setValue(v);
    else Animated.spring(sc, { toValue: v, useNativeDriver: true, speed: 10, bounciness: 8 }).start();
  }, [p.playing]);
  const { track } = p;
  if (!track) return null;
  const dur = p.dur || 1;
  const qActions = [
    ...(p.upNext.length ? [{ icon: 'trash-outline', label: 'Очистить очередь', danger: true, onPress: () => p.onClearQueue() }] : []),
    ...p.upNext.map((t) => ({ icon: 'close-circle-outline', label: `${t.title} — ${t.artist}`, onPress: () => p.onRemoveQueue(t.id) })),
  ];
  return (
    <Modal visible={p.visible} animationType="slide" onRequestClose={p.onClose}>
      <SafeAreaView style={S.full}>
        {p.tint && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: p.tint, opacity: 0.16 }]} />}
        <WeatherFX kind={p.fx ? p.kind : null} isDay={p.isDay} dark={T.dark} />
        <View style={S.fullHead}>
          <Pressable onPress={p.onClose} hitSlop={12} accessibilityLabel="Свернуть">
            <Ionicons name="chevron-down" size={30} color={T.text} />
          </Pressable>
          <Text style={S.fullCap}>СЕЙЧАС ИГРАЕТ</Text>
          <Pressable onPress={() => setShowQ(true)} hitSlop={12} accessibilityLabel="Очередь">
            <Ionicons name="list" size={28} color={p.upNext.length ? A : T.text} />
          </Pressable>
        </View>
        <View style={{ marginTop: 20, alignItems: 'center' }}>
          <Animated.View style={{ transform: [{ scale: sc }] }}>
            <Art track={track} size={320} />
          </Animated.View>
        </View>
        <View style={{ marginTop: 28 }}>
          <Text style={S.fullTitle} numberOfLines={1}>{track.title}</Text>
          <Text style={S.fullArtist} numberOfLines={1}>{track.artist}</Text>
        </View>
        <Pressable
          style={{ marginTop: 22, paddingVertical: 8 }}
          onLayout={(e) => (barW.current = e.nativeEvent.layout.width)}
          onPress={(e) => p.onSeek((e.nativeEvent.locationX / barW.current) * dur)}
        >
          <View style={S.bar}>
            <View style={{ width: `${Math.min((p.pos / dur) * 100, 100)}%`, height: 4, borderRadius: 2, backgroundColor: A }} />
          </View>
        </Pressable>
        <View style={S.times}>
          <Text style={S.timeTxt}>{fmt(p.pos)}</Text>
          <Text style={S.timeTxt}>-{fmt(Math.max(dur - p.pos, 0))}</Text>
        </View>
        <View style={S.controls}>
          <Pressable onPress={p.onShuffle} hitSlop={10} accessibilityLabel="Перемешать">
            <Ionicons name="shuffle" size={26} color={p.shuffle ? A : T.muted} />
          </Pressable>
          <Pressable onPress={p.onPrev} hitSlop={10} accessibilityLabel="Назад">
            <Ionicons name="play-skip-back" size={34} color={T.text} />
          </Pressable>
          <Press onPress={p.onToggle} style={S.playBtn} label="Играть или пауза">
            <Ionicons name={p.playing ? 'pause' : 'play'} size={34} color={OA} />
          </Press>
          <Pressable onPress={p.onNext} hitSlop={10} accessibilityLabel="Дальше">
            <Ionicons name="play-skip-forward" size={34} color={T.text} />
          </Pressable>
          <Pressable onPress={p.onRepeat} hitSlop={10} accessibilityLabel="Повтор">
            <Ionicons name="repeat" size={26} color={p.repeat === 'off' ? T.muted : A} />
            {p.repeat === 'one' && <Text style={{ position: 'absolute', right: -2, top: -4, color: A, fontSize: 11, fontWeight: '800' }}>1</Text>}
          </Pressable>
        </View>
        <Sheet
          visible={showQ} onClose={() => setShowQ(false)} title="Играть следующим"
          subtitle={p.upNext.length ? `В очереди: ${tracksWord(p.upNext.length)}` : undefined}
          note={p.upNext.length ? undefined : 'Очередь пуста. В меню трека (три точки) выберите «Играть следующим».'}
          actions={qActions}
        />
      </SafeAreaView>
    </Modal>
  );
}

function Chips({ items, value, onChange }) {
  const { S } = useUI();
  return (
    <View style={S.chips}>
      {items.map(([k, label]) => (
        <Pressable key={k} onPress={() => onChange(k)} style={[S.chip, value === k && S.chipOn]}>
          <Text style={[S.chipTxt, value === k && S.chipTxtOn]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function WeatherCard({ kind, weather, city, onPress }) {
  const { S, T } = useUI();
  if (!kind) return null;
  const isDay = weather ? weather.isDay : true;
  return (
    <Pressable onPress={onPress} style={{ marginHorizontal: 20, marginBottom: 8 }}>
      <Glass radius={22} style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Ionicons name={kindIcon(kind, isDay)} size={34} color={T.text} />
        <View style={{ flex: 1 }}>
          <Text style={[S.title, { fontSize: 16 }]}>{KINDS[kind]}{weather ? ` · ${weather.temp}°` : ''}</Text>
          {!!city && <Text style={S.sub}>{city}</Text>}
        </View>
      </Glass>
    </Pressable>
  );
}

function WeatherTab({ kind, weather, cfg, setCfg, status, onFind, onRefresh, pad }) {
  const { S, A, T } = useUI();
  const [city, setCity] = useState(cfg.geo ? cfg.geo.name : '');
  const isDay = weather ? weather.isDay : true;
  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: pad }} keyboardShouldPersistTaps="handled">
      <View style={{ marginHorizontal: 20, marginTop: 4 }}>
        <Glass radius={28} style={{ padding: 22, alignItems: 'center', gap: 6 }}>
          <Ionicons name={kind ? kindIcon(kind, isDay) : 'cloud-offline-outline'} size={64} color={T.text} />
          <Text style={{ color: T.text, fontSize: 48, fontWeight: '800', letterSpacing: -1 }}>
            {weather && cfg.wMode === 'auto' ? `${weather.temp}°` : '—'}
          </Text>
          <Text style={{ color: T.text, fontSize: 18, fontWeight: '700' }}>{kind ? KINDS[kind] : 'Эффекты выключены'}</Text>
          {cfg.wMode === 'auto' && cfg.geo && <Text style={S.sub}>{cfg.geo.name}</Text>}
        </Glass>
      </View>

      <Text style={S.sec}>РЕЖИМ</Text>
      <Chips
        items={[['auto', 'Авто'], ['off', 'Выкл'], ...Object.entries(KINDS)]}
        value={cfg.wMode} onChange={(v) => set('wMode', v)}
      />
      <Text style={S.note}>
        «Авто» берёт настоящую погоду для вашего города. Остальные режимы просто включают эффект, например дождь или снег, независимо от реальной погоды.
      </Text>

      <Text style={S.sec}>ГОРОД</Text>
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20 }}>
        <View style={[S.search, { flex: 1, marginHorizontal: 0, marginBottom: 0 }]}>
          <Ionicons name="location-outline" size={20} color={T.muted} />
          <TextInput value={city} onChangeText={setCity} placeholder="Например, Бишкек" placeholderTextColor={T.muted}
            style={S.input} autoCorrect={false} returnKeyType="search" onSubmitEditing={() => onFind(city)} />
        </View>
        <Pressable onPress={() => onFind(city)} style={S.addBtn}><Text style={S.addTxt}>Найти</Text></Pressable>
      </View>
      {!!status && <Text style={S.note}>{status}</Text>}
      <Pressable onPress={onRefresh} style={[S.danger, { marginTop: 14 }]}>
        <Text style={[S.dangerTxt, { color: T.text }]}>Обновить погоду</Text>
      </Pressable>

      <Text style={S.sec}>ВИД</Text>
      <View style={S.setRow}>
        <Text style={S.setTxt}>Эффекты поверх экрана</Text>
        <Switch value={cfg.fx} onValueChange={(v) => set('fx', v)} trackColor={{ true: A }} />
      </View>
      <View style={S.setRow}>
        <Text style={S.setTxt}>Карточка погоды в библиотеке</Text>
        <Switch value={cfg.card} onValueChange={(v) => set('card', v)} trackColor={{ true: A }} />
      </View>
    </ScrollView>
  );
}

function Settings({ onClear, pad }) {
  const { S, A, cfg, setCfg } = useUI();
  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: pad }}>
      <Text style={S.sec}>ТЕМА</Text>
      <Chips items={Object.entries(THEMES).map(([k, t]) => [k, t.name])} value={cfg.theme} onChange={(v) => set('theme', v)} />
      <Text style={S.sec}>ЦВЕТ АКЦЕНТА</Text>
      <View style={S.swatches}>
        {ACCENTS.map((c) => (
          <Pressable key={c} onPress={() => set('accent', c)} style={[S.sw, { backgroundColor: c }]} accessibilityLabel={`Цвет ${c}`}>
            {cfg.accent === c && <Ionicons name="checkmark" size={22} color={onColor(c)} />}
          </Pressable>
        ))}
      </View>
      <Text style={S.note}>В тёмных темах чёрный акцент автоматически становится белым, чтобы был виден.</Text>
      <Text style={S.sec}>ОБЛОЖКИ</Text>
      <Chips items={Object.entries(SHAPES)} value={cfg.shape} onChange={(v) => set('shape', v)} />
      <View style={[S.setRow, { marginTop: 8 }]}>
        <Text style={S.setTxt}>Буква на обложке</Text>
        <Switch value={cfg.letter} onValueChange={(v) => set('letter', v)} trackColor={{ true: A }} />
      </View>
      <Text style={S.sec}>СПИСОК</Text>
      <View style={S.setRow}>
        <Text style={S.setTxt}>Компактные строки</Text>
        <Switch value={cfg.compact} onValueChange={(v) => set('compact', v)} trackColor={{ true: A }} />
      </View>
      <View style={{ height: 8 }} />
      <Chips items={[['new', 'Сначала новые'], ['name', 'По названию']]} value={cfg.sort} onChange={(v) => set('sort', v)} />
      <Text style={S.note}>
        Совет: называйте файлы «Исполнитель - Название.mp3», тогда данные подставятся сами.
        Меню трека (три точки или долгое нажатие): очередь, плейлисты, своя обложка, удаление.
        {'\n\n'}Стекло: {LiquidGlass ? 'включён Liquid Glass iOS' : Blur ? 'размытие (Liquid Glass недоступен на этом устройстве или не установлен)' : 'простой вид (пакеты expo-blur и expo-glass-effect не найдены)'}.
      </Text>
      <Pressable style={S.danger} onPress={onClear}>
        <Text style={S.dangerTxt}>Очистить библиотеку</Text>
      </Pressable>
    </ScrollView>
  );
}

// ---------- Приложение ----------
function Main() {
  const insets = useSafeAreaInsets();
  const [cfg, setCfg] = useState(DEFAULTS);
  const [tracks, setTracks] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('library');
  const [view, setView] = useState('all');
  const [openPl, setOpenPl] = useState(null);
  const [query, setQuery] = useState('');
  const [queue, setQueue] = useState([]);
  const [upNext, setUpNext] = useState([]);
  const [curId, setCurId] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [durNow, setDurNow] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [full, setFull] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [weather, setWeather] = useState(null);
  const [wStatus, setWStatus] = useState('');

  const player = useRef(null);
  const endRef = useRef(() => {});
  const qIdx = useRef(-1);

  const T = THEMES[cfg.theme] || THEMES.light;
  const A = effAccent(cfg.accent, T);
  const OA = onColor(A);
  const S = useMemo(() => makeStyles(T, A, OA), [cfg.theme, cfg.accent]);
  const ui = useMemo(() => ({ T, A, OA, S, cfg, setCfg }), [T, A, OA, S, cfg]);

  const kind = cfg.wMode === 'off' ? null : cfg.wMode === 'auto' ? (weather ? weather.kind : null) : cfg.wMode;
  const isDay = cfg.wMode === 'auto' && weather ? weather.isDay : true;
  const tint = kind ? (kind === 'clear' && !isDay ? '#1B2550' : TINTS[kind]) : null;

  const cur = tracks.find((t) => t.id === curId) || null;
  const plOpen = playlists.find((p) => p.id === openPl) || null;

  useEffect(() => {
    (async () => {
      try {
        const [t, c, p] = await Promise.all([AsyncStorage.getItem(K_TRACKS), AsyncStorage.getItem(K_CFG), AsyncStorage.getItem(K_PL)]);
        if (t) setTracks(JSON.parse(t));
        if (c) setCfg({ ...DEFAULTS, ...JSON.parse(c) });
        if (p) setPlaylists(JSON.parse(p));
      } catch (e) {}
      setReady(true);
    })();
  }, []);
  useEffect(() => { if (ready) AsyncStorage.setItem(K_TRACKS, JSON.stringify(tracks)).catch(() => {}); }, [tracks, ready]);
  useEffect(() => { if (ready) AsyncStorage.setItem(K_CFG, JSON.stringify(cfg)).catch(() => {}); }, [cfg, ready]);
  useEffect(() => { if (ready) AsyncStorage.setItem(K_PL, JSON.stringify(playlists)).catch(() => {}); }, [playlists, ready]);

  // погода
  const refreshWeather = async () => {
    if (!cfg.geo) { setWStatus('Укажите город и нажмите «Найти».'); return; }
    try {
      setWStatus('Обновляю…');
      setWeather(await fetchWeather(cfg.geo));
      setWStatus('');
    } catch (e) { setWStatus(`Не удалось получить погоду: ${String(e.message || e)}`); }
  };
  useEffect(() => {
    if (!ready || cfg.wMode !== 'auto' || !cfg.geo) return;
    refreshWeather();
    const id = setInterval(refreshWeather, 20 * 60 * 1000);
    return () => clearInterval(id);
  }, [ready, cfg.wMode, cfg.geo]);
  const findCity = async (name) => {
    const n = (name || '').trim();
    if (!n) return;
    try {
      setWStatus('Ищу город…');
      const g = await geocode(n);
      if (!g) { setWStatus('Город не найден. Попробуйте написать иначе.'); return; }
      setCfg((c) => ({ ...c, geo: g, wMode: 'auto' }));
      setWStatus('');
    } catch (e) { setWStatus(`Ошибка поиска: ${String(e.message || e)}`); }
  };

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true }).catch(() => {});
    const p = createAudioPlayer();
    player.current = p;
    const sub = p.addListener('playbackStatusUpdate', (st) => {
      setPlaying(!!st.playing);
      setPos(st.currentTime || 0);
      if (st.duration > 0) setDurNow(st.duration);
      if (st.didJustFinish) endRef.current();
    });
    return () => { sub?.remove?.(); p.remove?.(); };
  }, []);

  useEffect(() => {
    if (cur && durNow > 0 && !cur.dur) {
      setTracks((ts) => ts.map((t) => (t.id === cur.id ? { ...t, dur: Math.round(durNow) } : t)));
    }
  }, [durNow, curId]);

  // ----- импорт -----
  const importFiles = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['audio/*'], multiple: true, copyToCacheDirectory: true });
      if (res.canceled) return;
      await FS.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
      const added = [];
      for (const a of res.assets) {
        const ext = (a.name.match(/\.[^.]+$/) || ['.mp3'])[0].toLowerCase();
        const id = uid();
        const file = id + ext;
        await FS.copyAsync({ from: a.uri, to: DIR + file });
        const { title, artist } = parseName(a.name);
        added.push({ id, file, title, artist, dur: 0 });
      }
      setTracks((t) => [...added, ...t]);
    } catch (e) { Alert.alert('Не удалось добавить', String(e.message || e)); }
  };

  // ----- воспроизведение -----
  const play = (track, list) => {
    setQueue(list);
    const i = list.findIndex((x) => x.id === track.id);
    if (i >= 0) qIdx.current = i;
    setCurId(track.id); setPos(0); setDurNow(track.dur || 0);
    try {
      player.current.replace({ uri: DIR + track.file });
      player.current.play();
      player.current.setActiveForLockScreen?.(true, {
        title: track.title, artist: track.artist,
        ...(track.cover ? { artworkUrl: COVERS + track.cover } : {}),
      });
    } catch (e) { Alert.alert('Ошибка воспроизведения', String(e.message || e)); }
  };
  const step = (d, auto) => {
    if (d > 0 && upNext.length) {
      const nid = upNext[0];
      setUpNext((u) => u.slice(1));
      const t = tracks.find((x) => x.id === nid);
      if (t) { play(t, queue); return; }
    }
    if (queue.length === 0) return;
    const i = qIdx.current;
    let j;
    if (shuffle && d > 0 && queue.length > 1) {
      do { j = Math.floor(Math.random() * queue.length); } while (j === i);
    } else {
      j = i + d;
      if (j >= queue.length) {
        if (repeat === 'all' || !auto) j = 0;
        else { player.current.pause(); return; }
      }
      if (j < 0) j = queue.length - 1;
    }
    play(queue[j], queue);
  };
  endRef.current = () => {
    if (repeat === 'one') { player.current.seekTo(0); player.current.play(); }
    else step(1, true);
  };
  const prev = () => (pos > 3 ? player.current.seekTo(0) : step(-1, false));
  const toggle = () => (playing ? player.current.pause() : player.current.play());
  const seek = (v) => player.current.seekTo(Math.max(0, v));
  const cycleRepeat = () => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'));

  // ----- очередь -----
  const queueNext = (t) => setUpNext((u) => [t.id, ...u.filter((x) => x !== t.id)]);
  const queueEnd = (t) => setUpNext((u) => [...u.filter((x) => x !== t.id), t.id]);

  // ----- плейлисты -----
  const askName = (title, def, cb) => {
    if (Platform.OS === 'ios') {
      Alert.prompt(title, '', [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Готово', onPress: (v) => { if (v && v.trim()) cb(v.trim()); } },
      ], 'plain-text', def);
    } else cb(def || `Плейлист ${playlists.length + 1}`);
  };
  const createPlaylist = (trackId) => askName('Новый плейлист', '', (name) =>
    setPlaylists((ps) => [{ id: uid(), name, ids: trackId ? [trackId] : [] }, ...ps]));
  const addToPlaylist = (plId, trackId) =>
    setPlaylists((ps) => ps.map((p) => (p.id === plId && !p.ids.includes(trackId) ? { ...p, ids: [...p.ids, trackId] } : p)));
  const removeFromPlaylist = (plId, trackId) =>
    setPlaylists((ps) => ps.map((p) => (p.id === plId ? { ...p, ids: p.ids.filter((x) => x !== trackId) } : p)));
  const renamePlaylist = (pl) => askName('Название плейлиста', pl.name, (name) =>
    setPlaylists((ps) => ps.map((p) => (p.id === pl.id ? { ...p, name } : p))));
  const deletePlaylist = (pl) => Alert.alert('Удалить плейлист?', `«${pl.name}» (треки останутся в библиотеке)`, [
    { text: 'Отмена', style: 'cancel' },
    { text: 'Удалить', style: 'destructive', onPress: () => { setPlaylists((ps) => ps.filter((p) => p.id !== pl.id)); setOpenPl(null); } },
  ]);

  // ----- обложка и удаление -----
  const later = (fn) => { setSheet(null); setTimeout(fn, 400); };
  const pickCover = async (t) => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      if (res.canceled) return;
      const a = res.assets[0];
      await FS.makeDirectoryAsync(COVERS, { intermediates: true }).catch(() => {});
      const ext = (a.uri.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0].toLowerCase();
      const file = `${t.id}-${Date.now()}${ext}`;
      await FS.copyAsync({ from: a.uri, to: COVERS + file });
      if (t.cover) await FS.deleteAsync(COVERS + t.cover, { idempotent: true }).catch(() => {});
      setTracks((ts) => ts.map((x) => (x.id === t.id ? { ...x, cover: file } : x)));
    } catch (e) { Alert.alert('Не удалось выбрать обложку', String(e.message || e)); }
  };
  const clearCover = async (t) => {
    if (t.cover) await FS.deleteAsync(COVERS + t.cover, { idempotent: true }).catch(() => {});
    setTracks((ts) => ts.map((x) => (x.id === t.id ? { ...x, cover: undefined } : x)));
  };
  const removeTrack = (t) => Alert.alert('Удалить трек?', `${t.artist} — ${t.title}`, [
    { text: 'Отмена', style: 'cancel' },
    {
      text: 'Удалить', style: 'destructive', onPress: async () => {
        if (curId === t.id) { player.current.pause(); setCurId(null); }
        await FS.deleteAsync(DIR + t.file, { idempotent: true }).catch(() => {});
        if (t.cover) await FS.deleteAsync(COVERS + t.cover, { idempotent: true }).catch(() => {});
        setTracks((ts) => ts.filter((x) => x.id !== t.id));
        setPlaylists((ps) => ps.map((p) => ({ ...p, ids: p.ids.filter((x) => x !== t.id) })));
        setUpNext((u) => u.filter((x) => x !== t.id));
      },
    },
  ]);
  const clearAll = () => Alert.alert('Очистить библиотеку?', 'Все треки, обложки и плейлисты будут удалены.', [
    { text: 'Отмена', style: 'cancel' },
    {
      text: 'Очистить', style: 'destructive', onPress: async () => {
        player.current.pause(); setCurId(null); setUpNext([]);
        await FS.deleteAsync(DIR, { idempotent: true }).catch(() => {});
        await FS.deleteAsync(COVERS, { idempotent: true }).catch(() => {});
        setTracks([]); setPlaylists([]); setOpenPl(null);
      },
    },
  ]);

  // ----- списки -----
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let l = q ? tracks.filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(q)) : tracks;
    if (cfg.sort === 'name') l = [...l].sort((a, b) => a.title.localeCompare(b.title));
    return l;
  }, [tracks, query, cfg.sort]);
  const plTracks = plOpen ? plOpen.ids.map((id) => tracks.find((t) => t.id === id)).filter(Boolean) : [];
  const upNextTracks = upNext.map((id) => tracks.find((t) => t.id === id)).filter(Boolean);
  const pad = (cur ? 80 : 0) + 64 + 10 + Math.max(insets.bottom, 10) + 24;

  // ----- меню -----
  let sheetEl = null;
  if (sheet?.type === 'track') {
    const t = tracks.find((x) => x.id === sheet.id);
    if (t) {
      const acts = [
        { icon: 'play-forward-outline', label: 'Играть следующим', onPress: () => { queueNext(t); setSheet(null); } },
        { icon: 'list-outline', label: 'В конец очереди', onPress: () => { queueEnd(t); setSheet(null); } },
        { icon: 'albums-outline', label: 'Добавить в плейлист', onPress: () => setSheet({ type: 'pick', id: t.id }) },
      ];
      if (plOpen) acts.push({ icon: 'remove-circle-outline', label: 'Убрать из этого плейлиста', onPress: () => { removeFromPlaylist(plOpen.id, t.id); setSheet(null); } });
      acts.push({ icon: 'image-outline', label: t.cover ? 'Сменить обложку' : 'Своя обложка', onPress: () => later(() => pickCover(t)) });
      if (t.cover) acts.push({ icon: 'close-circle-outline', label: 'Убрать обложку', onPress: () => { clearCover(t); setSheet(null); } });
      acts.push({ icon: 'trash-outline', label: 'Удалить из библиотеки', danger: true, onPress: () => later(() => removeTrack(t)) });
      sheetEl = <Sheet visible title={t.title} subtitle={t.artist} actions={acts} onClose={() => setSheet(null)} />;
    }
  } else if (sheet?.type === 'pick') {
    const t = tracks.find((x) => x.id === sheet.id);
    const acts = [
      { icon: 'add-circle-outline', label: 'Новый плейлист…', onPress: () => later(() => createPlaylist(sheet.id)) },
      ...playlists.map((p) => ({
        icon: p.ids.includes(sheet.id) ? 'checkmark-circle' : 'musical-notes-outline',
        label: `${p.name} · ${tracksWord(p.ids.length)}`,
        onPress: () => { addToPlaylist(p.id, sheet.id); setSheet(null); },
      })),
    ];
    sheetEl = <Sheet visible title="Добавить в плейлист" subtitle={t?.title} actions={acts} onClose={() => setSheet(null)} />;
  } else if (sheet?.type === 'plmenu' && plOpen) {
    sheetEl = (
      <Sheet visible title={plOpen.name} subtitle={tracksWord(plOpen.ids.length)} onClose={() => setSheet(null)}
        actions={[
          { icon: 'pencil-outline', label: 'Переименовать', onPress: () => later(() => renamePlaylist(plOpen)) },
          { icon: 'trash-outline', label: 'Удалить плейлист', danger: true, onPress: () => later(() => deletePlaylist(plOpen)) },
        ]} />
    );
  }

  const weatherHeader = cfg.card && kind ? (
    <WeatherCard kind={kind} weather={cfg.wMode === 'auto' ? weather : null} city={cfg.wMode === 'auto' && cfg.geo ? cfg.geo.name : ''} onPress={() => setTab('weather')} />
  ) : null;

  const renderTracks = (data, emptyTitle, emptyText, header) => (
    <FlatList
      data={data}
      keyExtractor={(t) => t.id}
      extraData={[curId, playing, cfg]}
      contentContainerStyle={{ paddingBottom: pad }}
      ListHeaderComponent={header}
      renderItem={({ item, index }) => (
        <TrackRow track={item} index={index} active={item.id === curId} playing={playing}
          onPlay={(t) => play(t, data)} onMore={(t) => setSheet({ type: 'track', id: t.id })} />
      )}
      ListEmptyComponent={ready ? (
        <View style={S.empty}>
          <Ionicons name="musical-notes-outline" size={56} color={T.muted} />
          <Text style={S.emptyH}>{emptyTitle}</Text>
          {!!emptyText && <Text style={S.emptyP}>{emptyText}</Text>}
        </View>
      ) : null}
    />
  );

  const tabs = [
    { key: 'library', label: 'Библиотека', icon: 'albums' },
    { key: 'weather', label: 'Погода', icon: 'partly-sunny' },
    { key: 'settings', label: 'Вид', icon: 'color-palette' },
  ];
  const titles = { library: 'Библиотека', weather: 'Погода', settings: 'Вид' };

  return (
    <Ctx.Provider value={ui}>
      <View style={{ flex: 1, backgroundColor: T.bg, paddingTop: insets.top }}>
        <StatusBar style={T.status} />
        {tint && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tint, opacity: 0.16 }]} />}

        <View style={S.head}>
          {tab === 'library' && openPl ? (
            <Pressable onPress={() => setOpenPl(null)} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
              <Ionicons name="chevron-back" size={28} color={A} />
              <View style={{ flex: 1 }}>
                <Text style={[S.h1, { fontSize: 26 }]} numberOfLines={1}>{plOpen?.name}</Text>
                <Text style={S.count}>{tracksWord(plTracks.length)}</Text>
              </View>
            </Pressable>
          ) : (
            <View>
              <Text style={S.h1}>{titles[tab]}</Text>
              {tab === 'library' && <Text style={S.count}>{tracksWord(tracks.length)}</Text>}
            </View>
          )}
          {tab === 'library' && openPl && (
            <Pressable onPress={() => setSheet({ type: 'plmenu' })} style={S.iconBtn} accessibilityLabel="Меню плейлиста">
              <Ionicons name="ellipsis-horizontal" size={22} color={T.text} />
            </Pressable>
          )}
          {tab === 'library' && !openPl && view === 'all' && (
            <Pressable onPress={importFiles} style={S.addBtn} accessibilityLabel="Добавить треки">
              <Ionicons name="add" size={20} color={OA} />
              <Text style={S.addTxt}>Добавить</Text>
            </Pressable>
          )}
          {tab === 'library' && !openPl && view === 'lists' && (
            <Pressable onPress={() => createPlaylist(null)} style={S.addBtn} accessibilityLabel="Новый плейлист">
              <Ionicons name="add" size={20} color={OA} />
              <Text style={S.addTxt}>Плейлист</Text>
            </Pressable>
          )}
        </View>

        {tab === 'library' && (
          <>
            {!openPl && (
              <View style={{ marginTop: 6, marginBottom: 10 }}>
                <Chips items={[['all', 'Все треки'], ['lists', 'Плейлисты']]} value={view} onChange={setView} />
              </View>
            )}
            {!openPl && view === 'all' && tracks.length > 0 && (
              <View style={S.search}>
                <Ionicons name="search-outline" size={20} color={T.muted} />
                <TextInput value={query} onChangeText={setQuery} placeholder="Поиск по библиотеке"
                  placeholderTextColor={T.muted} style={S.input} autoCorrect={false} />
              </View>
            )}
            {openPl ? (
              renderTracks(plTracks, 'Плейлист пуст', 'Откройте меню трека (три точки) и выберите «Добавить в плейлист».',
                plTracks.length > 0 ? (
                  <Press onPress={() => play(plTracks[0], plTracks)} style={S.playAll} label="Воспроизвести плейлист">
                    <Ionicons name="play" size={20} color={OA} />
                    <Text style={S.addTxt}>Воспроизвести</Text>
                  </Press>
                ) : null)
            ) : view === 'all' ? (
              renderTracks(list, tracks.length ? 'Ничего не найдено' : 'Добавьте свою музыку',
                tracks.length ? '' : 'Нажмите «Добавить» и выберите MP3 или M4A из приложения «Файлы».', weatherHeader)
            ) : (
              <FlatList
                data={playlists}
                keyExtractor={(p) => p.id}
                contentContainerStyle={{ paddingBottom: pad }}
                renderItem={({ item, index }) => {
                  const first = tracks.find((t) => t.id === item.ids[0]);
                  return (
                    <FadeIn index={index}>
                      <Pressable onPress={() => setOpenPl(item.id)} style={[S.row, { paddingVertical: 8, paddingRight: 20 }]}>
                        {first ? <Art track={first} size={52} /> : (
                          <View style={[S.plTile, { width: 52, height: 52, borderRadius: cfg.shape === 'circle' ? 26 : cfg.shape === 'square' ? 0 : 10 }]}>
                            <Ionicons name="musical-notes-outline" size={24} color={T.muted} />
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={S.title} numberOfLines={1}>{item.name}</Text>
                          <Text style={S.sub}>{tracksWord(item.ids.length)}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={T.muted} />
                      </Pressable>
                    </FadeIn>
                  );
                }}
                ListEmptyComponent={ready ? (
                  <View style={S.empty}>
                    <Ionicons name="albums-outline" size={56} color={T.muted} />
                    <Text style={S.emptyH}>Плейлистов пока нет</Text>
                    <Text style={S.emptyP}>Нажмите «Плейлист», чтобы создать первый.</Text>
                  </View>
                ) : null}
              />
            )}
          </>
        )}
        {tab === 'weather' && (
          <WeatherTab kind={kind} weather={weather} cfg={cfg} setCfg={setCfg} status={wStatus}
            onFind={findCity} onRefresh={refreshWeather} pad={pad} />
        )}
        {tab === 'settings' && <Settings onClear={clearAll} pad={pad} />}

        <WeatherFX kind={cfg.fx ? kind : null} isDay={isDay} dark={T.dark} />

        {/* плавающее стекло снизу: мини-плеер и панель вкладок */}
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(insets.bottom, 10) }}>
          <MiniPlayer track={cur} playing={playing} pos={pos} dur={durNow || cur?.dur}
            onToggle={toggle} onNext={() => step(1, false)} onOpen={() => setFull(true)} />
          <Glass radius={34} style={{ marginHorizontal: 24, height: 64 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, gap: 4 }}>
              {tabs.map((t) => {
                const on = tab === t.key;
                return (
                  <Pressable key={t.key} onPress={() => setTab(t.key)} style={[S.tab, on && S.tabOn]} accessibilityLabel={t.label}>
                    <Ionicons name={on ? t.icon : `${t.icon}-outline`} size={22} color={on ? A : T.muted} />
                    <Text style={[S.tabTxt, on && { color: A }]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Glass>
        </View>

        {sheetEl}

        <FullPlayer
          visible={full} track={cur} playing={playing} pos={pos} dur={durNow || cur?.dur}
          shuffle={shuffle} repeat={repeat} upNext={upNextTracks}
          kind={kind} isDay={isDay} fx={cfg.fx} tint={tint}
          onClose={() => setFull(false)} onToggle={toggle}
          onNext={() => step(1, false)} onPrev={prev} onSeek={seek}
          onShuffle={() => setShuffle((s) => !s)} onRepeat={cycleRepeat}
          onClearQueue={() => setUpNext([])}
          onRemoveQueue={(id) => setUpNext((u) => u.filter((x) => x !== id))}
        />
      </View>
    </Ctx.Provider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}
