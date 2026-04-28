"use client";

import { useEffect, useReducer, useState } from "react";
import Image from "next/image";
import { PLAYLIST } from "@/lib/playlist";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────
// The YouTube player iframe is appended directly to document.body and never
// removed, so music persists across client-side Next.js navigations even if
// the React component remounts.

let _player: any = null;
let _progressTimer: ReturnType<typeof setInterval> | null = null;
const _listeners = new Set<() => void>();

const _s = {
  currentIndex: 0,
  playing: false,
  muted: true,
  volume: 25,
  shuffle: false,
  loop: false,
  progress: 0,
  duration: 0,
  titles: PLAYLIST.map((p) => p.title),
};

function _notify() { _listeners.forEach((l) => l()); }

function _nextIndex(from: number, doShuffle: boolean) {
  if (PLAYLIST.length === 1) return 0;
  if (doShuffle) {
    let n = from;
    while (n === from) n = Math.floor(Math.random() * PLAYLIST.length);
    return n;
  }
  return (from + 1) % PLAYLIST.length;
}

function _prevIndex(from: number) {
  return (from - 1 + PLAYLIST.length) % PLAYLIST.length;
}

function _goTo(index: number) {
  _s.currentIndex = index;
  _s.progress = 0;
  _s.duration = 0;
  _player?.loadVideoById(PLAYLIST[index].id);
  _notify();
}

function _initPlayer() {
  if (_player) return;

  // Create a persistent container outside the React tree
  let container = document.getElementById("yt-player-root");
  if (!container) {
    container = document.createElement("div");
    container.id = "yt-player-root";
    Object.assign(container.style, {
      position: "fixed", width: "1px", height: "1px",
      overflow: "hidden", opacity: "0", pointerEvents: "none",
      top: "-9999px", left: "-9999px",
    });
    document.body.appendChild(container);
  }

  const div = document.createElement("div");
  container.appendChild(div);

  _player = new window.YT.Player(div, {
    height: "1", width: "1",
    videoId: PLAYLIST[0].id,
    playerVars: { autoplay: 1, mute: 1, controls: 0, rel: 0, modestbranding: 1, playsinline: 1 },
    events: {
      onReady: (e: any) => {
        e.target.setVolume(_s.volume);
        e.target.mute();
        e.target.playVideo();
        _notify();
      },
      onStateChange: (e: any) => {
        const S = window.YT?.PlayerState;
        if (!S) return;
        if (e.data === S.PLAYING) {
          _s.playing = true;
          _s.duration = _player.getDuration();
          if (_progressTimer) clearInterval(_progressTimer);
          _progressTimer = setInterval(() => {
            _s.progress = _player.getCurrentTime();
            _notify();
          }, 500);
          _notify();
        } else if (e.data === S.PAUSED) {
          _s.playing = false;
          if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
          _notify();
        } else if (e.data === S.ENDED) {
          _s.playing = false;
          if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
          if (_s.loop) {
            _player.seekTo(0);
            _player.playVideo();
          } else {
            _goTo(_nextIndex(_s.currentIndex, _s.shuffle));
          }
          _notify();
        }
      },
    },
  });
}

