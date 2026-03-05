'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { generateKeyPair, deriveSharedSecret, exportPrivateKey, importPrivateKey, generateSafetyNumber } from '@/lib/keys'
import { encryptMessage, decryptMessage, encryptFile, decryptFile, loadMessages, saveMessage, clearMessages, StoredMessage } from '@/lib/chat-crypto'
import { P2PChat, P2PMessage as WakuMessage } from '@/lib/p2p'
import Link from 'next/link'

type ConnectionStep = 'identity' | 'exchange' | 'connected'

const wakuClient = new P2PChat()

export default function ChatPage() {
  const [step, setStep] = useState<ConnectionStep>('identity')

  // Identity
  const [myPublicKey, setMyPublicKey] = useState('')
  const [myPrivateKeyRaw, setMyPrivateKeyRaw] = useState('')
  const [theirPublicKey, setTheirPublicKey] = useState('')
  const [sharedSecret, setSharedSecret] = useState<Uint8Array | undefined>()
  const [safetyNumber, setSafetyNumber] = useState('')
  const [safetyVerified, setSafetyVerified] = useState(false)

  // Chat
  const [messages, setMessages] = useState<StoredMessage[]>([])
  const [input, setInput] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [networkStatus, setNetworkStatus] = useState<'offline' | 'connecting' | 'online'>('offline')
  const [log, setLog] = useState<string[]>([])
  const [showSidebar, setShowSidebar] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const addLog = (msg: string) => {
    const time = new Date().toTimeString().slice(0, 8)
    setLog(prev => [`[${time}] ${msg}`, ...prev].slice(0, 20))
  }

  useEffect(() => {
    setMessages(loadMessages())
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleGenerateIdentity = async () => {
    addLog('Generating identity keypair...')
    const pair = await generateKeyPair()
    const privRaw = await exportPrivateKey(pair.privateKey)
    setMyPublicKey(pair.publicKeyRaw)
    setMyPrivateKeyRaw(privRaw)
    addLog('Identity ready. Share your public key.')
    setStep('exchange')
  }

  const handleConnect = async () => {
    if (!theirPublicKey.trim()) return addLog('ERROR: Need their public key.')
    try {
      setConnecting(true)
      setNetworkStatus('connecting')
      addLog('Deriving shared secret...')
      const privateKey = await importPrivateKey(myPrivateKeyRaw)
      const secret = await deriveSharedSecret(privateKey, theirPublicKey.trim())
      const safety = await generateSafetyNumber(myPublicKey, theirPublicKey.trim())
      setSharedSecret(secret)
      setSafetyNumber(safety)

      addLog('Connecting...twork...')
      await wakuClient.connect(
        myPublicKey,
        theirPublicKey.trim(),
        async (wakuMsg: WakuMessage) => {
          if (!secret) return
          const plaintext = await decryptMessage(wakuMsg.ciphertext, secret, wakuMsg.id)
          if (!plaintext) return

          const stored: StoredMessage = {
            id: wakuMsg.id,
            from: wakuMsg.from,
            ciphertext: wakuMsg.ciphertext,
            timestamp: wakuMsg.timestamp,
            type: wakuMsg.type,
            fileName: wakuMsg.fileName,
            mine: false
          }
          saveMessage(stored)
          setMessages(prev => [...prev, { ...stored, _plaintext: plaintext } as StoredMessage & { _plaintext: string }])
        }
      )

      setNetworkStatus('online')
      setStep('connected')
      addLog(`Connected. Channel: ${wakuClient.getChannelId()}`)
      addLog(`Safety number: ${safety}`)
    } catch (e: unknown) {
      addLog(`ERROR: ${e instanceof Error ? e.message : 'Connection failed'}`)
      setNetworkStatus('offline')
    } finally {
      setConnecting(false)
    }
  }

  const handleSend = async () => {
    if (!input.trim() || !sharedSecret) return
    const id = crypto.randomUUID()
    const ciphertext = await encryptMessage(input.trim(), sharedSecret, id)

    const msg: WakuMessage = {
      id,
      from: myPublicKey.slice(0, 16),
      ciphertext,
      timestamp: Date.now(),
      type: 'text'
    }

    try {
      await wakuClient.send(msg)
      const stored: StoredMessage = { ...msg, mine: true }
      saveMessage(stored)
      setMessages(prev => [...prev, { ...stored, _plaintext: input.trim() } as StoredMessage & { _plaintext: string }])
      setInput('')
      inputRef.current?.focus()
    } catch (e: unknown) {
      addLog(`ERROR: Failed to send — ${e instanceof Error ? e.message : 'Unknown'}`)
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f || !sharedSecret) return
    if (f.size > 500 * 1024) return addLog('ERROR: File too large. Max 500KB.')

    addLog(`Encrypting file: ${f.name}...`)
    const buf = await f.arrayBuffer()
    const bytes = new Uint8Array(buf)
    const id = crypto.randomUUID()
    const ciphertext = await encryptFile(bytes, sharedSecret, id)

    const isImage = f.type.startsWith('image/')
    const msg: WakuMessage = {
      id,
      from: myPublicKey.slice(0, 16),
      ciphertext,
      timestamp: Date.now(),
      type: isImage ? 'image' : 'file',
      fileName: f.name
    }

    try {
      await wakuClient.send(msg)
      const stored: StoredMessage = { ...msg, mine: true }
      saveMessage(stored)

      if (isImage) {
        const url = URL.createObjectURL(f)
        setMessages(prev => [...prev, { ...stored, _imageUrl: url } as StoredMessage & { _imageUrl: string }])
      } else {
        setMessages(prev => [...prev, { ...stored, _plaintext: `[file: ${f.name}]` } as StoredMessage & { _plaintext: string }])
      }
      addLog(`Sent: ${f.name}`)
    } catch {
      addLog('ERROR: Failed to send file.')
    }
  }

  const handleDecryptImage = async (msg: StoredMessage) => {
    if (!sharedSecret) return
    const bytes = await decryptFile(msg.ciphertext, sharedSecret, msg.id)
    if (!bytes) return addLog('ERROR: Failed to decrypt image.')
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "image/png" })
    const url = URL.createObjectURL(blob)
    setMessages(prev => prev.map(m =>
      m.id === msg.id ? { ...m, _imageUrl: url } as StoredMessage & { _imageUrl: string } : m
    ))
  }

  const handleDecryptFile = async (msg: StoredMessage) => {
    if (!sharedSecret) return
    const bytes = await decryptFile(msg.ciphertext, sharedSecret, msg.id)
    if (!bytes) return addLog('ERROR: Failed to decrypt file.')
    const blob = new Blob([bytes.buffer as ArrayBuffer])
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = msg.fileName || 'file'
    a.click()
  }

  const handleClearChat = () => {
    clearMessages()
    setMessages([])
    addLog('Chat history cleared.')
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-300 flex flex-col" style={{ fontFamily: 'monospace' }}>

      {/* Header */}
      <div className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
            networkStatus === 'online' ? 'bg-zinc-400' :
            networkStatus === 'connecting' ? 'bg-yellow-500' : 'bg-zinc-700'}`} />
          <span className="text-zinc-500 text-xs tracking-widest uppercase">wspr / chat</span>
          {networkStatus === 'online' && (
            <span className="text-zinc-700 text-xs hidden sm:inline">
              {wakuClient.getChannelId().slice(0, 30)}...
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link href="/app" className="text-zinc-700 hover:text-zinc-400 text-xs transition-all uppercase tracking-widest">
            ← tool
          </Link>
          <button
            onClick={() => setShowSidebar(v => !v)}
            className="text-xs text-zinc-600 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 px-3 py-1 transition-all">
            {showSidebar ? 'HIDE' : 'INFO'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* Main area */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Setup steps */}
          {step !== 'connected' && (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="w-full max-w-md">

                {step === 'identity' && (
                  <div className="flex flex-col gap-4">
                    <p className="text-zinc-600 text-xs uppercase tracking-widest">Step 1 — Identity</p>
                    <p className="text-zinc-500 text-xs leading-relaxed">
                      Generate a keypair. Your public key is your identity — share it with your contact via any channel, ideally inside a wspr image.
                    </p>
                    <button
                      onClick={handleGenerateIdentity}
                      className="border border-zinc-600 text-zinc-300 text-xs py-3 uppercase tracking-widest hover:bg-zinc-900 transition-all">
                      Generate Identity
                    </button>
                  </div>
                )}

                {step === 'exchange' && (
                  <div className="flex flex-col gap-4">
                    <p className="text-zinc-600 text-xs uppercase tracking-widest">Step 2 — Key Exchange</p>

                    <div>
                      <p className="text-zinc-700 text-xs mb-2">Your public key — share this:</p>
                      <div className="bg-zinc-900 border border-zinc-800 p-3">
                        <p className="text-zinc-500 text-xs break-all leading-relaxed">{myPublicKey}</p>
                      </div>
                      <button
                        onClick={() => navigator.clipboard.writeText(myPublicKey)}
                        className="mt-2 w-full text-xs text-zinc-600 hover:text-zinc-400 border border-zinc-800 py-2 transition-all">
                        Copy public key
                      </button>
                    </div>

                    <div>
                      <p className="text-zinc-700 text-xs mb-2">Their public key:</p>
                      <textarea
                        value={theirPublicKey}
                        onChange={e => setTheirPublicKey(e.target.value)}
                        placeholder="Paste their public key..."
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-3 focus:outline-none focus:border-zinc-600 resize-none h-20 placeholder-zinc-800"
                      />
                    </div>

                    <button
                      onClick={handleConnect}
                      disabled={!theirPublicKey.trim() || connecting}
                      className="border border-zinc-400 text-zinc-200 text-xs py-3 uppercase tracking-widest hover:bg-zinc-800 transition-all disabled:opacity-30">
                      {connecting ? 'Connecting...' : 'Connect'}
                    </button>

                    <p className="text-zinc-800 text-xs">
                      Messages route through the Waku decentralized network. No server. No IP exchange. No metadata.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Chat messages */}
          {step === 'connected' && (
            <>
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                {messages.length === 0 && (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-zinc-800 text-xs">No messages yet. Send one.</p>
                  </div>
                )}
                {messages.map((msg) => {
                  const m = msg as StoredMessage & { _plaintext?: string; _imageUrl?: string }
                  return (
                    <div key={msg.id} className={`flex ${msg.mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-xs md:max-w-md lg:max-w-lg border p-3 ${
                        msg.mine ? 'border-zinc-600 bg-zinc-900' : 'border-zinc-800 bg-zinc-950'}`}>

                        {/* Text message */}
                        {msg.type === 'text' && m._plaintext && (
                          <p className="text-zinc-300 text-xs leading-relaxed whitespace-pre-wrap break-words">{m._plaintext}</p>
                        )}

                        {/* Encrypted text not yet decrypted */}
                        {msg.type === 'text' && !m._plaintext && (
                          <p className="text-zinc-700 text-xs">[encrypted]</p>
                        )}

                        {/* Image */}
                        {msg.type === 'image' && m._imageUrl && (
                          <img src={m._imageUrl} alt={msg.fileName} className="max-w-full max-h-48 object-contain" />
                        )}
                        {msg.type === 'image' && !m._imageUrl && (
                          <button
                            onClick={() => handleDecryptImage(msg)}
                            className="text-zinc-600 hover:text-zinc-400 text-xs border border-zinc-800 px-3 py-2 transition-all">
                            Decrypt image: {msg.fileName}
                          </button>
                        )}

                        {/* File */}
                        {msg.type === 'file' && (
                          <button
                            onClick={() => handleDecryptFile(msg)}
                            className="text-zinc-600 hover:text-zinc-400 text-xs border border-zinc-800 px-3 py-2 transition-all">
                            ↓ {msg.fileName}
                          </button>
                        )}

                        <p className="text-zinc-800 text-xs mt-2">
                          {new Date(msg.timestamp).toTimeString().slice(0, 5)}
                          {!msg.mine && ` · ${msg.from.slice(0, 8)}...`}
                        </p>
                      </div>
                    </div>
                  )
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="border-t border-zinc-800 p-3 flex gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="border border-zinc-800 hover:border-zinc-600 text-zinc-600 hover:text-zinc-400 px-3 text-xs transition-all flex-shrink-0">
                  +
                </button>
                <input ref={fileInputRef} type="file" onChange={handleFileSelect} className="hidden" />
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  placeholder="Message..."
                  autoComplete="off"
                  spellCheck={false}
                  rows={1}
                  className="flex-1 bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-2 focus:outline-none focus:border-zinc-600 resize-none placeholder-zinc-800"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="border border-zinc-600 hover:border-zinc-400 text-zinc-300 px-4 text-xs uppercase tracking-widest transition-all disabled:opacity-30 flex-shrink-0">
                  Send
                </button>
              </div>
            </>
          )}
        </div>

        {/* Sidebar */}
        {showSidebar && (
          <div className="w-72 border-l border-zinc-800 flex flex-col overflow-y-auto flex-shrink-0">

            {/* Safety number */}
            {safetyNumber && (
              <div className="border-b border-zinc-800 p-4">
                <p className="text-zinc-600 text-xs uppercase tracking-widest mb-3">Safety Number</p>
                <div className="bg-zinc-900 border border-zinc-800 p-3 mb-3">
                  <p className="text-zinc-300 text-sm tracking-widest font-mono text-center">{safetyNumber}</p>
                </div>
                <p className="text-zinc-700 text-xs mb-3">Verify this matches your contact via a separate channel.</p>
                <button
                  onClick={() => setSafetyVerified(v => !v)}
                  className={`w-full text-xs py-2 border transition-all ${
                    safetyVerified ? 'border-zinc-500 text-zinc-300' : 'border-zinc-800 text-zinc-600 hover:border-zinc-700'}`}>
                  {safetyVerified ? 'Verified ✓' : 'Mark as verified'}
                </button>
                {!safetyVerified && (
                  <p className="text-zinc-700 text-xs mt-2">Unverified channel.</p>
                )}
              </div>
            )}

            {/* Network info */}
            <div className="border-b border-zinc-800 p-4">
              <p className="text-zinc-600 text-xs uppercase tracking-widest mb-3">Network</p>
              <div className="flex flex-col gap-2">
                <div className="flex justify-between">
                  <span className="text-zinc-700 text-xs">Protocol</span>
                  <span className="text-zinc-500 text-xs">Gun.js P2P</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-700 text-xs">Transport</span>
                  <span className="text-zinc-500 text-xs">WebRTC + relay</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-700 text-xs">Status</span>
                  <span className={`text-xs ${networkStatus === 'online' ? 'text-zinc-400' : 'text-zinc-700'}`}>
                    {networkStatus}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-700 text-xs">IP exposed</span>
                  <span className="text-zinc-500 text-xs">No</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-700 text-xs">Encryption</span>
                  <span className="text-zinc-500 text-xs">AES-256-GCM</span>
                </div>
              </div>
            </div>

            {/* Log */}
            <div className="border-b border-zinc-800 p-4 flex-1">
              <p className="text-zinc-600 text-xs uppercase tracking-widest mb-3">Log</p>
              {log.map((entry, i) => (
                <p key={i} className={`text-xs mb-1 ${entry.includes('ERROR') ? 'text-zinc-500' : 'text-zinc-700'}`}>
                  {entry}
                </p>
              ))}
            </div>

            {/* Actions */}
            <div className="p-4">
              <button
                onClick={handleClearChat}
                className="w-full text-xs py-2 border border-zinc-800 text-zinc-600 hover:text-zinc-400 hover:border-zinc-600 transition-all uppercase tracking-widest">
                Clear history
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
