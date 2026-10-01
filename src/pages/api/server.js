//TODO:
//  Switch audio packets to arrayBuffer and then int16 - DONE
//  Update UI in broadcastMic so that it gives an alert if it failed to get
//    the lock due to another broadcaster having it - DONE
//  Refactor and simplify like crazy

/**
 * @type {import('astro').APIRoute}
 */
export const GET = (ctx) => {
  // Check if this is a WebSocket upgrade request
  if (!ctx.locals.isUpgradeRequest) {
    return new Response("Upgrade Required", { status: 426 });
  }

  // Upgrade the connection to WebSocket
  const { response, socket } = ctx.locals.upgradeWebSocket();

  // Initialize channels and locks storage (keep in globalThis so it's shared across requests)
  if (!globalThis.wsChannels) {
    globalThis.wsChannels = {}; // { channelId: Set of sockets }
  }
  if (!globalThis.wsLocks) {
    // { channelId: { ownerId, ownerSocket, timeoutHandle, lastActive } }
    globalThis.wsLocks = {};
  }
  const channels = globalThis.wsChannels;
  const locks = globalThis.wsLocks;

  // lock timeout (ms) used to auto-release on inactivity (10 seconds)
  const INACTIVITY_TIMEOUT_MS = 10000;
  // listener inactivity timeout and cleanup check
  const LISTENER_INACTIVITY_MS = 30000; // 30s before server kicks an inactive listener
  const LISTENER_CLEANUP_CHECK_MS = 5000; // how often to scan for dead listeners

  function broadcastToChannel(channelId, payload) {
    if (channels[channelId]) {
      channels[channelId].forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(payload));
        }
      });
    }
  }

  function releaseLock(channelId, reason = 'timeout') {
    const lock = locks[channelId];
    if (!lock) return;
    if (lock.timeoutHandle) {
      clearTimeout(lock.timeoutHandle);
    }
    const ownerId = lock.ownerId;
    delete locks[channelId];
    // notify channel that lock was released
    broadcastToChannel(channelId, { type: 'lock_released', channel: channelId, reason, ownerId });
    console.log(`\x1b[35m Lock released for channel ${channelId} (owner ${ownerId}) - ${reason} \x1b[0m`);
  }

  // Handle incoming messages
  // assign an id for this socket so locks can be tracked reliably
  socket._id = Math.random().toString(36).slice(2, 9);
  // track when we last heard from this client (join/heartbeat/messages)
  socket.lastSeen = Date.now();

  socket.onmessage = (event) => {
    //console.log('\x1b[36m Web Server: received message \x1b[0m');
    // update last seen for this socket
    socket.lastSeen = Date.now();

    // If a binary ArrayBuffer arrives, treat it as audio frames
    if (event.data && !(typeof event.data === 'string')) {
      // Ensure socket has a channel
      if (!socket.channel) return;

      console.log('\x1b[34m Web Server: received binary audio frame \x1b[0m');

      // Only allow audio from the current lock owner
      const lock = locks[socket.channel];
      if (!lock || lock.ownerSocket !== socket) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'audio_ignored', reason: 'no_lock', channel: socket.channel }));
        }
        return;
      }

      // update last active timestamp and reset inactivity timer
      lock.lastActive = Date.now();
      if (lock.timeoutHandle) clearTimeout(lock.timeoutHandle);
      lock.timeoutHandle = setTimeout(() => releaseLock(socket.channel, 'inactivity'), INACTIVITY_TIMEOUT_MS);

      // Relay raw binary audio buffer to other clients on the same channel
      if (channels[socket.channel]) {
        channels[socket.channel].forEach(client => {
          if (client !== socket && client.readyState === WebSocket.OPEN) {
            try {
              client.send(event.data);    //Where audio is sent.
            } catch (e) {
              // ignore send errors per-client
            }
          }
        });
      }

      return;
    }

    // otherwise assume text control message and parse as JSON
    let parsed;
    try {
      parsed = JSON.parse(event.data);
      console.log('received json control message');
    } catch {
      return;
    }

    const { type, channel, data, role } = parsed;

    if (type === 'join') {
      socket.channel = channel;
      socket.role = role || 'listener';
      channels[channel] = channels[channel] || new Set();
      channels[channel].add(socket);
      broadcastToChannel(channel, {
        type: 'num_users',
        count: channels[channel].size
      });
      console.log(`\x1b[32m Client joined channel: ${channel} as ${socket.role} (id=${socket._id}) \x1b[0m`);

      // If a broadcaster joins, attempt to grant the lock
      // set lastSeen and role (used by cleanup logic)
      socket.lastSeen = Date.now();
      socket.role = socket.role || role || 'listener';
      if (socket.role === 'broadcaster') {
        const lock = locks[channel];
        if (!lock) {
          // no owner, grant it
          locks[channel] = { ownerId: socket._id, ownerSocket: socket, lastActive: Date.now() };
          // schedule inactivity release
          locks[channel].timeoutHandle = setTimeout(() => releaseLock(channel, 'inactivity'), INACTIVITY_TIMEOUT_MS);
          // notify owner
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'lock_granted', channel, ownerId: socket._id }));
          }
          // notify channel
          broadcastToChannel(channel, { type: 'lock_owner', channel, ownerId: socket._id });
          console.log(`\x1b[33m Lock granted for channel ${channel} to ${socket._id} \x1b[0m`);
        } else if (lock.ownerSocket === socket) {
          // already owner; refresh
          lock.lastActive = Date.now();
          if (lock.timeoutHandle) clearTimeout(lock.timeoutHandle);
          lock.timeoutHandle = setTimeout(() => releaseLock(channel, 'inactivity'), INACTIVITY_TIMEOUT_MS);
          socket.send(JSON.stringify({ type: 'lock_granted', channel, ownerId: socket._id }));
        } else {
          // someone else has lock
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'lock_denied', channel, ownerId: lock.ownerId }));
          }
          console.log(`\x1b[31m Lock denied for channel ${channel} to ${socket._id} (owner ${lock.ownerId}) \x1b[0m`);
        }
      } else {
        // for listeners, notify current lock owner if exists
        const lock = locks[channel];
        if (lock) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'lock_owner', channel, ownerId: lock.ownerId }));
          }
        }
      }
    }

    // lightweight heartbeat message from clients (listeners) to keep session alive
    if (type === 'heartbeat') {
      // nothing to do beyond updating lastSeen above for listeners
      // For broadcasters, treat heartbeat as activity and refresh their lock timeout
      if (socket.role === 'broadcaster' && socket.channel) {
        const lock = locks[socket.channel];
        if (lock && lock.ownerSocket === socket) {
          lock.lastActive = Date.now();
          if (lock.timeoutHandle) clearTimeout(lock.timeoutHandle);
          lock.timeoutHandle = setTimeout(() => releaseLock(socket.channel, 'inactivity'), INACTIVITY_TIMEOUT_MS);
        }
      }
      return;
    }
  };

  // Schedule a single global cleanup interval to remove inactive listeners
  if (!globalThis.wsListenerCleanupInterval) {
    globalThis.wsListenerCleanupInterval = setInterval(() => {
      try {
        const now = Date.now();
        Object.keys(channels).forEach(channelId => {
          channels[channelId].forEach(client => {
            try {
              const isListener = client.role === 'listener' || !client.role;
              if (isListener) {
                const last = client.lastSeen || 0;
                if (now - last > LISTENER_INACTIVITY_MS) {
                  console.log(`\x1b[90m Kicking inactive listener ${client._id} from channel ${channelId} (idle ${Math.round((now-last)/1000)}s) \x1b[0m`);
                  try { client.close(); } catch (e) {}
                }
              }
            } catch (e) {
              // continue
            }
          });
        });
      } catch (err) {
        // ignore
      }
    }, LISTENER_CLEANUP_CHECK_MS);
  }

  // Handle connection close
  socket.onclose = () => {
    console.log('\x1b[33m Client disconnected \x1b[0m');
    if (socket.channel) {
      if (channels[socket.channel]) {
        channels[socket.channel].delete(socket);
        broadcastToChannel(socket.channel, {
          type: 'num_users',
          count: channels[socket.channel].size
        });
        console.log(`\x1b[93m Client left channel: ${socket.channel} (id=${socket._id}) \x1b[0m`);
        // If this socket held the lock, release it
        const lock = locks[socket.channel];
        if (lock && lock.ownerSocket === socket) {
          releaseLock(socket.channel, 'disconnect');
        }
      }
    }
  };

  // Handle errors
  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  return response;
};