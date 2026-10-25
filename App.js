import React, { useState, useEffect, useRef, useMemo, useContext, createContext } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, Modal, ScrollView, Alert, Switch,
  Animated, Easing, AccessibilityInfo,
  StyleSheet, Platform, StatusBar as RNStatusBar,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';

// expo-file-system: в новых версиях Expo старый API лежит в /legacy
let FS;
try { FS = require('expo-file-system/legacy'); } catch (e) { FS = require('expo-file-system'); }

// ---------- Настройки по умолчанию и темы ----------
const ACCENTS = ['#9C99FF', '#FF6B8A', '#FFB020', '#2DD36F', '#4FC3F7', '#FF7A2F'];
const THEMES = {
  dark:   { name: 'Тёмная', bg: '#0F1013', surface: '#1B1C22', surface2: '#24252D', text: '#F2F1EE', muted: '#A3A3AD', line: '#1E1F26', bar: '#2A2B33', status: 'light' },
  amoled: { name: 'AMOLED', bg: '#000000', surface: '#111114', surface2: '#1A1A1E', text: '#F2F1EE', muted: '#A3A3AD', line: '#1A1A1E', bar: '#26262B', status: 'light' },
  light:  { name: 'Светлая', bg: '#F6F5F2', surface: '#FFFFFF', surface2: '#ECEBE7', text: '#16161A', muted: '#6B6B76', line: '#E2E1DC', bar: '#D9D8D3', status: 'dark' },
};
const SHAPES = { round: 'Скруглённые', circle: 'Круглые', square: 'Квадратные' };
const DEFAULTS = { theme: 'dark', accent: ACCENTS[0], shape: 'round', compact: false, letter: true, sort: 'new' };
const ART = ['#6B4FC4', '#2E9C8F', '#D98A2B', '#3F5E94', '#B34FB3', '#6E9A2E', '#C2506B', '#4A8FA8'];

const DIR = (FS.documentDirectory || '') + 'tracks/';
const K_TRACKS = 'mp:tracks';
const K_CFG = 'mp:cfg';
const top = Platform.OS === 'android' ? RNStatusBar.currentHeight || 0 : 0;

