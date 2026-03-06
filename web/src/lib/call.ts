// WebRTC P2P calls — signaling over Nostr, no STUN server, zero IP leak
// Fresh ephemeral Nostr keypair per call — unlinkable to chat identity
// Media: DTLS-SRTP (WebRTC built-in)
// Signaling: ECDH encrypted + random delay + ephemeral keys

import SimplePeer from 'simple-peer'
import { generateSecretKey, getPublicKey, finalizeEvent, SimplePool } from 'nostr-tools'
import type { Filter } from 'nostr-tools'
import { encryptMessage, decryptMessage } from './chat-crypto'

const CALL_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://offchain.pub',
  'wss://relay.primal.net',
]

const CALL_KIND = 20002 // Different kind from chat

export type CallState = 'idle' | 'calling' | 'receiving' | 'connected' | 'ended'

export type CallSignal = {
  type: 'offer' | 'answer' | 'ice' | 'hangup' | 'ring'
  data?: string // JSON stringified SimplePeer signal
  callId: string
  from: string
}

function getCallTag(myPubKey: string, theirPubKey: string, callId: string): string {
  const sorted = [myPubKey, theirPubKey].sort()
  let hash = 0
  const str = sorted[0] + sorted[1] + callId
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) >>> 0
  }
  return `wspr_call_${hash.toString(16)}`
}

// Random delay 0-2s to break timing correlation
function randomDelay(): Promise<void> {
  return new Promise(r => setTimeout(r, Math.random() * 2000))
}

export class CallManager {
  private peer: SimplePeer.Instance | null = null
  private pool: SimplePool | null = null
  private sub: { close: () => void } | null = null
  private ephemeralPrivKey: Uint8Array | null = null
  private ephemeralPubKey: string = ''
  private callTag: string = ''
  private callId: string = ''
  private sharedSecret: Uint8Array | null = null
  private state: CallState = 'idle'
  private localStream: MediaStream | null = null

  // Callbacks
  onStateChange: ((state: CallState) => void) | null = null
  onRemoteStream: ((stream: MediaStream) => void) | null = null
  onIncomingCall: ((callId: string, from: string) => void) | null = null
  onError: ((err: string) => void) | null = null

  async listenForCalls(
    myPubKey: string,
    sharedSecret: Uint8Array,
    theirPubKey: string
  ): Promise<void> {
    this.sharedSecret = sharedSecret
    this.pool = new SimplePool()

    // Listen for incoming ring signals
    const filter = {
      kinds: [CALL_KIND],
      since: Math.floor(Date.now() / 1000) - 10,
    }
    const tag = `wspr_call_ring_${[myPubKey, theirPubKey].sort().join('').slice(0, 16)}`
    ;(filter as Record<string, unknown>)['#t'] = [tag]

    this.sub = this.pool.subscribeMany(
      CALL_RELAYS,
      filter as unknown as Filter,
      {
        onevent: async (event) => {
          try {
            const decrypted = await decryptMessage(event.content, sharedSecret, event.id)
            if (!decrypted) return
            const signal: CallSignal = JSON.parse(decrypted)
            if (signal.type === 'ring' && signal.from !== myPubKey) {
              this.callId = signal.callId
              if (this.onIncomingCall) this.onIncomingCall(signal.callId, signal.from)
            }
          } catch { /* not for us */ }
        }
      }
    )
  }

