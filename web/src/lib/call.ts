import SimplePeer from 'simple-peer'
import { generateSecretKey, finalizeEvent, SimplePool } from 'nostr-tools'
import type { Filter } from 'nostr-tools'

const CALL_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://offchain.pub',
  'wss://relay.primal.net',
  'wss://nostr.wine',
]

const CALL_KIND = 20002

export type CallState = 'idle' | 'calling' | 'receiving' | 'connected' | 'ended'

export type CallSignal = {
  type: 'offer' | 'answer' | 'ice' | 'hangup' | 'ring'
  data?: string
  callId: string
  from: string
}

function getRingTag(myPubKey: string, theirPubKey: string): string {
  const sorted = [myPubKey, theirPubKey].sort()
  let hash = 0
  const str = 'ring' + sorted[0] + sorted[1]
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) >>> 0
  return `wc_${hash.toString(16)}`
}

function getSignalTag(callId: string): string {
  let hash = 0
  for (let i = 0; i < callId.length; i++) hash = ((hash << 5) - hash + callId.charCodeAt(i)) >>> 0
  return `ws_${hash.toString(16)}`
}

// Simple XOR encryption with shared secret — no ID needed, deterministic
async function encryptSignal(data: string, sharedSecret: Uint8Array): Promise<string> {
  const enc = new TextEncoder()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', sharedSecret.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt'])
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(data))
  const out = new Uint8Array(12 + ct.byteLength)
  out.set(iv)
  out.set(new Uint8Array(ct), 12)
  return btoa(String.fromCharCode(...out))
}

async function decryptSignal(b64: string, sharedSecret: Uint8Array): Promise<string | null> {
  try {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    const iv = bytes.slice(0, 12)
    const ct = bytes.slice(12)
    const key = await crypto.subtle.importKey('raw', sharedSecret.slice(0, 32), { name: 'AES-GCM' }, false, ['decrypt'])
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
    return new TextDecoder().decode(pt)
  } catch { return null }
}

export class CallManager {
  private listenPool: SimplePool | null = null
  private callPool: SimplePool | null = null
  private publishPool: SimplePool | null = null
  private listenSub: { close: () => void } | null = null
  private callSub: { close: () => void } | null = null
  private ephemeralPrivKey: Uint8Array | null = null
  private peer: SimplePeer.Instance | null = null
  private callId: string = ''
  private localStream: MediaStream | null = null
  private state: CallState = 'idle'
  private seenSignals = new Set<string>()
  private signalBuffer: string[] = []
  private listenMyPubKey: string = ''
  private listenSharedSecret: Uint8Array | null = null
  private listenTheirPubKey: string = ''
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private remoteAnalyser: AnalyserNode | null = null
  private voiceActivityTimer: ReturnType<typeof setInterval> | null = null

  onStateChange: ((state: CallState) => void) | null = null
  onRemoteStream: ((stream: MediaStream) => void) | null = null
  onIncomingCall: ((callId: string, from: string) => void) | null = null
  onError: ((err: string) => void) | null = null
  onLocalVolume: ((vol: number) => void) | null = null
  onRemoteVolume: ((vol: number) => void) | null = null