let _titlesFetched = false;
function _fetchTitles() {
  if (_titlesFetched) return;
  _titlesFetched = true;
  PLAYLIST.forEach((video, i) => {
    fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${video.id}&format=json`)
      .then((r) => r.json())
      .then((d: { title: string }) => {
        const next = [..._s.titles];
        next[i] = d.title;
        _s.titles = next;
        _notify();
      })
      .catch(() => {});
  });
}

// ── React component ───────────────────────────────────────────────────────────

export function MusicWidget() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  // Stable dispatch reference — used to subscribe to module-level state changes
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  useEffect(() => { setMounted(true); }, []);

  // Subscribe to singleton state changes; survives remounts
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize player and fetch titles once (guards are inside each fn)
  useEffect(() => {
    if (!mounted) return;
    _fetchTitles();
    const init = () => _initPlayer();
    if (window.YT?.Player) {
      init();
    } else {
      window.onYouTubeIframeAPIReady = init;
      if (!document.getElementById("yt-iframe-api")) {
        const s = document.createElement("script");
        s.id = "yt-iframe-api";
        s.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(s);
      }
    }
  }, [mounted]);

  const handlePlayPause = () => {
    if (!_player) return;
    _s.playing ? _player.pauseVideo() : _player.playVideo();
  };

  const handleVolume = (v: number) => {
    _s.volume = v;
    if (_player) {
      _player.setVolume(v);
      if (v > 0 && _s.muted) { _player.unMute(); _s.muted = false; }
    }
    _notify();
  };

  const handleUnmute = () => {
    if (!_player) return;
    _player.unMute();
    _player.setVolume(_s.volume);
    _s.muted = false;
    _notify();
  };

  const handleSeek = (t: number) => {
    _player?.seekTo(t, true);
    _s.progress = t;
    _notify();
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  if (!mounted) return null;

  const { currentIndex, playing, muted, volume, shuffle, loop, progress, duration, titles } = _s;

  return (
    <div className="fixed bottom-4 left-4 z-[88] flex flex-col items-start gap-2">
      {open && (
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-72">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 shrink-0">
            <span className="text-base">🎵</span>
            <p className="text-sm font-semibold text-gray-800 flex-1">FamCity Radio</p>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>

          {/* Unmute banner */}
          {muted && (
            <button
              onClick={handleUnmute}
              className="w-full flex items-center justify-center gap-2 bg-orange-50 hover:bg-orange-100 text-orange-600 text-sm font-semibold py-2 transition-colors"
            >
              🔇 Tap to unmute
            </button>
          )}

          {/* Thumbnail + title */}
          <div className="px-4 pt-3 pb-2">
            <div className="relative w-full rounded-xl overflow-hidden bg-gray-100 mb-2" style={{ aspectRatio: "16/9" }}>
              <Image
                src={`https://img.youtube.com/vi/${PLAYLIST[currentIndex].id}/mqdefault.jpg`}
                alt={titles[currentIndex]}
                fill
                className="object-cover"
                unoptimized
              />
            </div>
            <p className="text-sm font-semibold text-gray-800 text-center truncate px-1">{titles[currentIndex]}</p>
          </div>

          {/* Progress */}
          <div className="px-4 pb-1">
            <input
              type="range" min={0} max={duration || 1} step={0.5} value={progress}
              onChange={(e) => handleSeek(Number(e.target.value))}
              className="w-full h-1.5 rounded-full accent-orange-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
              <span>{fmt(progress)}</span>
              <span>{fmt(duration)}</span>
            </div>
          </div>

          {/* Transport controls */}
          <div className="px-4 pb-2 flex items-center justify-center gap-5">
            <button onClick={() => _goTo(_prevIndex(currentIndex))} className="text-gray-500 hover:text-gray-800 transition-colors text-xl" title="Previous">⏮</button>
            <button
              onClick={handlePlayPause}
              className="w-11 h-11 rounded-full bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 transition-colors text-xl shrink-0"
            >
              {playing ? "⏸" : "▶"}
            </button>
            <button onClick={() => _goTo(_nextIndex(currentIndex, shuffle))} className="text-gray-500 hover:text-gray-800 transition-colors text-xl" title="Next">⏭</button>
          </div>

          {/* Shuffle + Loop */}
          <div className="px-4 pb-2 flex items-center justify-center gap-3">
            <button
              onClick={() => { _s.shuffle = !_s.shuffle; _notify(); }}
              className={`text-sm px-3 py-1 rounded-full font-medium transition-colors ${shuffle ? "bg-orange-100 text-orange-600" : "text-gray-400 hover:text-gray-600"}`}
            >🔀 Shuffle</button>
            <button
              onClick={() => { _s.loop = !_s.loop; _notify(); }}
              className={`text-sm px-3 py-1 rounded-full font-medium transition-colors ${loop ? "bg-orange-100 text-orange-600" : "text-gray-400 hover:text-gray-600"}`}
            >🔁 Loop</button>
          </div>

          {/* Volume */}
          <div className="px-4 pb-4 flex items-center gap-2">
            <span className="text-sm">{volume === 0 ? "🔇" : volume < 40 ? "🔉" : "🔊"}</span>
            <input
              type="range" min={0} max={100} value={volume}
              onChange={(e) => handleVolume(Number(e.target.value))}
              className="flex-1 h-1.5 rounded-full accent-orange-500 cursor-pointer"
            />
            <span className="text-xs text-gray-400 w-7 text-right">{volume}</span>
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-xl transition-all ${
          playing && !muted ? "bg-orange-500 text-white" : "bg-white text-gray-600 border border-gray-200 hover:border-orange-300"
        }`}
        title="Music player"
      >
        🎵
      </button>
    </div>
  );
}
