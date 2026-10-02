import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useVideoPlayer, VideoView, isPictureInPictureSupported } from 'expo-video';
import type { AudioTrack, SubtitleTrack, VideoContentFit } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MediaItem } from '../movieApi';
import { colors } from '../theme';

type VideoPlayerModalProps = {
  item: MediaItem;
  source: string;
  onClose: () => void;
};

export function VideoPlayerModal({ item, source, onClose }: VideoPlayerModalProps) {
  const player = useVideoPlayer(source, (videoPlayer) => {
    videoPlayer.timeUpdateEventInterval = 0.25;
    videoPlayer.play();
  });
  const videoView = useRef<VideoView | null>(null);
  const [playing, setPlaying] = useState(player.playing);
  const [muted, setMuted] = useState(player.muted);
  const [volume, setVolume] = useState(player.volume);
  const [playbackRate, setPlaybackRate] = useState(player.playbackRate);
  const [currentTime, setCurrentTime] = useState(player.currentTime);
  const [duration, setDuration] = useState(player.duration);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>(player.availableAudioTracks);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>(player.availableSubtitleTracks);
  const [audioTrack, setAudioTrack] = useState<AudioTrack | null>(player.audioTrack);
  const [subtitleTrack, setSubtitleTrack] = useState<SubtitleTrack | null>(player.subtitleTrack);
  const [fit, setFit] = useState<VideoContentFit>('contain');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [playerError, setPlayerError] = useState('');
  const lastVolume = useRef(1);
  const supportsPiP = isPictureInPictureSupported();

  useEffect(() => {
    const playingSubscription = player.addListener('playingChange', (event) => setPlaying(event.isPlaying));
    const timeSubscription = player.addListener('timeUpdate', (event) => {
      setCurrentTime(event.currentTime);
      setDuration(player.duration);
    });
    const statusSubscription = player.addListener('statusChange', (event) => {
      setPlayerError(event.error?.message ?? '');
      setDuration(player.duration);
    });
    const sourceSubscription = player.addListener('sourceLoad', (event) => {
      setDuration(event.duration);
      setAudioTracks(event.availableAudioTracks);
      setSubtitleTracks(event.availableSubtitleTracks);
      setAudioTrack(player.audioTrack);
      setSubtitleTrack(player.subtitleTrack);
      setPlayerError('');
    });
    const audioTracksSubscription = player.addListener('availableAudioTracksChange', (event) => setAudioTracks(event.availableAudioTracks));
    const subtitleTracksSubscription = player.addListener('availableSubtitleTracksChange', (event) => setSubtitleTracks(event.availableSubtitleTracks));
    const audioSubscription = player.addListener('audioTrackChange', (event) => setAudioTrack(event.audioTrack));
    const subtitleSubscription = player.addListener('subtitleTrackChange', (event) => setSubtitleTrack(event.subtitleTrack));
    const volumeSubscription = player.addListener('volumeChange', (event) => setVolume(event.volume));
    const mutedSubscription = player.addListener('mutedChange', (event) => setMuted(event.muted));
    const rateSubscription = player.addListener('playbackRateChange', (event) => setPlaybackRate(event.playbackRate));

    return () => {
      playingSubscription.remove();
      timeSubscription.remove();
      statusSubscription.remove();
      sourceSubscription.remove();
      audioTracksSubscription.remove();
      subtitleTracksSubscription.remove();
      audioSubscription.remove();
      subtitleSubscription.remove();
      volumeSubscription.remove();
      mutedSubscription.remove();
      rateSubscription.remove();
    };
  }, [player]);

  function togglePlayback() {
    if (player.playing) player.pause();
    else player.play();
  }

  function setPlayerVolume(value: number) {
    if (value > 0) lastVolume.current = value;
    player.volume = value;
    player.muted = value === 0;
    setVolume(value);
  }

  function toggleMute() {
    if (player.muted || volume === 0) {
      player.muted = false;
      player.volume = lastVolume.current || 1;
      setMuted(false);
      setVolume(lastVolume.current || 1);
    } else {
      lastVolume.current = player.volume;
      player.muted = true;
      setMuted(true);
    }
  }

  function selectAudio(track: AudioTrack) {
    player.audioTrack = track;
    setAudioTrack(track);
  }

  function selectSubtitle(track: SubtitleTrack | null) {
    player.subtitleTrack = track;
    setSubtitleTrack(track);
  }

  const displayedTime = scrubTime ?? currentTime;
  const sliderMax = Math.max(duration, 1);
  const sliderValue = Math.min(Math.max(displayedTime, 0), sliderMax);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close player" onPress={onClose} style={styles.closeButton}>
            <Ionicons name="chevron-down" size={25} color={colors.text} />
          </Pressable>
          <Text numberOfLines={1} style={styles.heading}>{item.title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Player settings" onPress={() => setIsSettingsOpen(true)} style={styles.closeButton}>
            <Ionicons name="options-outline" size={22} color={colors.text} />
          </Pressable>
        </View>
        <View style={styles.videoFrame}>
          <VideoView
            ref={videoView}
            player={player}
            style={styles.video}
            nativeControls={false}
            contentFit={fit}
            fullscreenOptions={{ enable: true, orientation: 'landscape' }}
            allowsPictureInPicture={supportsPiP}
          />
          <View style={styles.centerControls}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back 10 seconds" onPress={() => player.seekBy(-10)} style={styles.skipButton}>
              <Ionicons name="play-back" size={24} color={colors.text} />
              <Text style={styles.skipLabel}>10</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'} onPress={togglePlayback} style={styles.playButton}>
              <Ionicons name={playing ? 'pause' : 'play'} size={30} color={colors.background} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Forward 10 seconds" onPress={() => player.seekBy(10)} style={styles.skipButton}>
              <Ionicons name="play-forward" size={24} color={colors.text} />
              <Text style={styles.skipLabel}>10</Text>
            </Pressable>
          </View>
          {player.status === 'loading' ? <ActivityIndicator color={colors.green} size="large" style={styles.loadingIndicator} /> : null}
        </View>
        <View style={styles.controlDeck}>
          {playerError ? <Text style={styles.errorText}>{playerError}</Text> : null}
          <Slider
            minimumValue={0}
            maximumValue={sliderMax}
            value={sliderValue}
            onValueChange={setScrubTime}
            onSlidingComplete={(value) => {
              player.currentTime = value;
              setCurrentTime(value);
              setScrubTime(null);
            }}
            minimumTrackTintColor={colors.green}
            maximumTrackTintColor={colors.divider}
            thumbTintColor={colors.green}
            style={styles.timeline}
            accessibilityLabel="Playback position"
          />
          <View style={styles.timeRow}>
            <Text style={styles.timeText}>{formatTime(displayedTime)}</Text>
            <Text style={styles.timeText}>{formatTime(duration)}</Text>
          </View>
          <View style={styles.controlRow}>
            <Pressable accessibilityRole="button" accessibilityLabel={muted ? 'Unmute' : 'Mute'} onPress={toggleMute} style={styles.toolButton}>
              <Ionicons name={muted || volume === 0 ? 'volume-mute' : 'volume-medium'} size={21} color={colors.text} />
            </Pressable>
            <Slider
              minimumValue={0}
              maximumValue={1}
              value={muted ? 0 : volume}
              onValueChange={setPlayerVolume}
              minimumTrackTintColor={colors.green}
              maximumTrackTintColor={colors.divider}
              thumbTintColor={colors.green}
              style={styles.volumeSlider}
              accessibilityLabel="Volume"
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Playback speed" onPress={() => setIsSettingsOpen(true)} style={styles.speedButton}>
              <Text style={styles.speedLabel}>{playbackRate}×</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Aspect ratio and tracks" onPress={() => setIsSettingsOpen(true)} style={styles.toolButton}>
              <Ionicons name="options-outline" size={21} color={colors.text} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Enter fullscreen" onPress={() => void videoView.current?.enterFullscreen()} style={styles.toolButton}>
              <Ionicons name="expand-outline" size={21} color={colors.text} />
            </Pressable>
            {supportsPiP ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Picture in picture" onPress={() => void videoView.current?.startPictureInPicture()} style={styles.toolButton}>
                <Ionicons name="albums-outline" size={21} color={colors.text} />
              </Pressable>
            ) : null}
          </View>
        </View>
        <View style={styles.metadata}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.subtitle}>{[item.year, item.type === 'movie' ? 'Movie' : 'Show'].filter(Boolean).join(' · ')}</Text>
          {item.synopsis ? <Text style={styles.synopsis}>{item.synopsis}</Text> : null}
        </View>
      </SafeAreaView>

      <Modal visible={isSettingsOpen} transparent animationType="slide" onRequestClose={() => setIsSettingsOpen(false)}>
        <View style={styles.settingsScrim}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close player settings" onPress={() => setIsSettingsOpen(false)} style={StyleSheet.absoluteFill} />
          <SafeAreaView style={styles.settingsSheet}>
            <View style={styles.settingsHeader}>
              <Text style={styles.settingsTitle}>Playback settings</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close settings" onPress={() => setIsSettingsOpen(false)} style={styles.closeButton}>
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.settingsContent}>
              <Text style={styles.sectionTitle}>Aspect ratio</Text>
              <View style={styles.optionRow}>
                {FIT_OPTIONS.map((option) => (
                  <OptionButton key={option.value} label={option.label} selected={fit === option.value} onPress={() => setFit(option.value)} />
                ))}
              </View>

              <Text style={styles.sectionTitle}>Playback speed</Text>
              <View style={styles.optionRow}>
                {PLAYBACK_RATES.map((rate) => (
                  <OptionButton key={rate} label={`${rate}×`} selected={playbackRate === rate} onPress={() => { player.playbackRate = rate; setPlaybackRate(rate); }} />
                ))}
              </View>

              <Text style={styles.sectionTitle}>Audio track</Text>
              {audioTracks.length > 0 ? audioTracks.map((track) => (
                <TrackOption key={audioTrackKey(track)} label={track.label || track.name || track.language} detail={track.language} selected={sameAudioTrack(audioTrack, track)} onPress={() => selectAudio(track)} />
              )) : <Text style={styles.unavailableText}>This stream does not expose alternate audio tracks.</Text>}

              <Text style={styles.sectionTitle}>Subtitles</Text>
              <TrackOption label="Off" selected={subtitleTrack === null} onPress={() => selectSubtitle(null)} />
              {subtitleTracks.length > 0 ? subtitleTracks.map((track) => (
                <TrackOption key={subtitleTrackKey(track)} label={track.label || track.name || track.language} detail={track.language} selected={sameSubtitleTrack(subtitleTrack, track)} onPress={() => selectSubtitle(track)} />
              )) : <Text style={styles.unavailableText}>This stream does not provide selectable subtitle tracks.</Text>}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </Modal>
  );
}