  async listenForCalls(
    myPubKey: string,
    sharedSecret: Uint8Array,
    theirPubKey: string
  ): Promise<void> {
    if (this.listenSub) { this.listenSub.close(); this.listenSub = null }
    if (this.listenPool) { this.listenPool.close(CALL_RELAYS); this.listenPool = null }

    this.listenMyPubKey = myPubKey
    this.listenSharedSecret = sharedSecret
    this.listenTheirPubKey = theirPubKey
    this.seenSignals.clear()
    this.signalBuffer = []
    this.seenSignals.clear()
    this.listenPool = new SimplePool()
    const ringTag = getRingTag(myPubKey, theirPubKey)
    console.log("[CALL] listening for ring on tag:", ringTag, "my:", myPubKey.slice(0,8), "their:", theirPubKey.slice(0,8))
    const filter = { kinds: [CALL_KIND], since: Math.floor(Date.now() / 1000) - 5 }
    ;(filter as Record<string, unknown>)['#t'] = [ringTag]

    this.listenSub = this.listenPool.subscribeMany(
      CALL_RELAYS,
      filter as unknown as Filter,
      {
        onevent: async (event) => {
          try {
            console.log('[CALL] ring listener got event', event.id)
            if (this.seenSignals.has(event.id)) { console.log('[CALL] duplicate, skip'); return }
            this.seenSignals.add(event.id)
            const decrypted = await decryptSignal(event.content, sharedSecret)
            if (!decrypted) { console.log('[CALL] decrypt failed'); return }
            const signal: CallSignal = JSON.parse(decrypted)
            console.log('[CALL] ring signal:', signal.type, 'from:', signal.from.slice(0,8), 'state:', this.state)
            if (signal.from === myPubKey) { console.log('[CALL] own signal, skip'); return }
            if (signal.type !== 'ring') return

            if (this.state === 'calling') {
              if (myPubKey < theirPubKey) {
                console.log('[CALL] mutual call, becoming answerer')
                if (this.peer) { this.peer.destroy(); this.peer = null }
                this.callId = signal.callId
                await this._subscribeToCallSignals(myPubKey, sharedSecret)
                this._createPeer(false, myPubKey, sharedSecret)
              } else {
                console.log('[CALL] mutual call, staying initiator')
              }
            } else if (this.state === 'idle') {
              console.log('[CALL] incoming call received')
              this.callId = signal.callId
              this._setState('receiving')
              this.onIncomingCall?.(signal.callId, signal.from)
            }
          } catch (e) { console.log('[CALL] ring error', e) }
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
    this.callId = crypto.randomUUID()
    this.ephemeralPrivKey = generateSecretKey()
    this.publishPool = new SimplePool()
    this._setState('calling')

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video })
    } catch {
      this.onError?.('Microphone access denied.')
      this._setState('ended')
      return
    }

    this._startVoiceActivity()

    // Subscribe to signals FIRST, then create peer, then ring
    await this._subscribeToCallSignals(myPubKey, sharedSecret)

    // Small delay to let subscription establish
    await new Promise(r => setTimeout(r, 1500))

    this._createPeer(true, myPubKey, sharedSecret)

    // Ring 3 times
    const ringTag = getRingTag(myPubKey, theirPubKey)
    console.log("[CALL] ringing on tag:", ringTag, "my:", myPubKey.slice(0,8), "their:", theirPubKey.slice(0,8))
    for (let i = 0; i < 3; i++) {
      await this._publish(ringTag, sharedSecret, { type: 'ring', callId: this.callId, from: myPubKey })
      await new Promise(r => setTimeout(r, 800))
    }
  }

