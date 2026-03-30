"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { PLAYLIST } from "@/lib/playlist";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

export function MusicWidget() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [loop, setLoop] = useState(false);
  const [volume, setVolume] = useState(70);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [titles, setTitles] = useState<string[]>(PLAYLIST.map((p) => p.title));

  // Refs so stale closures in YT callbacks always see current values
  const playerRef = useRef<any>(null);
  const ytDivRef = useRef<HTMLDivElement>(null);
  const shuffleRef = useRef(false);
  const loopRef = useRef(false);
  const currentIndexRef = useRef(0);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Fetch titles via YouTube oEmbed (no API key needed)
  useEffect(() => {
    PLAYLIST.forEach((video, i) => {
      fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${video.id}&format=json`)
        .then((r) => r.json())
        .then((d) => setTitles((prev) => { const n = [...prev]; n[i] = d.title; return n; }))
        .catch(() => {});
    });
  }, []);

  // Load YouTube IFrame API once mounted
  useEffect(() => {
    if (!mounted) return;
    const init = () => {
      if (!ytDivRef.current || playerRef.current) return;
      playerRef.current = new window.YT.Player(ytDivRef.current, {
        height: "1", width: "1",
        videoId: PLAYLIST[0].id,
        playerVars: { autoplay: 0, controls: 0, rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: (e: any) => { e.target.setVolume(70); },
          onStateChange: (e: any) => {
            const S = window.YT.PlayerState;
            if (e.data === S.PLAYING) {
              setPlaying(true);
              setDuration(playerRef.current.getDuration());
              progressTimer.current = setInterval(() => {
                setProgress(playerRef.current.getCurrentTime());
              }, 500);
            } else if (e.data === S.PAUSED) {
              setPlaying(false);
              if (progressTimer.current) clearInterval(progressTimer.current);
            } else if (e.data === S.ENDED) {
              setPlaying(false);
              if (progressTimer.current) clearInterval(progressTimer.current);
              if (loopRef.current) {
                playerRef.current.seekTo(0);
                playerRef.current.playVideo();
              } else {
                goTo(nextIndex(currentIndexRef.current, shuffleRef.current));
              }
            }
          },
        },
      });
    };

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

  // Keep refs in sync
  useEffect(() => { shuffleRef.current = shuffle; }, [shuffle]);
  useEffect(() => { loopRef.current = loop; }, [loop]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

  function nextIndex(from: number, doShuffle: boolean) {
    if (PLAYLIST.length === 1) return 0;
    if (doShuffle) {
      let n = from;
      while (n === from) n = Math.floor(Math.random() * PLAYLIST.length);
      return n;
    }
    return (from + 1) % PLAYLIST.length;
  }

  function prevIndex(from: number) {
    return (from - 1 + PLAYLIST.length) % PLAYLIST.length;
  }

  function goTo(index: number) {
    setCurrentIndex(index);
    currentIndexRef.current = index;
    setProgress(0);
    setDuration(0);
    playerRef.current?.loadVideoById(PLAYLIST[index].id);
  }

  const handlePlayPause = () => {
    if (!playerRef.current) return;
    playing ? playerRef.current.pauseVideo() : playerRef.current.playVideo();
  };

  const handleVolume = (v: number) => {
    setVolume(v);
    playerRef.current?.setVolume(v);
  };

  const handleSeek = (t: number) => {
    playerRef.current?.seekTo(t, true);
    setProgress(t);
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  if (!mounted) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[88] flex flex-col items-start gap-2">
      {/* Hidden YouTube player */}
      <div style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" }}>
        <div ref={ytDivRef} />
      </div>

      {open && (
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-72">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 shrink-0">
            <span className="text-base">🎵</span>
            <p className="text-sm font-semibold text-gray-800 flex-1">FamCity Radio</p>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>

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
            <button onClick={() => goTo(prevIndex(currentIndex))} className="text-gray-500 hover:text-gray-800 transition-colors text-xl" title="Previous">⏮</button>
            <button
              onClick={handlePlayPause}
              className="w-11 h-11 rounded-full bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 transition-colors text-xl shrink-0"
            >
              {playing ? "⏸" : "▶"}
            </button>
            <button onClick={() => goTo(nextIndex(currentIndex, shuffle))} className="text-gray-500 hover:text-gray-800 transition-colors text-xl" title="Next">⏭</button>
          </div>

          {/* Shuffle + Loop */}
          <div className="px-4 pb-2 flex items-center justify-center gap-3">
            <button
              onClick={() => setShuffle((s) => !s)}
              className={`text-sm px-3 py-1 rounded-full font-medium transition-colors ${shuffle ? "bg-orange-100 text-orange-600" : "text-gray-400 hover:text-gray-600"}`}
            >🔀 Shuffle</button>
            <button
              onClick={() => setLoop((l) => !l)}
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
          playing ? "bg-orange-500 text-white" : "bg-white text-gray-600 border border-gray-200 hover:border-orange-300"
        }`}
        title="Music player"
      >
        🎵
      </button>
    </div>
  );
}
