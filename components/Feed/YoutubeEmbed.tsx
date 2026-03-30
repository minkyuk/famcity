import { extractYouTubeId, getEmbedUrl } from "@/lib/youtube";

export function YoutubeEmbed({ url }: { url: string }) {
  const videoId = extractYouTubeId(url);
  if (!videoId) return <p className="text-sm text-gray-400">Invalid YouTube URL</p>;

  return (
    <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
      <iframe
        src={getEmbedUrl(videoId)}
        className="absolute inset-0 w-full h-full rounded-xl"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        title="YouTube video"
      />
    </div>
  );
}