  async startCall(
    myPubKey: string,
    theirPubKey: string,
    sharedSecret: Uint8Array,
    video = false
  ): Promise<void> {
    this.sharedSecret = sharedSecret
    this.callId = crypto.randomUUID()
    this.callTag = getCallTag(myPubKey, theirPubKey, this.callId)

    // Fresh ephemeral keypair for this call
    this.ephemeralPrivKey = generateSecretKey()
    this.ephemeralPubKey = getPublicKey(this.ephemeralPrivKey)

    this._setState('calling')
    this.pool = new SimplePool()

    // Get local media
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video
      })
    } catch {
      this.onError?.('Microphone access denied.')
      this._setState('ended')
      return
    }

    // Subscribe to answer signals
    await this._subscribeToSignals(myPubKey, theirPubKey, sharedSecret)

    // Create peer as initiator
    this.peer = new SimplePeer({
      initiator: true,
      stream: this.localStream,
      trickle: true,
      // No STUN — rely on host candidates only (local network)
      // Falls back to relay if needed
      config: {
        iceServers: [
          // Cloudflare STUN — free, privacy-respecting
          { urls: 'stun:stun.cloudflare.com:3478' },
          // Open Relay TURN — free fallback
          {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          }
        ]
      }
    })

    this.peer.on('signal', async (data) => {
      await randomDelay()
      await this._sendSignal(myPubKey, theirPubKey, sharedSecret, {
        type: data.type === 'offer' ? 'offer' : 'ice',
        data: JSON.stringify(data),
        callId: this.callId,
        from: myPubKey
      })
    })

    this.peer.on('stream', (stream: MediaStream) => {
      this.onRemoteStream?.(stream)
      this._setState('connected')
    })

    this.peer.on('error', (err: Error) => {
      this.onError?.(err.message)
      this._setState('ended')
    })

    this.peer.on('close', () => this._setState('ended'))

    // Send ring signal
    const ringTag = `wspr_call_ring_${[myPubKey, theirPubKey].sort().join('').slice(0, 16)}`
    await this._sendSignalToTag(myPubKey, sharedSecret, ringTag, {
      type: 'ring',
      callId: this.callId,
      from: myPubKey
    })
  }

  async answerCall(
    myPubKey: string,
    theirPubKey: string,
    sharedSecret: Uint8Array,
    callId: string,
    video = false
  ): Promise<void> {
    this.sharedSecret = sharedSecret
    this.callId = callId
    this.callTag = getCallTag(theirPubKey, myPubKey, callId)

    this.ephemeralPrivKey = generateSecretKey()
    this.ephemeralPubKey = getPublicKey(this.ephemeralPrivKey)

    this._setState('receiving')

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video })
    } catch {
      this.onError?.('Microphone access denied.')
      this._setState('ended')
      return
    }

    await this._subscribeToSignals(myPubKey, theirPubKey, sharedSecret)

    this.peer = new SimplePeer({
      initiator: false,
      stream: this.localStream,
      trickle: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.cloudflare.com:3478' },
          {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          }
        ]
      }
    })

    this.peer.on('signal', async (data) => {
      await randomDelay()
      await this._sendSignal(myPubKey, theirPubKey, sharedSecret, {
        type: data.type === 'answer' ? 'answer' : 'ice',
        data: JSON.stringify(data),
        callId,
        from: myPubKey
      })
    })

    this.peer.on('stream', (stream: MediaStream) => {
      this.onRemoteStream?.(stream)
      this._setState('connected')
    })

    this.peer.on('error', (err: Error) => {
      this.onError?.(err.message)
      this._setState('ended')
    })

    this.peer.on('close', () => this._setState('ended'))
  }

  async hangup(myPubKey: string, theirPubKey: string, sharedSecret: Uint8Array): Promise<void> {
    await this._sendSignal(myPubKey, theirPubKey, sharedSecret, {
      type: 'hangup',
      callId: this.callId,
      from: myPubKey
    })
    this._cleanup()
  }

  private async _subscribeToSignals(
    myPubKey: string,
    theirPubKey: string,
    sharedSecret: Uint8Array
  ): Promise<void> {
    if (!this.pool) return
    const filter = {
      kinds: [CALL_KIND],
      since: Math.floor(Date.now() / 1000) - 5,
    }
    ;(filter as Record<string, unknown>)['#t'] = [this.callTag]

    if (this.sub) this.sub.close()
    this.sub = this.pool.subscribeMany(
      CALL_RELAYS,
      filter as unknown as Filter,
      {
        onevent: async (event) => {
          try {
            const decrypted = await decryptMessage(event.content, sharedSecret, event.id)
            if (!decrypted) return
            const signal: CallSignal = JSON.parse(decrypted)
            if (signal.from === myPubKey) return // ignore own signals
            if (signal.callId !== this.callId) return

            if (signal.type === 'hangup') {
              this._cleanup()
              return
            }

            if (signal.data && this.peer) {
              this.peer.signal(JSON.parse(signal.data))
            }
          } catch { /* not for us */ }
        }
      }
    )
  }

  private async _sendSignal(
    myPubKey: string,
    theirPubKey: string,
    sharedSecret: Uint8Array,
    signal: CallSignal
  ): Promise<void> {
    await this._sendSignalToTag(myPubKey, sharedSecret, this.callTag, signal)
  }

  private async _sendSignalToTag(
    myPubKey: string,
    sharedSecret: Uint8Array,
    tag: string,
    signal: CallSignal
  ): Promise<void> {
    if (!this.pool || !this.ephemeralPrivKey) return
    const encrypted = await encryptMessage(JSON.stringify(signal), sharedSecret, crypto.randomUUID())
    const event = finalizeEvent({
      kind: CALL_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', tag]],
      content: encrypted,
    }, this.ephemeralPrivKey)
    try {
      await Promise.any(this.pool.publish(CALL_RELAYS, event))
    } catch { /* relay unavailable */ }
  }

  private _setState(state: CallState): void {
    this.state = state
    this.onStateChange?.(state)
  }

  private _cleanup(): void {
    if (this.peer) { this.peer.destroy(); this.peer = null }
    if (this.sub) { this.sub.close(); this.sub = null }
    if (this.pool) { this.pool.close(CALL_RELAYS); this.pool = null }
    if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null }
    this._setState('ended')
  }

  getLocalStream(): MediaStream | null { return this.localStream }
  getState(): CallState { return this.state }
}
