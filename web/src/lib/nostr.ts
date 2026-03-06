import { generateSecretKey, getPublicKey, finalizeEvent, SimplePool } from 'nostr-tools'
import type { Event, Filter } from 'nostr-tools'

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://nostr.wine',
  'wss://relay.primal.net',
]

const WSPR_KIND = 20001

export type NostrMessage = {
  id: string
  from: string
  ciphertext: string
  timestamp: number
  type: 'text' | 'image' | 'file'
  fileName?: string
}

export type RelayStatus = {
  url: string
  connected: boolean
}

function getChannelTag(myPubKey: string, theirPubKey: string): string {
  const sorted = [myPubKey, theirPubKey].sort()
  let hash = 0
  const str = sorted[0] + sorted[1]
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) >>> 0
  }
  return `wspr_${hash.toString(16)}`
}

export class NostrChat {
  private pool: SimplePool | null = null
  private nostrPrivKey: Uint8Array | null = null
  private nostrPubKey: string = ''
  private channelTag: string = ''
  private seen = new Set<string>()
  private sub: { close: () => void } | null = null
  private onStatusChange: ((status: RelayStatus[]) => void) | null = null
  private relayStatus: Map<string, boolean> = new Map()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectedAt: number = 0
  private onMessageCb: ((msg: NostrMessage) => void) | null = null
  private myPubKey: string = ''
  private theirPubKey: string = ''

  async connect(
    myPubKey: string,
    theirPubKey: string,
    onMessage: (msg: NostrMessage) => void,
    onStatusChange?: (status: RelayStatus[]) => void
  ): Promise<void> {
    this.myPubKey = myPubKey
    this.theirPubKey = theirPubKey
    this.channelTag = getChannelTag(myPubKey, theirPubKey)
    this.onMessageCb = onMessage
    this.onStatusChange = onStatusChange || null

    this.nostrPrivKey = generateSecretKey()
    this.nostrPubKey = getPublicKey(this.nostrPrivKey)

    await this._connectPool()
  }

  private async _connectPool(): Promise<void> {
    if (this.sub) { this.sub.close(); this.sub = null }
    if (this.pool) { this.pool.close(RELAYS); this.pool = null }

    this.pool = new SimplePool()

    // Track relay connectivity by attempting connections
    RELAYS.forEach(url => {
      this.relayStatus.set(url, false)
      const ws = new WebSocket(url)
      ws.onopen = () => {
        this.relayStatus.set(url, true)
        this._emitStatus()
        ws.close()
      }
      ws.onerror = () => {
        this.relayStatus.set(url, false)
        this._emitStatus()
      }
    })

    const filter = {
      kinds: [WSPR_KIND],
      since: this.connectedAt || Math.floor(Date.now() / 1000),
    }
    ;(filter as Record<string, unknown>)['#t'] = [this.channelTag]

    this.sub = this.pool.subscribeMany(
      RELAYS,
      filter as unknown as Filter,
      {
        onevent: (event: Event) => {
          if (this.seen.has(event.id)) return
          this.seen.add(event.id)
          if (event.pubkey === this.nostrPubKey) return
          try {
            const msg: NostrMessage = JSON.parse(event.content)
            if (!msg.id || !msg.ciphertext) return
            if (this.onMessageCb) this.onMessageCb(msg)
          } catch { /* not a wspr message */ }
        },
        onclose: () => {
          // Auto-reconnect after 5 seconds
          if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
          this.reconnectTimer = setTimeout(() => {
            this._connectPool()
          }, 5000)
        }
      }
    )
  }

  private _emitStatus(): void {
    if (!this.onStatusChange) return
    const status: RelayStatus[] = RELAYS.map(url => ({
      url,
      connected: this.relayStatus.get(url) || false
    }))
    this.onStatusChange(status)
  }

  async send(msg: NostrMessage): Promise<void> {
    if (!this.pool || !this.nostrPrivKey) throw new Error('Not connected')
    this.seen.add(msg.id)
    const event = finalizeEvent({
      kind: WSPR_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', this.channelTag]],
      content: JSON.stringify(msg),
    }, this.nostrPrivKey)

    // Try publishing, retry once if fails
    try {
      await Promise.any(this.pool.publish(RELAYS, event))
    } catch {
      await new Promise(r => setTimeout(r, 1000))
      await Promise.any(this.pool.publish(RELAYS, event))
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.sub) this.sub.close()
    if (this.pool) this.pool.close(RELAYS)
    this.pool = null
    this.sub = null
    this.seen.clear()
    this.onMessageCb = null
    this.relayStatus.clear()
  }

  isConnected(): boolean {
    return this.pool !== null
  }

  getChannelTag(): string {
    return this.channelTag
  }

  getRelayStatus(): RelayStatus[] {
    return RELAYS.map(url => ({
      url: url.replace('wss://', ''),
      connected: this.relayStatus.get(url) || false
    }))
  }
}
