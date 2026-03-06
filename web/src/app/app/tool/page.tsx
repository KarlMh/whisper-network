'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { encodeV2, decodeV2 } from '@/lib/stegv2'
import { encryptToBytes, decryptFromBytes, getTimeWindow } from '@/lib/crypto'
import { stripExif } from '@/lib/exif'
import { deriveSharedSecret, importPrivateKey, generateSafetyNumber } from '@/lib/keys'
import { decryptIdentity, readFileAsBytes, setSessionIdentity, getSessionIdentity, type Identity } from '@/lib/identity'
import Link from 'next/link'

type Step = 'identity' | 'exchange' | 'ready'

export default function ToolPage() {
  const [step, setStep] = useState<Step>('identity')

  // Identity unlock
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [pendingFile, setPendingFile] = useState<Uint8Array | null>(null)
  const [pendingFileName, setPendingFileName] = useState('')
  const [unlockPassword, setUnlockPassword] = useState('')
  const [unlockError, setUnlockError] = useState('')
  const [unlockLoading, setUnlockLoading] = useState(false)

  // ECDH exchange
  const [theirPublicKey, setTheirPublicKey] = useState('')
  const [sharedSecret, setSharedSecret] = useState<Uint8Array | undefined>()
  const [safetyNumber, setSafetyNumber] = useState('')
  const [safetyVerified, setSafetyVerified] = useState(false)

  // Tool state
  const [fileStatus, setFileStatus] = useState<'none' | 'loading' | 'ready'>('none')
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [imageDims, setImageDims] = useState({ w: 0, h: 0 })
  const [message, setMessage] = useState('')
  const [outputName, setOutputName] = useState('')
  const [decoded, setDecoded] = useState('')
  const [intact, setIntact] = useState<boolean | null>(null)
  const [decodedVisible, setDecodedVisible] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [status, setStatus] = useState<'idle' | 'ready' | 'processing' | 'done'>('idle')
  const [timeWindow, setTimeWindow] = useState<{ expiresIn: number } | null>(null)
  const [mobileTab, setMobileTab] = useState<'settings' | 'output'>('settings')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const wsprFileInputRef = useRef<HTMLInputElement>(null)
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const update = () => setTimeWindow(getTimeWindow())
    update()
    const interval = setInterval(update, 30000)
    return () => clearInterval(interval)
  }, [])

  // Check session identity on mount
  useEffect(() => {
    const session = getSessionIdentity()
    if (session) {
      setIdentity(session)
      setStep('exchange')
    }
  }, [])

  const addLog = (msg: string) => {
    const time = new Date().toTimeString().slice(0, 8)
    setLog(prev => [`[${time}] ${msg}`, ...prev].slice(0, 10))
  }

  const clearAll = useCallback(() => {
    setFileStatus('none')
    setFileName('')
    setFileSize(0)
    setImageDims({ w: 0, h: 0 })
    setMessage('')
    setOutputName('')
    setDecoded('')
    setIntact(null)
    setDecodedVisible(false)
    setLog([])
    setStatus('idle')
    if (fileInputRef.current) fileInputRef.current.value = ''
    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')
      ctx?.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [])

  useEffect(() => {
    let lastEsc = 0
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const now = Date.now()
        if (now - lastEsc < 1000) clearAll()
        lastEsc = now
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [clearAll])

  useEffect(() => {
    const reset = () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
      inactivityTimer.current = setTimeout(clearAll, 5 * 60 * 1000)
    }
    window.addEventListener('mousemove', reset)
    window.addEventListener('keydown', reset)
    reset()
    return () => {
      window.removeEventListener('mousemove', reset)
      window.removeEventListener('keydown', reset)
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    }
  }, [clearAll])

  const handleWsprFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const bytes = await readFileAsBytes(f)
    setPendingFile(bytes)
    setPendingFileName(f.name)
  }

  const handleUnlock = async () => {
    if (!pendingFile) return setUnlockError('Select a .wspr file first.')
    if (!unlockPassword.trim()) return setUnlockError('Password required.')
    setUnlockLoading(true)
    setUnlockError('')
    try {
      const id = await decryptIdentity(pendingFile, unlockPassword)
      if (!id) return setUnlockError('Wrong password or invalid file.')
      setSessionIdentity(id)
      setIdentity(id)
      setStep('exchange')
      addLog('Identity loaded.')
    } catch {
      setUnlockError('Failed to unlock.')
    } finally {
      setUnlockLoading(false)
    }
  }

  const handleConnect = async () => {
    if (!identity || !theirPublicKey.trim()) return
    try {
      addLog('Deriving shared secret...')
      const privateKey = await importPrivateKey(identity.privateKeyRaw)
      const secret = await deriveSharedSecret(privateKey, theirPublicKey.trim())
      const safety = await generateSafetyNumber(identity.publicKey, theirPublicKey.trim())
      setSharedSecret(secret)
      setSafetyNumber(safety)
      addLog('Connection established. Verify safety number.')
    } catch {
      addLog('ERROR: Invalid public key.')
    }
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFileStatus('loading')
    setDecoded('')
    setIntact(null)
    const img = new Image()
    img.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0)
      setFileName(f.name)
      setFileSize(f.size)
      setImageDims({ w: img.width, h: img.height })
      setOutputName(f.name.replace(/\.[^.]+$/, ''))
      setFileStatus('ready')
      setStatus('ready')
      addLog(`Loaded: ${f.name} — ${img.width}x${img.height}`)
    }
    img.onerror = () => { setFileStatus('none'); addLog('ERROR: Failed to load image.') }
    img.src = URL.createObjectURL(f)
  }

  // Safety number is the password — this binds decryption to the verified connection
  const getKey = () => safetyNumber

  const getScatterKey = (): Uint8Array => sharedSecret!

  const handleEncode = async () => {
    if (!message.trim()) return addLog('ERROR: No payload.')
    if (!sharedSecret || !safetyNumber) return addLog('ERROR: No connection.')
    if (!safetyVerified) return addLog('ERROR: Verify safety number first.')
    const canvas = canvasRef.current
    if (!canvas || fileStatus !== 'ready') return addLog('ERROR: No image loaded.')

    setStatus('processing')
    addLog('Encrypting...')
    try {
      // Encrypt using safety number as password + shared secret as key material
      const cipherBytes = await encryptToBytes(message.trim(), getKey(), undefined, sharedSecret)
      addLog('Encoding...')
      const ctx = canvas.getContext('2d')!
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const encoded = encodeV2(imageData, cipherBytes, getScatterKey())
      ctx.putImageData(encoded, 0, 0)
      addLog('Stripping metadata...')
      const blob = await stripExif(canvas)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = (outputName.trim() || 'image') + '.png'
      a.click()
      setMessage('')
      addLog(`Saved. Window: ${timeWindow?.expiresIn ?? '?'}m`)
      setStatus('done')
    } catch (e: unknown) {
      addLog(`ERROR: ${e instanceof Error ? e.message : 'Unknown'}`)
      setStatus('ready')
    }
  }

  const handleDecode = async () => {
    if (!sharedSecret || !safetyNumber) return addLog('ERROR: No connection.')
    const canvas = canvasRef.current
    if (!canvas || fileStatus !== 'ready') return addLog('ERROR: No image loaded.')

    setStatus('processing')
    addLog('Extracting...')
    try {
      const ctx = canvas.getContext('2d')!
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const cipherBytes = decodeV2(imageData, getScatterKey())
      if (cipherBytes) {
        const result = await decryptFromBytes(cipherBytes, getKey(), undefined, sharedSecret)
        if (result && result.message.trim().length > 0) {
          setDecoded(result.message)
          setIntact(result.intact)
          setDecodedVisible(true)
          setTimeout(() => setDecodedVisible(false), 30000)
          setMobileTab('output')
          addLog(result.intact ? 'Done. Integrity verified.' : 'Done. WARNING: Integrity check failed.')
          setStatus('done')
          return
        }
      }
      addLog('No data found.')
      setStatus('ready')
    } catch {
      addLog('No data found.')
      setStatus('ready')
    }
  }

  const isEncodeMode = message.trim().length > 0
  const capacity = Math.floor((imageDims.w * imageDims.h) / 8)
  const capacityUsed = capacity > 0 ? Math.min(100, (message.length / capacity) * 100) : 0

  // ── IDENTITY STEP ──────────────────────────────────────────────────────────
  if (step === 'identity') return (
    <main className="min-h-screen bg-zinc-950 text-zinc-300 flex flex-col" style={{ fontFamily: 'monospace' }}>
      <div className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <span className="text-zinc-500 text-xs tracking-widest uppercase">wspr / tool</span>
        <Link href="/app" className="text-zinc-700 hover:text-zinc-400 text-xs transition-all uppercase tracking-widest">← back</Link>
      </div>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm flex flex-col gap-4">
          <p className="text-zinc-600 text-xs uppercase tracking-widest">Load Identity</p>
          <p className="text-zinc-700 text-xs leading-relaxed">
            The tool uses your <span className="text-zinc-500">.wspr</span> identity for ECDH key exchange. Load the same file you use for chat.
          </p>
          <label className={`block border p-4 cursor-pointer text-center transition-all ${
            pendingFile ? 'border-zinc-600 bg-zinc-900' : 'border-zinc-800 hover:border-zinc-700'}`}>
            <span className="text-zinc-500 text-xs">{pendingFileName || 'Select .wspr file'}</span>
            <input type="file" accept=".wspr" onChange={handleWsprFile} className="hidden" />
          </label>
          <input type="password" value={unlockPassword} onChange={e => setUnlockPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleUnlock()}
            placeholder="Password"
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-3 focus:outline-none focus:border-zinc-600 placeholder-zinc-800" />
          {unlockError && <p className="text-zinc-500 text-xs">{unlockError}</p>}
          <button onClick={handleUnlock} disabled={unlockLoading || !pendingFile || !unlockPassword}
            className="border border-zinc-600 text-zinc-300 text-xs py-3 uppercase tracking-widest hover:bg-zinc-900 transition-all disabled:opacity-30">
            {unlockLoading ? 'Unlocking...' : 'Unlock'}
          </button>
        </div>
      </div>
    </main>
  )

  // ── EXCHANGE STEP ──────────────────────────────────────────────────────────
  if (step === 'exchange' && !safetyNumber) return (
    <main className="min-h-screen bg-zinc-950 text-zinc-300 flex flex-col" style={{ fontFamily: 'monospace' }}>
      <div className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <span className="text-zinc-500 text-xs tracking-widest uppercase">wspr / tool</span>
        <Link href="/app" className="text-zinc-700 hover:text-zinc-400 text-xs transition-all uppercase tracking-widest">← back</Link>
      </div>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm flex flex-col gap-4">
          <p className="text-zinc-600 text-xs uppercase tracking-widest">Key Exchange</p>
          <p className="text-zinc-700 text-xs leading-relaxed">
            Share your public key with the recipient. Enter theirs to establish a connection. The safety number that appears is also the decryption key — verify it out of band.
          </p>
          <div>
            <p className="text-zinc-700 text-xs mb-2">Your public key:</p>
            <div className="bg-zinc-900 border border-zinc-800 p-3 mb-2">
              <p className="text-zinc-500 text-xs break-all leading-relaxed">{identity?.publicKey}</p>
            </div>
            <button onClick={() => navigator.clipboard.writeText(identity?.publicKey || '')}
              className="w-full text-xs text-zinc-600 hover:text-zinc-400 border border-zinc-800 py-2 transition-all">
              Copy public key
            </button>
          </div>
          <div>
            <p className="text-zinc-700 text-xs mb-2">Their public key:</p>
            <textarea value={theirPublicKey} onChange={e => setTheirPublicKey(e.target.value)}
              placeholder="Paste their public key..." autoComplete="off" spellCheck={false}
              className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-3 focus:outline-none focus:border-zinc-600 resize-none h-20 placeholder-zinc-800" />
          </div>
          <button onClick={handleConnect} disabled={!theirPublicKey.trim()}
            className="border border-zinc-600 text-zinc-300 text-xs py-3 uppercase tracking-widest hover:bg-zinc-900 transition-all disabled:opacity-30">
            Connect
          </button>
        </div>
      </div>
    </main>
  )

  // ── SAFETY NUMBER VERIFICATION ─────────────────────────────────────────────
  if (safetyNumber && !safetyVerified) return (
    <main className="min-h-screen bg-zinc-950 text-zinc-300 flex flex-col" style={{ fontFamily: 'monospace' }}>
      <div className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <span className="text-zinc-500 text-xs tracking-widest uppercase">wspr / tool</span>
        <Link href="/app" className="text-zinc-700 hover:text-zinc-400 text-xs transition-all uppercase tracking-widest">← back</Link>
      </div>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm flex flex-col gap-6">
          <p className="text-zinc-600 text-xs uppercase tracking-widest">Verify Safety Number</p>
          <p className="text-zinc-700 text-xs leading-relaxed">
            This number must match on both devices. Verify it via a separate channel — phone call, in person, or through a different app. This number is also the decryption key.
          </p>
          <div className="bg-zinc-900 border border-zinc-800 p-6">
            <p className="text-zinc-300 text-xl tracking-widest font-mono text-center leading-relaxed">{safetyNumber}</p>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-zinc-700 text-xs text-center">Does this match your contact's safety number?</p>
            <button onClick={() => { setSafetyVerified(true); setStep('ready'); addLog('Safety number verified. Ready.') }}
              className="border border-zinc-400 text-zinc-200 text-xs py-3 uppercase tracking-widest hover:bg-zinc-800 transition-all">
              Yes — numbers match
            </button>
            <button onClick={() => { setTheirPublicKey(''); setSharedSecret(undefined); setSafetyNumber('') }}
              className="border border-zinc-800 text-zinc-600 text-xs py-3 uppercase tracking-widest hover:border-zinc-600 transition-all">
              No — start over
            </button>
          </div>
          <p className="text-zinc-800 text-xs text-center">If the numbers don't match, someone may be intercepting your connection.</p>
        </div>
      </div>
    </main>
  )

  // ── MAIN TOOL ──────────────────────────────────────────────────────────────
  const LeftPanel = (
    <div className="flex flex-col">
      <div className="border-b border-zinc-800 p-4">
        <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">Connection</p>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-zinc-400" />
          <span className="text-zinc-400 text-xs">Verified — {safetyNumber.slice(0, 10)}...</span>
        </div>
        <p className="text-zinc-700 text-xs">{theirPublicKey.slice(0, 32)}...</p>
        <button onClick={() => { setSafetyVerified(false); setSafetyNumber(''); setSharedSecret(undefined); setTheirPublicKey(''); setStep('exchange') }}
          className="mt-2 text-xs text-zinc-700 hover:text-zinc-500 border border-zinc-900 hover:border-zinc-700 px-3 py-1 transition-all">
          Disconnect
        </button>
      </div>

      <div className="border-b border-zinc-800 p-4">
        <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">Input Image</p>
        <label className={`block border p-4 cursor-pointer transition-all text-center
          ${fileStatus === 'ready' ? 'border-zinc-600 bg-zinc-900' :
            fileStatus === 'loading' ? 'border-zinc-700' : 'border-zinc-800 hover:border-zinc-700'}`}>
          {fileStatus === 'none' && <span className="text-zinc-600 text-xs">Select PNG file</span>}
          {fileStatus === 'loading' && <span className="text-zinc-500 text-xs">Loading...</span>}
          {fileStatus === 'ready' && (
            <div>
              <span className="text-zinc-400 text-xs block truncate">{fileName}</span>
              <span className="text-zinc-600 text-xs">{imageDims.w}x{imageDims.h} — {(fileSize / 1024).toFixed(1)} KB</span>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/png" onChange={handleFile} className="hidden" />
        </label>
      </div>

      <div className="border-b border-zinc-800 p-4">
        <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">
          Payload <span className="text-zinc-800 normal-case">(leave empty to decode)</span>
        </p>
        <textarea value={message} onChange={e => setMessage(e.target.value)}
          placeholder="Type to encode. Leave empty to decode."
          autoComplete="off" spellCheck={false}
          className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-3 focus:outline-none focus:border-zinc-600 resize-none h-28 placeholder-zinc-800" />
      </div>

      <div className="border-b border-zinc-800 p-4">
        <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">Output Filename</p>
        <div className="flex items-center gap-1">
          <input type="text" value={outputName} onChange={e => setOutputName(e.target.value)}
            autoComplete="off"
            className="flex-1 bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-3 focus:outline-none focus:border-zinc-600" />
          <span className="text-zinc-700 text-xs">.png</span>
        </div>
      </div>

      <div className="p-4 flex gap-2">
        <button onClick={handleDecode}
          disabled={status === 'processing' || fileStatus !== 'ready'}
          className="flex-1 py-3 text-xs uppercase tracking-widest border border-zinc-700 text-zinc-400 hover:bg-zinc-900 transition-all disabled:opacity-30">
          Decode
        </button>
        <button onClick={handleEncode}
          disabled={status === 'processing' || !isEncodeMode || fileStatus !== 'ready'}
          className="flex-1 py-3 text-xs uppercase tracking-widest border border-zinc-400 text-zinc-200 hover:bg-zinc-800 transition-all disabled:opacity-30">
          {status === 'processing' ? 'Working...' : 'Encode'}
        </button>
      </div>
    </div>
  )

  const RightPanel = (
    <div className="flex flex-col h-full">
      <div className="flex-1 p-6 border-b border-zinc-800 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <p className="text-zinc-600 text-xs uppercase tracking-widest">Output</p>
          {decoded && (
            <button
              onMouseDown={() => setDecodedVisible(true)}
              onMouseUp={() => setDecodedVisible(false)}
              onTouchStart={() => setDecodedVisible(true)}
              onTouchEnd={() => setDecodedVisible(false)}
              className="text-zinc-700 text-xs hover:text-zinc-500 border border-zinc-800 px-2 py-1 select-none">
              hold to reveal
            </button>
          )}
        </div>
        {decoded ? (
          <div className={`border bg-zinc-900 p-4 ${intact === false ? 'border-red-900' : 'border-zinc-800'}`}>
            {intact !== null && (
              <p className={`text-xs mb-3 uppercase tracking-widest ${intact ? 'text-zinc-700' : 'text-red-800'}`}>
                {intact ? 'integrity verified' : 'warning: possible tampering'}
              </p>
            )}
            <p className={`text-zinc-300 text-xs leading-relaxed whitespace-pre-wrap break-words transition-all duration-500 select-none ${decodedVisible ? '' : 'blur-md'}`}>
              {decoded}
            </p>
            {!decodedVisible && <p className="text-zinc-700 text-xs text-center mt-3 select-none">Hold to reveal</p>}
          </div>
        ) : (
          <p className="text-zinc-800 text-xs">—</p>
        )}
      </div>

      <div className="border-b border-zinc-800 px-6 py-3">
        <div className="flex justify-between text-xs text-zinc-600 mb-1">
          <span>Capacity</span>
          <span>{message.length} / ~{capacity} chars{fileStatus !== 'ready' && ' (load image)'}</span>
        </div>
        <div className="w-full bg-zinc-900 h-px">
          <div className={`h-px transition-all ${capacityUsed > 90 ? 'bg-red-800' : 'bg-zinc-600'}`}
            style={{ width: `${capacityUsed}%` }} />
        </div>
      </div>

      <div className="p-4 overflow-y-auto" style={{ maxHeight: '12rem' }}>
        <p className="text-zinc-700 text-xs uppercase tracking-widest mb-2">Log</p>
        {log.length === 0 && <p className="text-zinc-800 text-xs">Awaiting input.</p>}
        {log.map((entry, i) => (
          <p key={i} className={`text-xs mb-1 ${entry.includes('ERROR') || entry.includes('WARNING') ? 'text-zinc-500' : 'text-zinc-600'}`}>
            {entry}
          </p>
        ))}
      </div>
    </div>
  )

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-300 flex flex-col" style={{ fontFamily: 'monospace' }}>
      <div className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full transition-colors flex-shrink-0 ${
            status === 'processing' ? 'bg-yellow-500' :
            status === 'done' ? 'bg-zinc-400' : 'bg-zinc-600'}`} />
          <span className="text-zinc-500 text-xs tracking-widest uppercase">wspr / tool</span>
        </div>
        <div className="flex items-center gap-3">
          {timeWindow && (
            <span className={`text-xs hidden sm:inline ${timeWindow.expiresIn <= 10 ? 'text-zinc-500' : 'text-zinc-700'}`}>
              {timeWindow.expiresIn}m
            </span>
          )}
          <Link href="/app" className="text-zinc-700 hover:text-zinc-400 text-xs transition-all uppercase tracking-widest">← back</Link>
          <button onClick={clearAll}
            className="text-xs text-zinc-600 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 px-3 py-1 transition-all">
            CLEAR
          </button>
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden md:flex flex-1 overflow-hidden">
        <div className="w-96 border-r border-zinc-800 overflow-y-auto flex-shrink-0">{LeftPanel}</div>
        <div className="flex-1 flex flex-col min-w-0">{RightPanel}</div>
      </div>

      {/* Mobile */}
      <div className="flex md:hidden flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {mobileTab === 'settings' ? LeftPanel : RightPanel}
        </div>
        <div className="border-t border-zinc-800 flex">
          {(['settings', 'output'] as const).map(tab => (
            <button key={tab} onClick={() => setMobileTab(tab)}
              className={`flex-1 py-3 text-xs uppercase tracking-widest transition-all relative ${
                mobileTab === tab ? 'text-zinc-300 border-t border-zinc-400 -mt-px' : 'text-zinc-600'}`}>
              {tab}
              {tab === 'output' && decoded && mobileTab !== 'output' && (
                <span className="absolute top-2 right-6 w-1.5 h-1.5 bg-zinc-400 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="hidden md:flex border-t border-zinc-800 px-6 py-2 items-center justify-between">
        <span className="text-zinc-700 text-xs">
          {status === 'idle' && 'Ready'}
          {status === 'ready' && 'Loaded'}
          {status === 'processing' && 'Processing...'}
          {status === 'done' && 'Done'}
        </span>
        <span className="text-zinc-800 text-xs">AES-256-GCM / ECDH / LSB-hardened</span>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </main>
  )
}
