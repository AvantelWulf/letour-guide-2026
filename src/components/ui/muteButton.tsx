import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AudioLines, Volume, Volume2, VolumeX } from "lucide-react";

export default function MuteButton() {
  const [muted, setMuted] = useState(true);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);

  useEffect(() => {
    const handlePlaybackChange = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      
      // Extract boolean from event detail
      const detail = event.detail;
      const playing = typeof detail?.playing === "boolean" ? detail.playing : Boolean(detail);

      setIsAudioPlaying(playing);
      
      // REMOVED: The logic that auto-unmuted you. 
      // Now you can stay muted even if the server is sending audio.
    };

    window.addEventListener("audio:playing-change", handlePlaybackChange);
    return () => window.removeEventListener("audio:playing-change", handlePlaybackChange);
  }, []);

  const toggleMute = () => {
    const newMutedState = !muted;
    setMuted(newMutedState);

    if (typeof (window as any).muteAudio === "function") {
      (window as any).muteAudio(newMutedState);
    }
  };

  // 1. If Muted -> Show Mute Icon (VolumeX)
  // 2. If Not Muted AND Audio is streaming -> Show Wave Icon (AudioLines)
  // 3. If Not Muted AND Silence -> Show Speaker Icon (Volume2)
  const Icon = muted ? VolumeX : isAudioPlaying ? Volume2 : Volume;

  return (
    <Button
      onClick={toggleMute}
      variant="letu"
      size="icon"
      className="mt-[1vw] text-[28px] font-bold w-full max-w-[500px] h-14 px-6 py-2"
    >
      <span className="flex items-center justify-center gap-3">
        <Icon className="size-8" aria-hidden />
        {muted ? "Unmute Speaker" : "Mute Speaker"}
      </span>
    </Button>
  );
}
