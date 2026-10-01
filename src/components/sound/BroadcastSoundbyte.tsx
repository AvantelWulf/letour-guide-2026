import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

// This is the base url of the page
const BASE_URL = import.meta.env.BASE_URL || "/";
// This is the url of the server
const WS_URL = `${location.origin}${BASE_URL.replace('client', 'server')}api/server`; // Update if your server runs elsewhere

// This is the location of the soundbyte
const FILE1 = 'sounds/lego-yoda-death-sound-effect.wav';
const FILE2 = 'sounds/wilhelm-scream.wav';
const FILE = FILE1; //change file to test different sounds

// Accept base url as a prop (default to '/')
export default function BroadcastSoundbyte() {
  const [channel, setChannel] = useState("1");
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [hasLock, setHasLock] = useState(false);
  const [pendingPlay, setPendingPlay] = useState(false);

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
    const ws = new WebSocket(WS_URL);
    // receive binary as ArrayBuffer
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      // request broadcaster lock for channel
      ws.send(JSON.stringify({ type: "join", channel, role: 'broadcaster' }));
    };
    ws.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data);
        if (parsed.type === 'lock_granted' && parsed.channel === channel) {
          setHasLock(true);
          if (pendingPlay) {
            // we were waiting to play until we owned the lock — play now
            (async () => {
              setPendingPlay(false);
              try {
                const response = await fetch(BASE_URL + FILE);
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await audioCtxRef.current!.decodeAudioData(arrayBuffer);
                // Send audio as binary: header (sampleRate uint32 LE) + Float32 samples
                try {
                  const samples = audioBuffer.getChannelData(0);
                  const headerBytes = 4;
                  const buffer = new ArrayBuffer(headerBytes + samples.byteLength);
                  const view = new DataView(buffer);
                  view.setUint32(0, audioCtxRef.current!.sampleRate, true);
                  new Float32Array(buffer, headerBytes).set(samples);
                  if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(buffer);
                  }
                } catch (err) {
                  console.error('Error sending queued soundbyte:', err);
                }
              } catch (err) {
                console.error('Error sending queued soundbyte:', err);
              }
            })();
          }
        }
        if (parsed.type === 'lock_denied' && parsed.channel === channel) {
          setHasLock(false);
          setPendingPlay(false);
        }
        if (parsed.type === 'lock_released' && parsed.channel === channel) {
          setHasLock(false);
        }
      } catch (err) {
        // ignore
      }
    };

    return () => {
      ws.close();
    };
  }, [channel]);

  return (
    <div>
      <div className="">
        <label htmlFor="channel" className="r-2 text-3xl font-bold text-gray-200">Broadcast to: </label>
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
        </select>
      </div>
      <div>
        <Button className="mb-4 mt-2 text-[28px] font-bold w-full max-w-[80vw] h-12 px-6 py-2" variant="letu" onClick={async () => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            // ensure we have lock, if not try to request and queue
            if (!hasLock) {
              setPendingPlay(true);
              wsRef.current.send(JSON.stringify({ type: 'join', channel, role: 'broadcaster' }));
              return;
            }
            // Ensure base ends with a slash
            const response = await fetch(BASE_URL + FILE);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await audioCtxRef.current!.decodeAudioData(arrayBuffer);
            // send as binary with sampleRate header
            const samples = audioBuffer.getChannelData(0);
            const headerBytes = 4;
            const buffer = new ArrayBuffer(headerBytes + samples.byteLength);
            const view = new DataView(buffer);
            view.setUint32(0, audioCtxRef.current!.sampleRate, true);
            new Float32Array(buffer, headerBytes).set(samples);
            wsRef.current.send(buffer);
          }
        }}>
          Play!
        </Button>
      </div>
    </div>
  );
}