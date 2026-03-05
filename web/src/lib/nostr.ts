import { generateSecretKey, getPublicKey, finalizeEvent, SimplePool } from 'nostr-tools'
import type { Event } from 'nostr-tools'

// Nostr relays — all open source, community run, no single point of control
const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://offchain.pub',
]

// Custom event kind in the ephemeral range — not stored permanently by relays
const WSPR_KIND = 20001

export type NostrMessage = {
  id: string
  from: string
  ciphertext: string
  timestamp: number
  type: 'text' | 'image' | 'file'
  fileName?: string
}

// Derive a deterministic Nostr channel tag from both pubkeys
// Both parties compute the same tag — messages are found by filtering this tag
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

  async connect(
    myPubKey: string,
    theirPubKey: string,
    onMessage: (msg: NostrMessage) => void
  ): Promise<void> {
    this.channelTag = getChannelTag(myPubKey, theirPubKey)

    // Generate a fresh Nostr keypair for this session
    // This is separate from the ECDH keypair — just for Nostr identity
    // The actual message content is encrypted with the ECDH shared secret
    this.nostrPrivKey = generateSecretKey()
    this.nostrPubKey = getPublicKey(this.nostrPrivKey)

    this.pool = new SimplePool()

    // Subscribe to messages on our channel tag
    this.sub = this.pool.subscribeMany(
      RELAYS,
      [
        {
          kinds: [WSPR_KIND],
          '#t': [this.channelTag],
          since: Math.floor(Date.now() / 1000) - 60, // Last 60 seconds on connect
        }
      ],
      {
        onevent: (event: Event) => {
          if (this.seen.has(event.id)) return
          this.seen.add(event.id)
          try {
            const msg: NostrMessage = JSON.parse(event.content)
            if (!msg.id || !msg.ciphertext) return
            onMessage(msg)
          } catch {
            // Not a wspr message
          }
        }
      }
    )
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

    await Promise.any(this.pool.publish(RELAYS, event))
  }

  disconnect(): void {
    if (this.sub) this.sub.close()
    if (this.pool) this.pool.close(RELAYS)
    this.pool = null
    this.sub = null
    this.seen.clear()
  }

  isConnected(): boolean {
    return this.pool !== null
  }

  getChannelTag(): string {
    return this.channelTag
  }
}
