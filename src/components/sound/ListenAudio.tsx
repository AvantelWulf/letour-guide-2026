import React, { useEffect, useRef, useState } from "react";

// This is the base url of the page
const BASE_URL = import.meta.env.BASE_URL || "/";
// This is the url of the broadcast server
const WS_URL = `${location.origin}${BASE_URL.replace(
  "client",
  "server"
)}api/server`; // Update if your server runs elsewhere
const PLAYBACK_BUFFER_SECONDS = 0.08;

export default function ListenAudio() {
  const [channel, setChannel] = useState("1");
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const nextPlaybackTimeRef = useRef(0);
  const [int_numUsers, setNumUsers] = useState(0);
  // Add a ref to track the silence timeout
  const playingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  //useEffect to set up websocket connection when channel changes
  useEffect(() => {
    nextPlaybackTimeRef.current = 0;
    // Clean up previous connection
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (!audioCtxRef.current) {
      // audioCtxRef.current = new (window.AudioContext ||
      //   (window as any).webkitAudioContext)();
      const AudioContextConstructor =
      window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new AudioContextConstructor({
      sampleRate: 48000,
      latencyHint: "interactive",
      });
      // Create a gain node for volume control
      gainNodeRef.current = audioCtxRef.current.createGain();
      gainNodeRef.current.gain.value = 1; // Ensure unmuted on init
      gainNodeRef.current.connect(audioCtxRef.current.destination);
    }
    const resumeAudioContext = () => {
      const context = audioCtxRef.current;
      if (context && context.state !== "running") {
        void context.resume().then(() => {
          nextPlaybackTimeRef.current = context.currentTime;
        }).catch((error) => {
          console.error("Unable to resume audio playback:", error);
        });
      }
    };
    window.addEventListener("pointerdown", resumeAudioContext);
    window.addEventListener("keydown", resumeAudioContext);

    const ws = new WebSocket(WS_URL);
    // ensure binary messages arrive as ArrayBuffer for easy decoding
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      // tell server we are a listener for this channel
      ws.send(JSON.stringify({ type: "join", channel, role: "listener" }));
      // start a lightweight application-level heartbeat so server can detect and close
      // truly inactive pages. Heartbeat interval only for listeners.
      const HEARTBEAT_MS = 10000; // send heartbeat every 10s
      const hb = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "heartbeat" }));
          } catch (e) {
            /* ignore */
          }
        }
      }, HEARTBEAT_MS);
      // store on websocket so it can be cleared on disconnect
      (ws as any)._heartbeatInterval = hb;
    };

    ws.onmessage = (msg) => {
      // If it's JSON text (control message)
        if (typeof msg.data === "string") {
          const parsed = JSON.parse(msg.data);

          if (parsed.type === "num_users") {
            setNumUsers(parsed.count);   // <-- UPDATE React state here
            return;
          }

          // handle other string-control messages if needed
          return;
        }
      
      // 1. Handle Binary Audio (ArrayBuffer) FIRST
      if (msg.data instanceof ArrayBuffer) {
        try {
          // Dispatch event saying audio is playing (for UI animations)
          window.dispatchEvent(
            new CustomEvent("audio:playing-change", {
              detail: { playing: true },
            })
          );

          // Reset the "silence" timer
          if (playingTimeoutRef.current)
            clearTimeout(playingTimeoutRef.current);

          // If no new audio arrives for 500ms, consider it stopped
          playingTimeoutRef.current = setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("audio:playing-change", {
                detail: { playing: false },
              })
            );
          }, 500);

          const buf = msg.data;
          const view = new DataView(buf);
          const sampleRate = view.getUint32(0, true);
          const audioBufferBytes = buf.slice(4);
          const samples = new Float32Array(audioBufferBytes);

          const ctx = audioCtxRef.current!;
          const gainNode = gainNodeRef.current!;
          if (ctx.state !== "running" || !sampleRate || samples.length === 0) return;

          const buffer = ctx.createBuffer(1, samples.length, sampleRate);
          buffer.getChannelData(0).set(samples);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(gainNode);

          const startTime = Math.max(
            nextPlaybackTimeRef.current,
            ctx.currentTime + PLAYBACK_BUFFER_SECONDS
          );
          source.start(startTime);
          nextPlaybackTimeRef.current = startTime + buffer.duration;
        } catch (error) {
          console.error("Error processing binary audio:", error);
        }
        return;
      }

      // 2. Handle Text Messages (JSON)
      try {
        const { type, data, sampleRate } = JSON.parse(msg.data);
        if (type === "audio" && Array.isArray(data)) {
          // 1. Dispatch event saying audio is playing
          window.dispatchEvent(
            new CustomEvent("audio:playing-change", {
              detail: { playing: true },
            })
          );

          // 2. Reset the "silence" timer
          if (playingTimeoutRef.current)
            clearTimeout(playingTimeoutRef.current);

          // 3. If no new audio arrives for 500ms, consider it stopped
          playingTimeoutRef.current = setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("audio:playing-change", {
                detail: { playing: false },
              })
            );
          }, 500);
        }

        // Text messages are control messages (join/lock state)
        if (typeof msg.data === "string") {
          // const parsed = JSON.parse(msg.data); // Already parsed above
          // if needed in future, we can handle more control messages here
          return;
        }

        // Unknown message format
        console.warn("Unknown WebSocket message format", msg.data);
      } catch (error) {
        console.error("Error processing audio data:", error);
      }
    };

    return () => {
      // clear heartbeat interval if present and close
      try {
        clearInterval((ws as any)._heartbeatInterval);
      } catch (e) {}
      window.removeEventListener("pointerdown", resumeAudioContext);
      window.removeEventListener("keydown", resumeAudioContext);
      ws.close();
      // Cleanup timeout
      if (playingTimeoutRef.current) clearTimeout(playingTimeoutRef.current);
    };
  }, [channel]);

  // Expose mute function globally
  useEffect(() => {
    (window as any).muteAudio = (mute: boolean) => {
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.value = mute ? 0 : 1;
      }
    };
  }, []);

  return (
    <div>
      <div className="mb-4">
        <label
          htmlFor="channel"
          className="text-3xl font-bold text-gray-200 mb-6"
        >
          Listen to:{" "}
        </label>
        <select
          id="channel"
          name="channel"
          className="text-3xl font-bold text-gray-200 mb-6"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
        >
          <option className="text-base font-bold text-gray-600" value="1">
            one
          </option>
          <option className="text-base font-bold text-gray-600" value="2">
            two
          </option>
          <option className="text-base font-bold text-gray-600" value="3">
            three
          </option>
          <option className="text-base font-bold text-gray-600" value="4">
            four
          </option>
          <option className="text-base font-bold text-gray-600" value="5">
            five
          </option>
          <option className="text-base font-bold text-gray-600" value="6">
            six
          </option>
          <option className="text-base font-bold text-gray-600" value="7">
            seven
          </option>
          <option className="text-base font-bold text-gray-600" value="8">
            eight
          </option>
          <option className="text-base font-bold text-gray-600" value="9">
            nine
          </option>
          <option className="text-base font-bold text-gray-600" value="10">
            ten
          </option>
        </select>
      </div>
      
      <div className="text-center">
        <h1 className="mt-1 text-3xl font-bold text-gray-200">
          Connected users: {int_numUsers}
        </h1>
      </div>
    </div>
  );
}