  async answerCall(
    myPubKey: string,
    theirPubKey: string,
    sharedSecret: Uint8Array,
    callId: string,
    video = false
  ): Promise<void> {
    this.callId = callId
    this.ephemeralPrivKey = generateSecretKey()
    this.publishPool = new SimplePool()

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video })
    } catch {
      this.onError?.('Microphone access denied.')
      this._setState('ended')
      return
    }

    this._startVoiceActivity()
    await this._subscribeToCallSignals(myPubKey, sharedSecret)
    await new Promise(r => setTimeout(r, 500))
    this._createPeer(false, myPubKey, sharedSecret)
  }

  private _createPeer(initiator: boolean, myPubKey: string, sharedSecret: Uint8Array): void {
    this.peer = new SimplePeer({
      initiator,
      stream: this.localStream!,
      trickle: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.cloudflare.com:3478' },
          { urls: 'stun:stun.l.google.com:19302' },
          {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
          {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          }
        ]
      }
    })

    // Replay any buffered signals
    if (this.signalBuffer.length > 0) {
      console.log('[CALL] replaying', this.signalBuffer.length, 'buffered signals')
      const buffered = [...this.signalBuffer]
      this.signalBuffer = []
      setTimeout(() => {
        buffered.forEach(d => { if (this.peer) this.peer!.signal(JSON.parse(d)) })
      }, 100)
    }

    this.peer.on('signal', async (data) => {
      const signalTag = getSignalTag(this.callId)
      const sig: CallSignal = {
        type: data.type === 'offer' ? 'offer' : data.type === 'answer' ? 'answer' : 'ice',
        data: JSON.stringify(data),
        callId: this.callId,
        from: myPubKey
      }
      await this._publish(signalTag, sharedSecret, sig)
    })

    this.peer.on('stream', (stream: MediaStream) => {
      this._attachRemoteVolume(stream)
      this.onRemoteStream?.(stream)
      this._setState('connected')
    })

    this.peer.on('connect', () => this._setState('connected'))
    this.peer.on('error', (err: Error) => { this.onError?.(err.message); this._cleanup() })
    this.peer.on('close', () => this._cleanup())
  }

  private async _subscribeToCallSignals(myPubKey: string, sharedSecret: Uint8Array): Promise<void> {
    if (this.callSub) { this.callSub.close(); this.callSub = null }
    if (this.callPool) { this.callPool.close(CALL_RELAYS); this.callPool = null }

    this.callPool = new SimplePool()
    const signalTag = getSignalTag(this.callId)
    const filter = { kinds: [CALL_KIND], since: Math.floor(Date.now() / 1000) - 5 }
    ;(filter as Record<string, unknown>)['#t'] = [signalTag]

    this.callSub = this.callPool.subscribeMany(
      CALL_RELAYS,
      filter as unknown as Filter,
      {
        onevent: async (event) => {
          try {
            console.log('[CALL] signal listener got event', event.id)
            if (this.seenSignals.has(event.id)) { console.log('[CALL] dup signal'); return }
            this.seenSignals.add(event.id)
            const decrypted = await decryptSignal(event.content, sharedSecret)
            if (!decrypted) { console.log('[CALL] signal decrypt failed'); return }
            const signal: CallSignal = JSON.parse(decrypted)
            console.log('[CALL] signal type:', signal.type, 'peer exists:', !!this.peer)
            if (signal.from === myPubKey) return
            if (signal.callId !== this.callId) { console.log('[CALL] wrong callId'); return }
            if (signal.type === 'hangup') { this._cleanup(); return }
            if (signal.data) {
              if (this.peer) {
                this.peer.signal(JSON.parse(signal.data))
              } else {
                console.log('[CALL] buffering signal, no peer yet')
                this.signalBuffer.push(signal.data)
              }
            }
          } catch (e) { console.log('[CALL] signal error', e) }
        }
      }
    )
  }

  private async _publish(tag: string, sharedSecret: Uint8Array, signal: CallSignal): Promise<void> {
    const privKey = this.ephemeralPrivKey
    if (!privKey) return
    const pool = this.publishPool
    if (!pool) return
    try {
      const encrypted = await encryptSignal(JSON.stringify(signal), sharedSecret)
      const event = finalizeEvent({
        kind: CALL_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['t', tag]],
        content: encrypted,
      }, privKey)
      console.log('[CALL] publishing', signal.type, 'to tag', tag)
      await Promise.any(pool.publish(CALL_RELAYS, event))
      console.log('[CALL] published ok')
    } catch (e) { console.log('[CALL] publish failed', e) }
  }

  private _startVoiceActivity(): void {
    if (!this.localStream) return
    try {
      this.audioContext = new AudioContext()
      const source = this.audioContext.createMediaStreamSource(this.localStream)
      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = 256
      source.connect(this.analyser)
      const data = new Uint8Array(this.analyser.frequencyBinCount)
      this.voiceActivityTimer = setInterval(() => {
        if (!this.analyser) return
        this.analyser.getByteFrequencyData(data)
        const avg = data.reduce((a, b) => a + b, 0) / data.length
        this.onLocalVolume?.(Math.min(100, avg * 3))
      }, 50)
    } catch { /* unavailable */ }
  }

  private _attachRemoteVolume(stream: MediaStream): void {
    if (!this.audioContext) return
    try {
      const source = this.audioContext.createMediaStreamSource(stream)
      this.remoteAnalyser = this.audioContext.createAnalyser()
      this.remoteAnalyser.fftSize = 256
      source.connect(this.remoteAnalyser)
      const data = new Uint8Array(this.remoteAnalyser.frequencyBinCount)
      setInterval(() => {
        if (!this.remoteAnalyser) return
        this.remoteAnalyser.getByteFrequencyData(data)
        const avg = data.reduce((a, b) => a + b, 0) / data.length
        this.onRemoteVolume?.(Math.min(100, avg * 3))
      }, 50)
    } catch { /* unavailable */ }
  }

  async hangup(myPubKey: string, theirPubKey: string, sharedSecret: Uint8Array): Promise<void> {
    if (this.callId && sharedSecret.length > 0) {
      await this._publish(getSignalTag(this.callId), sharedSecret, {
        type: 'hangup', callId: this.callId, from: myPubKey
      })
    }
    this._cleanup()
  }

  stopListening(): void {
    if (this.listenSub) { this.listenSub.close(); this.listenSub = null }
    if (this.listenPool) { this.listenPool.close(CALL_RELAYS); this.listenPool = null }
  }

  private _setState(state: CallState): void {
    this.state = state
    this.onStateChange?.(state)
  }

  private _cleanup(): void {
    if (this.voiceActivityTimer) clearInterval(this.voiceActivityTimer)
    if (this.audioContext) { this.audioContext.close(); this.audioContext = null }
    if (this.peer) { this.peer.destroy(); this.peer = null }
    if (this.callSub) { this.callSub.close(); this.callSub = null }
    if (this.callPool) { this.callPool.close(CALL_RELAYS); this.callPool = null }
    if (this.publishPool) { this.publishPool.close(CALL_RELAYS); this.publishPool = null }
    if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null }
    this.ephemeralPrivKey = null
    this.analyser = null
    this.remoteAnalyser = null
    this.seenSignals.clear()
    this.signalBuffer = []
    this._setState('ended')
    console.log("[CALL] cleanup done, restarting listener in 1.5s, keys:", this.listenMyPubKey.slice(0,8), this.listenTheirPubKey.slice(0,8))
    if (this.listenMyPubKey && this.listenSharedSecret && this.listenTheirPubKey) {
      setTimeout(() => {
        console.log("[CALL] restarting listener now")
        this.seenSignals.clear()
        this.listenForCalls(this.listenMyPubKey, this.listenSharedSecret!, this.listenTheirPubKey)
      }, 1500)
    }
  }

  getLocalStream(): MediaStream | null { return this.localStream }
  getState(): CallState { return this.state }
}
