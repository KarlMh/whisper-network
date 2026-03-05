export type P2PMessage = {
  id: string
  from: string
  ciphertext: string
  timestamp: number
  type: 'text' | 'image' | 'file'
  fileName?: string
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
  private gun: unknown = null
  private channelId: string = ''
  private seen = new Set<string>()
  private onMessageCb: ((msg: P2PMessage) => void) | null = null

  async connect(
    myPubKey: string,
    theirPubKey: string,
    onMessage: (msg: P2PMessage) => void
  ): Promise<void> {
    this.channelId = getChannelId(myPubKey, theirPubKey)
    this.onMessageCb = onMessage

    const Gun = (await import('gun')).default

    this.gun = new (Gun as new (opts: unknown) => unknown)({
      peers: [
        'https://gun-manhattan.herokuapp.com/gun',
        'https://peer.wallie.io/gun',
        'https://gundb-relay-mlccl.ondigitalocean.app/gun',
        'https://plankton.school/gun',
      ]
    })

    const g = this.gun as { get: (k: string) => unknown }

    // Subscribe to all messages in channel
    const channel = (g.get('wspr') as { get: (k: string) => unknown }).get(this.channelId)
    
    ;(channel as { map: () => { on: (cb: (data: unknown, key: string) => void) => void } })
      .map()
      .on((data: unknown, key: string) => {
        if (!data || typeof data !== 'object') return
        if (key === '_') return
        const msg = data as P2PMessage
        if (!msg.id || !msg.ciphertext || !msg.timestamp) return
        if (this.seen.has(msg.id)) return
        this.seen.add(msg.id)
        if (this.onMessageCb) this.onMessageCb(msg)
      })
  }

  async send(msg: P2PMessage): Promise<void> {
    if (!this.gun) throw new Error('Not connected')
    this.seen.add(msg.id)
    const g = this.gun as { get: (k: string) => unknown }
    const channel = (g.get('wspr') as { get: (k: string) => unknown }).get(this.channelId)
    ;(channel as { get: (k: string) => { put: (d: unknown) => void } })
      .get(msg.id)
      .put(msg)
  }

  disconnect(): void {
    this.gun = null
    this.seen.clear()
    this.onMessageCb = null
  }

  isConnected(): boolean {
    return this.gun !== null
  }

  getChannelId(): string {
    return this.channelId
  }
}
