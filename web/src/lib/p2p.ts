// Gun.js P2P transport
// Messages are encrypted before touching Gun — Gun only sees ciphertext
// Gun syncs via WebRTC + public relay peers — no central server for messages

export type P2PMessage = {
  id: string
  from: string
  ciphertext: string
  timestamp: number
  type: 'text' | 'image' | 'file'
  fileName?: string
}

type GunInstance = {
  get: (key: string) => GunNode
}

type GunNode = {
  get: (key: string) => GunNode
  put: (data: unknown) => void
  set: (data: unknown) => void
  map: () => GunNode
  on: (cb: (data: unknown, key: string) => void) => void
  off: () => void
}

function getChannelId(myPubKey: string, theirPubKey: string): string {
  const sorted = [myPubKey, theirPubKey].sort()
  let hash = 0
  const str = sorted[0] + sorted[1]
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) >>> 0
  }
  return `wspr_${hash.toString(16)}`
}

export class P2PChat {
  private gun: GunInstance | null = null
  private channel: GunNode | null = null
  private channelId: string = ''
  private seen = new Set<string>()

  async connect(
    myPubKey: string,
    theirPubKey: string,
    onMessage: (msg: P2PMessage) => void
  ): Promise<void> {
    this.channelId = getChannelId(myPubKey, theirPubKey)

    // Dynamically import Gun (ESM)
    const Gun = (await import('gun')).default

    // Public relay peers — no messages stored, just relayed
    this.gun = new Gun({
      peers: [
        'https://gun-manhattan.herokuapp.com/gun',
        'https://peer.wallie.io/gun',
      ]
    }) as GunInstance

    this.channel = this.gun.get('wspr').get(this.channelId)

    // Listen for incoming messages
    this.channel.map().on((data: unknown) => {
      if (!data || typeof data !== 'object') return
      const msg = data as P2PMessage
      if (!msg.id || !msg.ciphertext) return
      if (this.seen.has(msg.id)) return
      this.seen.add(msg.id)
      onMessage(msg)
    })
  }

  async send(msg: P2PMessage): Promise<void> {
    if (!this.channel) throw new Error('Not connected')
    this.seen.add(msg.id) // Don't echo back to ourselves
    this.channel.get(msg.id).put(msg as unknown as Parameters<GunNode['put']>[0])
  }

  disconnect(): void {
    if (this.channel) this.channel.off()
    this.gun = null
    this.channel = null
    this.seen.clear()
  }

  isConnected(): boolean {
    return this.gun !== null
  }

  getChannelId(): string {
    return this.channelId
  }
}