const FIT_OPTIONS: { label: string; value: VideoContentFit }[] = [
  { label: 'Original', value: 'contain' },
  { label: 'Crop', value: 'cover' },
  { label: 'Stretch', value: 'fill' },
];

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

function sameAudioTrack(left: AudioTrack | null, right: AudioTrack) {
  return !!left && audioTrackKey(left) === audioTrackKey(right);
}

function audioTrackKey(track: AudioTrack) {
  return `${track.id ?? ''}:${track.language}:${track.label}:${track.name ?? ''}`;
}

function sameSubtitleTrack(left: SubtitleTrack | null, right: SubtitleTrack) {
  return !!left && subtitleTrackKey(left) === subtitleTrackKey(right);
}

function subtitleTrackKey(track: SubtitleTrack) {
  return `${track.id ?? ''}:${track.language}:${track.label}:${track.name ?? ''}`;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function OptionButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.optionButton, selected && styles.optionButtonSelected]}>
      <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

function TrackOption({ label, detail, selected, onPress }: { label: string; detail?: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.trackOption}>
      <View style={styles.trackOptionCopy}>
        <Text numberOfLines={1} style={styles.trackOptionLabel}>{label}</Text>
        {detail ? <Text style={styles.trackOptionDetail}>{detail}</Text> : null}
      </View>
      {selected ? <Ionicons name="checkmark" size={19} color={colors.green} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: 4,
  },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  closeButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
  videoFrame: {
    width: '100%',
    aspectRatio: 16 / 9,
    position: 'relative',
    backgroundColor: '#000000',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  centerControls: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
  },
  skipButton: {
    width: 46,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipLabel: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '600',
    marginTop: -4,
  },
  playButton: {
    width: 62,
    height: 62,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 31,
    backgroundColor: colors.green,
  },
  loadingIndicator: {
    ...StyleSheet.absoluteFill,
  },
  controlDeck: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  timeline: {
    width: '100%',
    height: 28,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -3,
  },
  timeText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  controlRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
  },
  toolButton: {
    width: 36,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumeSlider: {
    flex: 1,
    height: 36,
    minWidth: 50,
  },
  speedButton: {
    minWidth: 40,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  errorText: {
    color: '#FF8080',
    fontSize: 13,
    marginBottom: 8,
  },
  metadata: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '600',
  },
  subtitle: {
    color: colors.green,
    fontSize: 13,
    marginTop: 7,
  },
  synopsis: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 14,
  },
  settingsScrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  settingsSheet: {
    maxHeight: '82%',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 18,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    backgroundColor: colors.card,
  },
  settingsHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  settingsTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '600',
  },
  settingsContent: {
    paddingBottom: 18,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 20,
    marginBottom: 10,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionButton: {
    minHeight: 38,
    minWidth: 58,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.background,
  },
  optionButtonSelected: {
    borderColor: colors.green,
    backgroundColor: colors.greenDark,
  },
  optionLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  optionLabelSelected: {
    color: colors.greenLight,
  },
  trackOption: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  trackOptionCopy: {
    flex: 1,
    paddingRight: 12,
  },
  trackOptionLabel: {
    color: colors.text,
    fontSize: 14,
  },
  trackOptionDetail: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 3,
  },
  unavailableText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    paddingVertical: 9,
  },
});