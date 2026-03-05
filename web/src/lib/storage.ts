// Persistent storage for wspr chat
// Identity and contacts stored in localStorage
// Messages stored encrypted per channel

export type Contact = {
  id: string
  name: string
  publicKey: string
  addedAt: number
  lastSeen?: number
}

export type StoredIdentity = {
  publicKey: string
  privateKeyRaw: string
  createdAt: number
}

export type StoredMessage = {
  id: string
  from: string
  ciphertext: string
  timestamp: number
  type: 'text' | 'image' | 'file'
  fileName?: string
  mine: boolean
  plaintext?: string // cached plaintext for own messages
}

// Keys
const IDENTITY_KEY = 'wspr_identity'
const getContactsKey = (myPubKey: string) => `wspr_contacts_${myPubKey.slice(0, 16)}`
const MESSAGES_PREFIX = 'wspr_msgs_'
const MAX_MESSAGES = 500

// Identity
export function saveIdentity(identity: StoredIdentity): void {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity))
}

export function loadIdentity(): StoredIdentity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function clearIdentity(): void {
  localStorage.removeItem(IDENTITY_KEY)
}

// Contacts
export function loadContacts(myPubKey = ''): Contact[] {
  try {
    const raw = localStorage.getItem(getContactsKey(myPubKey))
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveContact(contact: Contact, myPubKey = ''): void {
  const contacts = loadContacts(myPubKey)
  const existing = contacts.findIndex(c => c.publicKey === contact.publicKey)
  if (existing >= 0) {
    contacts[existing] = contact
  } else {
    contacts.push(contact)
  }
  localStorage.setItem(getContactsKey(myPubKey), JSON.stringify(contacts))
}

export function deleteContact(id: string, myPubKey = ''): void {
  const contacts = loadContacts(myPubKey).filter(c => c.id !== id)
  localStorage.setItem(getContactsKey(myPubKey), JSON.stringify(contacts))
}

export function updateContactLastSeen(publicKey: string, myPubKey = ''): void {
  const contacts = loadContacts(myPubKey)
  const contact = contacts.find(c => c.publicKey === publicKey)
  if (contact) {
    contact.lastSeen = Date.now()
    localStorage.setItem(getContactsKey(myPubKey), JSON.stringify(contacts))
  }
}

// Messages per channel
function channelKey(myPubKey: string, theirPubKey: string): string {
  const sorted = [myPubKey, theirPubKey].sort()
  let hash = 0
  const str = sorted[0] + sorted[1]
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) >>> 0
  }
  return `${MESSAGES_PREFIX}${hash.toString(16)}`
}

export function loadChannelMessages(myPubKey: string, theirPubKey: string): StoredMessage[] {
  try {
    const raw = localStorage.getItem(channelKey(myPubKey, theirPubKey))
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveChannelMessage(myPubKey: string, theirPubKey: string, msg: StoredMessage): void {
  const msgs = loadChannelMessages(myPubKey, theirPubKey)
  if (msgs.find(m => m.id === msg.id)) return // dedupe
  msgs.push(msg)
  const trimmed = msgs.slice(-MAX_MESSAGES)
  localStorage.setItem(channelKey(myPubKey, theirPubKey), JSON.stringify(trimmed))
}

export function clearChannelMessages(myPubKey: string, theirPubKey: string): void {
  localStorage.removeItem(channelKey(myPubKey, theirPubKey))
}

// Nostr cross-device sync — export identity + contacts as JSON
export function exportProfile(): string {
  const identity = loadIdentity()
  const contacts = loadContacts()
  return JSON.stringify({ identity, contacts, exportedAt: Date.now() })
}

export function importProfile(json: string): boolean {
  try {
    const data = JSON.parse(json)
    if (data.identity) saveIdentity(data.identity)
    if (data.contacts) {
      for (const c of data.contacts) saveContact(c)
    }
    return true
  } catch { return false }
}
