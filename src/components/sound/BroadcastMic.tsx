import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

// MIC WORKS AS INT16 DATA TYPE
// This is the base url of the page
const BASE_URL = import.meta.env.BASE_URL || "/";
// This is the url of the server
const WS_URL = `${location.origin}${BASE_URL.replace('client', 'server')}api/server`; // Update if your server runs elsewhere


export default function BroadcastMic() {
  const [channel, setChannel] = useState("1");
  const [microphoneStream, setMicrophoneStream] = useState<MediaStream | null>(null);
  const [micEnable, setMicEnable] = useState(false);
  const [hasLock, setHasLock] = useState(false);
  const [pendingStartMic, setPendingStartMic] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  //useEffect to set up websocket connection when channel changes
  useEffect(() => {
    // Clean up previous connection and set up new one when channel is changed
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (!audioCtxRef.current) {
  const AudioContextConstructor =
    window.AudioContext || (window as any).webkitAudioContext;
    audioCtxRef.current = new AudioContextConstructor({
    sampleRate: 48000,
    latencyHint: "interactive",
  });
}
    // if (!audioCtxRef.current) {
    //   audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    // }
    const ws = new WebSocket(WS_URL);
    // ensure binary messages are received as ArrayBuffer
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      // announce intent to be a broadcaster so server can grant a per-channel lock
      ws.send(JSON.stringify({ type: "join", channel, role: 'broadcaster' }));
    };
    ws.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data);
        if (parsed.type === 'lock_granted' && parsed.channel === channel) {
          setHasLock(true);
          if (pendingStartMic) {
            setPendingStartMic(false);
            setMicEnable(true);
          }
        }
        if (parsed.type === 'lock_denied' && parsed.channel === channel) {
          setHasLock(false);
          setPendingStartMic(false);
        }
        if (parsed.type === 'lock_released' && parsed.channel === channel) {
          // if our lock was released, stop the mic
          setHasLock(false);
          setMicEnable(false);
        }
        if (parsed.type === 'lock_owner' && parsed.channel === channel && parsed.ownerId) {
          // update hasLock flag if the owner isn't us
          // lock_granted will have set ours true earlier; if owner changed away, force false
          // no explicit client id in this app, so rely on lock_granted/denied
        }
      } catch (err) {
        // ignore
      }
    };

    return () => {
      ws.close();
    };
  }, [channel]);

  //useEffect to start/stop mic when micEnable changes
  useEffect(() => {
    if (micEnable) {
      // ensure we actually hold the lock before enabling mic
      if (!hasLock) {
        // Try to request the lock explicitly
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'join', channel, role: 'broadcaster' }));
        }
        // if lock not granted, don't start mic
        if (!hasLock) {
          setMicEnable(false);
          return;
        }
      }
      // Start mic
      navigator.mediaDevices.getUserMedia({ audio: true }).then(async stream => {
        setMicrophoneStream(stream);
        //get audio context using the mic-processor driver
        const audioCtx = audioCtxRef.current!;
        await audioCtx.audioWorklet.addModule(BASE_URL + 'drivers/mic-processor.js');
        const source = audioCtx.createMediaStreamSource(stream);
        //create a mic that we can listen to
        const micNode = new AudioWorkletNode(audioCtx, 'mic-processor');
        micNode.port.onmessage = (event) => {
          // event.data is a plain Array of float samples from the worklet.
          // Pack as binary: 4 bytes sampleRate (Uint32 LE) + Float32 samples.
          try {
            const floatSamples = Float32Array.from(event.data as Iterable<number>);
            const headerBytes = 4; // 32-bit sampleRate
            const buffer = new ArrayBuffer(headerBytes + floatSamples.byteLength);
            const view = new DataView(buffer);
            // write sampleRate at start (little-endian)
            view.setUint32(0, audioCtxRef.current!.sampleRate, true);
            // copy float samples into buffer after header
            new Float32Array(buffer, headerBytes).set(floatSamples);

            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(buffer);
            }
          } catch (err) {
            console.error('Failed to send audio buffer', err);
          }
        };
        source.connect(micNode).connect(audioCtx.destination);
      }).catch(err => {
        console.error("Error accessing microphone:", err);
        setMicEnable(false);
      });
    } else {
      // Stop mic
      if (microphoneStream) {
        microphoneStream.getTracks().forEach(track => track.stop());
      }
    } //end if micEnable
  }, [micEnable]);

  // Send a lightweight heartbeat while we own the lock to prevent accidental release
  useEffect(() => {
    let hb: any = null;
    if (hasLock && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const HEARTBEAT_MS = 5000; // 5s — keeps lock alive even during silence
      hb = setInterval(() => {
        try { wsRef.current?.send(JSON.stringify({ type: 'heartbeat' })); } catch (e) { /* ignore */ }
      }, HEARTBEAT_MS);
    }

    return () => {
      if (hb) clearInterval(hb);
    };
  }, [hasLock]);

  return (
    <div>
      <div className="">
        <label htmlFor="channel" className="mr-2 text-3xl font-bold text-gray-200">Broadcast to: </label>
        <select
          id="channel"
          name="channel"
          className="text-3xl font-bold text-gray-200"
          value={channel}
          onChange={e => setChannel(e.target.value)}
        >
          <option className="text-base font-bold text-gray-600" value="1">one</option>
          <option className="text-base font-bold text-gray-600" value="2">two</option>
          <option className="text-base font-bold text-gray-600" value="3">three</option>
          <option className="text-base font-bold text-gray-600" value="4">four</option>
          <option className="text-base font-bold text-gray-600" value="5">five</option> 
          <option className="text-base font-bold text-gray-600" value="6">six</option>
          <option className="text-base font-bold text-gray-600" value="7">seven</option>
          <option className="text-base font-bold text-gray-600" value="8">eight</option>
          <option className="text-base font-bold text-gray-600" value="9">nine</option>
          <option className="text-base font-bold text-gray-600" value="10">ten</option>
        </select>
      </div>
      <div className="">
        <Button
          className={
            `mb-4 mt-2 text-[28px] font-bold w-full max-w-[80vw] h-12 px-6 py-2 ${!hasLock ? 'opacity-70 filter grayscale' : ''}`
          }
          variant="letu"
                onClick={async () => {
          // If enabling, and we don't have the lock, request it and set pending
          if (!micEnable && !hasLock) {
            setPendingStartMic(true);
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'join', channel, role: 'broadcaster' }));
            }
            return;
          }

          setMicEnable(!micEnable);
        }}>
          {hasLock ? (micEnable ? "Stop Mic" : "Start Mic") : "[No broadcast privileges]"}
        </Button>

      </div>
    </div>
  );
}