const fmt = (s) => {
  if (!s || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

function parseName(file) {
  const base = file.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const i = base.indexOf(' - ');
  if (i > 0) return { artist: base.slice(0, i).trim(), title: base.slice(i + 3).trim() || base };
  return { artist: 'Неизвестный исполнитель', title: base || 'Без названия' };
}
const hash = (str) => { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

// ---------- Контекст темы ----------
const Ctx = createContext(null);
const useUI = () => useContext(Ctx);

// ---------- Анимации ----------
// если в iOS включено «Уменьшение движения», анимации отключаются
let REDUCE = false;
AccessibilityInfo.isReduceMotionEnabled().then((v) => { REDUCE = v; }).catch(() => {});

function Press({ children, onPress, style, label }) {
  const sc = useRef(new Animated.Value(1)).current;
  const to = (v) => {
    if (!REDUCE) Animated.spring(sc, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  };
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} onPressIn={() => to(0.9)} onPressOut={() => to(1)}>
      <Animated.View style={[style, { transform: [{ scale: sc }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

function FadeIn({ index = 0, children }) {
  const v = useRef(new Animated.Value(REDUCE ? 1 : 0)).current;
  useEffect(() => {
    if (REDUCE) return;
    Animated.timing(v, {
      toValue: 1, duration: 320, delay: Math.min(index, 8) * 40,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
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
    const loops = vals.map((v, i) =>
      Animated.loop(Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 360 + i * 120, useNativeDriver: false }),
        Animated.timing(v, { toValue: 0.25, duration: 360 + i * 120, useNativeDriver: false }),
      ]))
    );
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

function makeStyles(T, A) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: T.bg },
    head: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    h1: { color: T.text, fontSize: 32, fontWeight: '800', letterSpacing: -0.6 },
    count: { color: T.muted, fontSize: 13, fontWeight: '600' },
    addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: A, paddingHorizontal: 14, minHeight: 40, borderRadius: 20 },
    addTxt: { color: T.bg, fontSize: 14, fontWeight: '700' },
    search: { marginHorizontal: 20, marginTop: 8, marginBottom: 8, height: 46, borderRadius: 12, backgroundColor: T.surface, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
    input: { flex: 1, color: T.text, fontSize: 16, fontWeight: '500' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20 },
    title: { color: T.text, fontSize: 15, fontWeight: '600' },
    sub: { color: T.muted, fontSize: 13, marginTop: 2 },
    empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 36, gap: 12 },
    emptyH: { color: T.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
    emptyP: { color: T.muted, fontSize: 15, textAlign: 'center', lineHeight: 21 },
    mini: { marginHorizontal: 8, marginBottom: 6, backgroundColor: T.surface2, borderRadius: 14, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 12, overflow: 'hidden' },
    miniBar: { position: 'absolute', left: 12, right: 12, bottom: 0, height: 2, backgroundColor: T.bar },
    tabbar: { flexDirection: 'row', backgroundColor: T.bg, borderTopWidth: 1, borderTopColor: T.line, paddingBottom: 6 },
    tab: { flex: 1, alignItems: 'center', gap: 4, paddingTop: 10, paddingBottom: 4 },
    tabTxt: { color: T.muted, fontSize: 11, fontWeight: '600' },
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
    chip: { paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: 999, backgroundColor: T.surface },
    chipOn: { backgroundColor: A },
    chipTxt: { color: T.text, fontSize: 14, fontWeight: '600' },
    chipTxtOn: { color: T.bg },
    swatches: { flexDirection: 'row', gap: 14, paddingHorizontal: 20 },
    sw: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    setRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, minHeight: 48 },
    setTxt: { color: T.text, fontSize: 16, fontWeight: '500' },
    note: { color: T.muted, fontSize: 13, lineHeight: 19, marginHorizontal: 20, marginTop: 8 },
    danger: { marginHorizontal: 20, marginTop: 24, minHeight: 48, borderRadius: 12, backgroundColor: T.surface, alignItems: 'center', justifyContent: 'center' },
    dangerTxt: { color: '#FF6B6B', fontSize: 15, fontWeight: '700' },
  });
}

// ---------- Компоненты ----------
function Art({ track, size = 52 }) {
  const { cfg, T } = useUI();
  const radius = cfg.shape === 'circle' ? size / 2 : cfg.shape === 'square' ? 0 : Math.round(size * 0.16);
  const color = ART[hash(track ? track.title + track.artist : 'x') % ART.length];
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      {cfg.letter ? (
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.4 }}>
          {(track?.title || '?').trim().charAt(0).toUpperCase()}
        </Text>
      ) : (
        <Ionicons name="musical-notes" size={size * 0.4} color="#ffffffcc" />
      )}
    </View>
  );
}

function TrackRow({ track, index, active, playing, onPlay, onRemove }) {
  const { S, A, cfg } = useUI();
  const size = cfg.compact ? 40 : 52;
  return (
    <FadeIn index={index}>
    <Pressable onPress={() => onPlay(track)} onLongPress={() => onRemove(track)}
      style={[S.row, { paddingVertical: cfg.compact ? 5 : 8 }]}>
      <Art track={track} size={size} />
      <View style={{ flex: 1 }}>
        <Text style={[S.title, active && { color: A }]} numberOfLines={1}>{track.title}</Text>
        <Text style={S.sub} numberOfLines={1}>{track.artist}{track.dur ? ` · ${fmt(track.dur)}` : ''}</Text>
      </View>
      {active && <EqBars playing={playing} color={A} />}
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
    <Animated.View style={{ transform: [{ translateY: y }] }}>
    <Pressable onPress={onOpen} style={S.mini}>
      <Art track={track} size={44} />
      <View style={{ flex: 1 }}>
        <Text style={[S.title, { fontSize: 14 }]} numberOfLines={1}>{track.title}</Text>
        <Text style={S.sub} numberOfLines={1}>{track.artist}</Text>
      </View>
      <Pressable onPress={onToggle} hitSlop={8} style={{ padding: 8 }} accessibilityLabel="Играть или пауза">
        <Ionicons name={playing ? 'pause' : 'play'} size={26} color={T.text} />
      </Pressable>
      <Pressable onPress={onNext} hitSlop={8} style={{ padding: 8 }} accessibilityLabel="Следующий">
        <Ionicons name="play-skip-forward" size={24} color={T.text} />
      </Pressable>
      <View style={S.miniBar}>
        <View style={{ width: `${dur ? Math.min((pos / dur) * 100, 100) : 0}%`, height: 2, backgroundColor: A }} />
      </View>
    </Pressable>
    </Animated.View>
  );
}

function FullPlayer(p) {
  const { S, A, T } = useUI();
  const barW = useRef(1);
  const sc = useRef(new Animated.Value(p.playing ? 1 : 0.88)).current;
  useEffect(() => {
    const v = p.playing ? 1 : 0.88;
    if (REDUCE) sc.setValue(v);
    else Animated.spring(sc, { toValue: v, useNativeDriver: true, speed: 10, bounciness: 8 }).start();
  }, [p.playing]);
  const { track } = p;
  if (!track) return null;
  const dur = p.dur || 1;
  return (
    <Modal visible={p.visible} animationType="slide" onRequestClose={p.onClose}>
      <SafeAreaView style={[S.full, { paddingTop: top }]}>
        <View style={S.fullHead}>
          <Pressable onPress={p.onClose} hitSlop={12} accessibilityLabel="Свернуть">
            <Ionicons name="chevron-down" size={30} color={T.text} />
          </Pressable>
          <Text style={S.fullCap}>СЕЙЧАС ИГРАЕТ</Text>
          <View style={{ width: 30 }} />
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
            <Ionicons name={p.playing ? 'pause' : 'play'} size={34} color={T.bg} />
          </Press>
          <Pressable onPress={p.onNext} hitSlop={10} accessibilityLabel="Дальше">
            <Ionicons name="play-skip-forward" size={34} color={T.text} />
          </Pressable>
          <Pressable onPress={p.onRepeat} hitSlop={10} accessibilityLabel="Повтор">
            <Ionicons name={p.repeat === 'one' ? 'repeat' : 'repeat'} size={26} color={p.repeat === 'off' ? T.muted : A} />
            {p.repeat === 'one' && <Text style={{ position: 'absolute', right: -2, top: -4, color: A, fontSize: 11, fontWeight: '800' }}>1</Text>}
          </Pressable>
        </View>
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

function Settings({ onClear }) {
  const { S, T, A, cfg, setCfg } = useUI();
  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
      <Text style={S.sec}>ТЕМА</Text>
      <Chips items={Object.entries(THEMES).map(([k, t]) => [k, t.name])} value={cfg.theme} onChange={(v) => set('theme', v)} />

      <Text style={S.sec}>ЦВЕТ АКЦЕНТА</Text>
      <View style={S.swatches}>
        {ACCENTS.map((c) => (
          <Pressable key={c} onPress={() => set('accent', c)} style={[S.sw, { backgroundColor: c }]} accessibilityLabel={`Цвет ${c}`}>
            {cfg.accent === c && <Ionicons name="checkmark" size={22} color="#000" />}
          </Pressable>
        ))}
      </View>

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
        Совет: чтобы название и исполнитель отображались правильно, называйте файлы так: «Исполнитель - Название.mp3».
        Долгое нажатие на трек в библиотеке удаляет его.
      </Text>

      <Pressable style={S.danger} onPress={onClear}>
        <Text style={S.dangerTxt}>Очистить библиотеку</Text>
      </Pressable>
    </ScrollView>
  );
}

// ---------- Приложение ----------
function Main() {
  const [cfg, setCfg] = useState(DEFAULTS);
  const [tracks, setTracks] = useState([]);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('library');
  const [query, setQuery] = useState('');
  const [queue, setQueue] = useState([]);
  const [curId, setCurId] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [durNow, setDurNow] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off'); // off | all | one
  const [full, setFull] = useState(false);

  const player = useRef(null);
  const endRef = useRef(() => {});
  const T = THEMES[cfg.theme] || THEMES.dark;
  const A = cfg.accent;
  const S = useMemo(() => makeStyles(T, A), [cfg.theme, cfg.accent]);
  const ui = useMemo(() => ({ T, A, S, cfg, setCfg }), [T, A, S, cfg]);

  const cur = tracks.find((t) => t.id === curId) || null;

  // загрузка сохранённых данных
  useEffect(() => {
    (async () => {
      try {
        const [t, c] = await Promise.all([AsyncStorage.getItem(K_TRACKS), AsyncStorage.getItem(K_CFG)]);
        if (t) setTracks(JSON.parse(t));
        if (c) setCfg({ ...DEFAULTS, ...JSON.parse(c) });
      } catch (e) {}
      setReady(true);
    })();
  }, []);
  useEffect(() => { if (ready) AsyncStorage.setItem(K_TRACKS, JSON.stringify(tracks)).catch(() => {}); }, [tracks, ready]);
  useEffect(() => { if (ready) AsyncStorage.setItem(K_CFG, JSON.stringify(cfg)).catch(() => {}); }, [cfg, ready]);

  // плеер
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

  // запоминаем длительность трека, когда она стала известна
  useEffect(() => {
    if (cur && durNow > 0 && !cur.dur) {
      setTracks((ts) => ts.map((t) => (t.id === cur.id ? { ...t, dur: Math.round(durNow) } : t)));
    }
  }, [durNow, curId]);

  const importFiles = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['audio/*'], multiple: true, copyToCacheDirectory: true });
      if (res.canceled) return;
      await FS.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
      const added = [];
      for (const a of res.assets) {
        const ext = (a.name.match(/\.[^.]+$/) || ['.mp3'])[0].toLowerCase();
        const id = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
        const file = id + ext;
        await FS.copyAsync({ from: a.uri, to: DIR + file });
        const { title, artist } = parseName(a.name);
        added.push({ id, file, title, artist, dur: 0 });
      }
      setTracks((t) => [...added, ...t]);
    } catch (e) {
      Alert.alert('Не удалось добавить', String(e.message || e));
    }
  };

  const play = (track, list) => {
    setQueue(list); setCurId(track.id); setPos(0); setDurNow(track.dur || 0);
    try {
      player.current.replace({ uri: DIR + track.file });
      player.current.play();
      player.current.setActiveForLockScreen?.(true, { title: track.title, artist: track.artist });
    } catch (e) { Alert.alert('Ошибка воспроизведения', String(e.message || e)); }
  };

  const step = (d, auto) => {
    if (!cur || queue.length === 0) return;
    const i = queue.findIndex((t) => t.id === cur.id);
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

  const removeTrack = (t) => {
    Alert.alert('Удалить трек?', `${t.artist} — ${t.title}`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить', style: 'destructive', onPress: async () => {
          if (curId === t.id) { player.current.pause(); setCurId(null); }
          await FS.deleteAsync(DIR + t.file, { idempotent: true }).catch(() => {});
          setTracks((ts) => ts.filter((x) => x.id !== t.id));
        },
      },
    ]);
  };
  const clearAll = () => {
    Alert.alert('Очистить библиотеку?', 'Все добавленные треки будут удалены с телефона.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Очистить', style: 'destructive', onPress: async () => {
          player.current.pause(); setCurId(null);
          await FS.deleteAsync(DIR, { idempotent: true }).catch(() => {});
          setTracks([]);
        },
      },
    ]);
  };

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let l = q ? tracks.filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(q)) : tracks;
    if (cfg.sort === 'name') l = [...l].sort((a, b) => a.title.localeCompare(b.title));
    return l;
  }, [tracks, query, cfg.sort]);

  const tabs = [
    { key: 'library', label: 'Библиотека', icon: 'albums-outline' },
    { key: 'settings', label: 'Настройки', icon: 'color-palette-outline' },
  ];

  return (
    <Ctx.Provider value={ui}>
      <View style={S.root}>
        <StatusBar style={T.status} />
        <SafeAreaView style={{ flex: 1, paddingTop: top }}>
          <View style={S.head}>
            <View>
              <Text style={S.h1}>{tab === 'library' ? 'Библиотека' : 'Настройки'}</Text>
              {tab === 'library' && <Text style={S.count}>{tracks.length} треков</Text>}
            </View>
            {tab === 'library' && (
              <Pressable onPress={importFiles} style={S.addBtn} accessibilityLabel="Добавить треки">
                <Ionicons name="add" size={20} color={T.bg} />
                <Text style={S.addTxt}>Добавить</Text>
              </Pressable>
            )}
          </View>

          {tab === 'library' ? (
            <>
              {tracks.length > 0 && (
                <View style={S.search}>
                  <Ionicons name="search-outline" size={20} color={T.muted} />
                  <TextInput
                    value={query} onChangeText={setQuery}
                    placeholder="Поиск по библиотеке" placeholderTextColor={T.muted}
                    style={S.input} autoCorrect={false}
                  />
                </View>
              )}
              <FlatList
                data={list}
                keyExtractor={(t) => t.id}
                extraData={[curId, playing, cfg]}
                renderItem={({ item, index }) => (
                  <TrackRow track={item} index={index} active={item.id === curId} playing={playing}
                    onPlay={(t) => play(t, list)} onRemove={removeTrack} />
                )}
                ListEmptyComponent={
                  ready ? (
                    <View style={S.empty}>
                      <Ionicons name="musical-notes-outline" size={56} color={T.muted} />
                      <Text style={S.emptyH}>{tracks.length ? 'Ничего не найдено' : 'Добавьте свою музыку'}</Text>
                      {!tracks.length && (
                        <Text style={S.emptyP}>
                          Нажмите «Добавить» и выберите MP3 или M4A из приложения «Файлы» (iCloud Drive или память iPhone).
                        </Text>
                      )}
                    </View>
                  ) : null
                }
              />
            </>
          ) : (
            <Settings onClear={clearAll} />
          )}

          <MiniPlayer track={cur} playing={playing} pos={pos} dur={durNow || cur?.dur}
            onToggle={toggle} onNext={() => step(1, false)} onOpen={() => setFull(true)} />

          <View style={S.tabbar}>
            {tabs.map((t) => {
              const on = tab === t.key;
              return (
                <Pressable key={t.key} onPress={() => setTab(t.key)} style={S.tab}>
                  <Ionicons name={t.icon} size={24} color={on ? A : T.muted} />
                  <Text style={[S.tabTxt, on && { color: A }]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </SafeAreaView>

        <FullPlayer
          visible={full} track={cur} playing={playing} pos={pos} dur={durNow || cur?.dur}
          shuffle={shuffle} repeat={repeat}
          onClose={() => setFull(false)} onToggle={toggle}
          onNext={() => step(1, false)} onPrev={prev} onSeek={seek}
          onShuffle={() => setShuffle((s) => !s)} onRepeat={cycleRepeat}
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