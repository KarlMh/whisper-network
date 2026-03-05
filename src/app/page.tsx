'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { encodeV2, decodeV2 } from '@/lib/stegv2'
import { generateCarrier, decodeCarrier, getGenerativeCapacity } from '@/lib/gencarrier'
import { encrypt, decryptString, encryptToBytes, decryptFromBytes, getTimeWindow } from '@/lib/crypto'
import { stripExif } from '@/lib/exif'
import { generateKeyPair, deriveSharedSecret, exportPrivateKey, importPrivateKey, generateSafetyNumber } from '@/lib/keys'
import { encodeAudio, decodeAudio, getAudioCapacity } from '@/lib/audio'

type KeyMode = 'password' | 'keyfile' | 'ecdh'
type CarrierMode = 'image' | 'image-gen' | 'audio'
type MobileTab = 'settings' | 'output'

export default function Home() {
  const [fileStatus, setFileStatus] = useState<'none' | 'loading' | 'ready'>('none')
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [imageDims, setImageDims] = useState({ w: 0, h: 0 })
  const [carrierMode, setCarrierMode] = useState<CarrierMode>('image')
  const [mobileTab, setMobileTab] = useState<MobileTab>('settings')

  const [keyMode, setKeyMode] = useState<KeyMode>('password')
  const [password, setPassword] = useState('')
  const [keyfile, setKeyfile] = useState<Uint8Array | undefined>()
  const [keyfileName, setKeyfileName] = useState('')

  const [myPublicKey, setMyPublicKey] = useState('')
  const [myPrivateKeyRaw, setMyPrivateKeyRaw] = useState('')
  const [theirPublicKey, setTheirPublicKey] = useState('')
  const [sharedSecret, setSharedSecret] = useState<Uint8Array | undefined>()
  const [ecdhStatus, setEcdhStatus] = useState<'idle' | 'generated' | 'connected'>('idle')
  const [safetyNumber, setSafetyNumber] = useState('')
  const [safetyVerified, setSafetyVerified] = useState(false)

  const [decoyPassword, setDecoyPassword] = useState('')
  const [decoyKeyfile, setDecoyKeyfile] = useState<Uint8Array | undefined>()
  const [decoyKeyfileName, setDecoyKeyfileName] = useState('')
  const [decoyMessage, setDecoyMessage] = useState('')
  const [showDecoy, setShowDecoy] = useState(false)

  const [message, setMessage] = useState('')
  const [outputName, setOutputName] = useState('')

  const [decoded, setDecoded] = useState('')
  const [intact, setIntact] = useState<boolean | null>(null)
  const [decodedVisible, setDecodedVisible] = useState(false)
  const [blurTimer, setBlurTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  const [log, setLog] = useState<string[]>([])
  const [status, setStatus] = useState<'idle' | 'ready' | 'processing' | 'done' | 'cleared'>('idle')
  const [timeWindow, setTimeWindow] = useState<{ current: string; expiresIn: number } | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const keyfileInputRef = useRef<HTMLInputElement>(null)
  const decoyKeyfileInputRef = useRef<HTMLInputElement>(null)
  const audioBufferRef = useRef<ArrayBuffer | null>(null)
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const addLog = (msg: string) => {
    const time = new Date().toTimeString().slice(0, 8)
    setLog(prev => [`[${time}] ${msg}`, ...prev].slice(0, 10))
  }

  const clearAll = useCallback(() => {
    setFileStatus('none')
    setFileName('')
    setFileSize(0)
    setImageDims({ w: 0, h: 0 })
    setCarrierMode('image')
    setPassword('')
    setKeyfile(undefined)
    setKeyfileName('')
    setKeyMode('password')
    setMyPublicKey('')
    setMyPrivateKeyRaw('')
    setTheirPublicKey('')
    setSharedSecret(undefined)
    setEcdhStatus('idle')
    setSafetyNumber('')
    setSafetyVerified(false)
    setDecoyPassword('')
    setDecoyKeyfile(undefined)
    setDecoyKeyfileName('')
    setDecoyMessage('')
    setShowDecoy(false)
    setMessage('')
    setOutputName('')
    setDecoded('')
    setIntact(null)
    setDecodedVisible(false)
    setLog([])
    setStatus('cleared')
    setShowPreview(false)
    setMobileTab('settings')
    audioBufferRef.current = null
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (keyfileInputRef.current) keyfileInputRef.current.value = ''
    if (decoyKeyfileInputRef.current) decoyKeyfileInputRef.current.value = ''
    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')
      ctx?.clearRect(0, 0, canvas.width, canvas.height)
      canvas.width = 0
      canvas.height = 0
    }
    setTimeout(() => setStatus('idle'), 2000)
  }, [])

  useEffect(() => {
    const update = () => setTimeWindow(getTimeWindow())
    update()
    const interval = setInterval(update, 30000)
    return () => clearInterval(interval)
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

  const handleGenerateKeyPair = async () => {
    addLog('Generating keypair...')
    const pair = await generateKeyPair()
    const privRaw = await exportPrivateKey(pair.privateKey)
    setMyPublicKey(pair.publicKeyRaw)
    setMyPrivateKeyRaw(privRaw)
    setEcdhStatus('generated')
    addLog('Keypair generated. Share your public key.')
  }

  const handleDeriveSecret = async () => {
    if (!myPrivateKeyRaw || !theirPublicKey.trim()) return addLog('ERROR: Need both keys.')
    try {
      addLog('Deriving shared secret...')
      const privateKey = await importPrivateKey(myPrivateKeyRaw)
      const secret = await deriveSharedSecret(privateKey, theirPublicKey.trim())
      const safety = await generateSafetyNumber(myPublicKey, theirPublicKey.trim())
      setSharedSecret(secret)
      setSafetyNumber(safety)
      setEcdhStatus('connected')
      addLog('Channel established. Verify safety number out of band.')
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
    setLog([])

    if (carrierMode === 'audio') {
      const reader = new FileReader()
      reader.onload = () => {
        audioBufferRef.current = reader.result as ArrayBuffer
        setFileName(f.name)
        setFileSize(f.size)
        setOutputName(f.name.replace(/\.[^.]+$/, ''))
        setFileStatus('ready')
        setStatus('ready')
        addLog(`Loaded audio: ${f.name}`)
      }
      reader.readAsArrayBuffer(f)
      return
    }

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
      const capacity = Math.floor((img.width * img.height) / 8)
      addLog(`Loaded: ${f.name} — ${img.width}x${img.height} — ~${capacity} chars`)
    }
    img.onerror = () => {
      setFileStatus('none')
      addLog('ERROR: Failed to load image.')
    }
    img.src = URL.createObjectURL(f)
  }

  const handleKeyfile = async (e: React.ChangeEvent<HTMLInputElement>, isDecoy = false) => {
    const f = e.target.files?.[0]
    if (!f) return
    const buf = await f.arrayBuffer()
    const bytes = new Uint8Array(buf)
    if (isDecoy) {
      setDecoyKeyfile(bytes)
      setDecoyKeyfileName(f.name)
      addLog(`Decoy keyfile: ${f.name}`)
    } else {
      setKeyfile(bytes)
      setKeyfileName(f.name)
      addLog(`Keyfile: ${f.name}`)
    }
  }

  const showDecodedMessage = (text: string, isIntact: boolean) => {
    setDecoded(text)
    setIntact(isIntact)
    setDecodedVisible(true)
    if (blurTimer) clearTimeout(blurTimer)
    const t = setTimeout(() => setDecodedVisible(false), 30000)
    setBlurTimer(t)
    setMobileTab('output')
  }

  const getKeyParams = () => ({
    pw: keyMode === 'password' ? password.trim() : '',
    kf: keyMode === 'keyfile' ? keyfile : undefined,
    ss: keyMode === 'ecdh' ? sharedSecret : undefined
  })

  const getScatterKey = (pw: string, kf?: Uint8Array, ss?: Uint8Array): Uint8Array => {
    if (ss) return ss
    if (kf) return kf
    return new TextEncoder().encode(pw)
  }

  const handleEncode = async () => {
    if (!message.trim()) return addLog('ERROR: No payload.')
    if (keyMode === 'password' && !password.trim()) return addLog('ERROR: No key.')
    if (keyMode === 'keyfile' && !keyfile) return addLog('ERROR: No keyfile.')
    if (keyMode === 'ecdh' && !sharedSecret) return addLog('ERROR: ECDH not established.')

    const { pw, kf, ss } = getKeyParams()

    if (carrierMode === 'audio') {
      setStatus('processing')
      addLog('Encrypting...')
      try {
        const encrypted = await encrypt(message.trim(), pw, kf, ss)
        const blob = encodeAudio(encrypted)
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = (outputName.trim() || 'audio') + '.wav'
        a.click()
        setMessage('')
        setPassword('')
        addLog(`Saved: ${outputName.trim() || 'audio'}.wav`)
        setStatus('done')
      } catch (e: unknown) {
        addLog(`ERROR: ${e instanceof Error ? e.message : 'Unknown'}`)
        setStatus('ready')
      }
      return
    }

    if (carrierMode === 'image-gen') {
      setStatus('processing')
      addLog('Encrypting...')
      try {
        const scatterKey = getScatterKey(pw, kf, ss)
        const cipherBytes = await encryptToBytes(message.trim(), pw, kf, ss)
        addLog('Generating carrier...')
        const imageData = generateCarrier(cipherBytes, scatterKey)
        const canvas = canvasRef.current!
        canvas.width = imageData.width
        canvas.height = imageData.height
        canvas.getContext('2d')!.putImageData(imageData, 0, 0)
        const preview = previewCanvasRef.current
        if (preview) {
          preview.width = imageData.width
          preview.height = imageData.height
          preview.getContext('2d')?.putImageData(imageData, 0, 0)
          setShowPreview(true)
        }
        const blob = await stripExif(canvas)
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = (outputName.trim() || 'texture') + '.png'
        a.click()
        setMessage('')
        setPassword('')
        addLog(`Saved: ${outputName.trim() || 'texture'}.png`)
        setStatus('done')
        setMobileTab('output')
      } catch (e: unknown) {
        addLog(`ERROR: ${e instanceof Error ? e.message : 'Unknown'}`)
        setStatus('ready')
      }
      return
    }

    const canvas = canvasRef.current
    if (!canvas || fileStatus !== 'ready') return addLog('ERROR: No image loaded.')
    setStatus('processing')
    addLog('Encrypting...')
    try {
      const scatterKey = getScatterKey(pw, kf, ss)
      const cipherBytes = await encryptToBytes(message.trim(), pw, kf, ss)
      addLog('Encoding...')
      const ctx = canvas.getContext('2d')!
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const encoded = encodeV2(imageData, cipherBytes, scatterKey)
      ctx.putImageData(encoded, 0, 0)
      addLog('Stripping metadata...')
      const blob = await stripExif(canvas)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = (outputName.trim() || 'image') + '.png'
      a.click()
      setMessage('')
      setPassword('')
      setDecoyMessage('')
      setDecoyPassword('')
      addLog(`Saved: ${outputName.trim() || 'image'}.png — window ${timeWindow?.expiresIn ?? '?'}m`)
      setStatus('done')
    } catch (e: unknown) {
      addLog(`ERROR: ${e instanceof Error ? e.message : 'Unknown'}`)
      setStatus('ready')
    }
  }

  const handleDecode = async () => {
    if (keyMode === 'password' && !password.trim()) return addLog('ERROR: No key.')
    if (keyMode === 'keyfile' && !keyfile) return addLog('ERROR: No keyfile.')
    if (keyMode === 'ecdh' && !sharedSecret) return addLog('ERROR: ECDH not established.')

    const { pw, kf, ss } = getKeyParams()
    const scatterKey = getScatterKey(pw, kf, ss)

    if (carrierMode === 'audio') {
      if (!audioBufferRef.current) return addLog('ERROR: No audio loaded.')
      setStatus('processing')
      addLog('Extracting...')
      try {
        const raw = decodeAudio(audioBufferRef.current)
        const result = await decryptString(raw, pw, kf, ss)
        if (result && result.message.trim().length > 0) {
          showDecodedMessage(result.message, result.intact)
          addLog(result.intact ? 'Done. Integrity verified.' : 'Done. WARNING: Integrity check failed.')
          setStatus('done')
          return
        }
        addLog('No data found.')
        setStatus('ready')
      } catch {
        addLog('No data found.')
        setStatus('ready')
      }
      return
    }

    const canvas = canvasRef.current
    if (!canvas || fileStatus !== 'ready') return addLog('ERROR: No image loaded.')
    setStatus('processing')
    addLog('Extracting...')

    try {
      const ctx = canvas.getContext('2d')!
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

      if (carrierMode === 'image-gen') {
        const cipherBytes = decodeCarrier(imageData, scatterKey)
        if (cipherBytes) {
          const result = await decryptFromBytes(cipherBytes, pw, kf, ss)
          if (result && result.message.trim().length > 0) {
            showDecodedMessage(result.message, result.intact)
            addLog(result.intact ? 'Done. Integrity verified.' : 'Done. WARNING: Integrity check failed.')
            setStatus('done')
            return
          }
        }
        addLog('No data found.')
        setStatus('ready')
        return
      }

      const cipherBytes = decodeV2(imageData, scatterKey)
      if (cipherBytes) {
        const result = await decryptFromBytes(cipherBytes, pw, kf, ss)
        if (result && result.message.trim().length > 0) {
          showDecodedMessage(result.message, result.intact)
          addLog(result.intact ? 'Done. Integrity verified. Visible 30s.' : 'Done. WARNING: Integrity check failed.')
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
  const capacity = carrierMode === 'audio' ? getAudioCapacity()
    : carrierMode === 'image-gen' ? getGenerativeCapacity()
    : Math.floor((imageDims.w * imageDims.h) / 8)
  const capacityUsed = capacity > 0 ? Math.min(100, (message.length / capacity) * 100) : 0

  // Shared left panel content
  const LeftPanel = (
    <div className="flex flex-col">

      {/* Carrier */}
      <div className="border-b border-zinc-800 p-4">
        <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">Carrier</p>
        <div className="flex gap-1">
          {([['image', 'Image'], ['image-gen', 'Generate'], ['audio', 'Audio']] as [CarrierMode, string][]).map(([m, label]) => (
            <button key={m}
              onClick={() => { setCarrierMode(m); setFileStatus('none'); setLog([]) }}
              className={`flex-1 text-xs py-2 border transition-all ${
                carrierMode === m ? 'border-zinc-500 text-zinc-300' : 'border-zinc-800 text-zinc-600 hover:border-zinc-700'}`}>
              {label}
            </button>
          ))}
        </div>
        {carrierMode === 'image-gen' && (
          <p className="text-zinc-700 text-xs mt-2">Synthetic Perlin noise — no photo needed. Statistically undetectable.</p>
        )}
      </div>

      {/* File input */}
      <div className="border-b border-zinc-800 p-4">
        <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">
          {carrierMode === 'audio' ? 'Input Audio (decode only)' :
           carrierMode === 'image-gen' ? 'Input Image (decode only)' : 'Input Image'}
        </p>
        <label className={`block border p-4 cursor-pointer transition-all text-center
          ${fileStatus === 'ready' ? 'border-zinc-600 bg-zinc-900' :
            fileStatus === 'loading' ? 'border-zinc-700' : 'border-zinc-800 hover:border-zinc-700'}`}>
          {fileStatus === 'none' && (
            <span className="text-zinc-600 text-xs">
              {carrierMode === 'audio' ? 'Select WAV to decode' :
               carrierMode === 'image-gen' ? 'Select generated PNG to decode' : 'Select PNG file'}
            </span>
          )}
          {fileStatus === 'loading' && <span className="text-zinc-500 text-xs">Loading...</span>}
          {fileStatus === 'ready' && (
            <div>
              <span className="text-zinc-400 text-xs block truncate">{fileName}</span>
              <span className="text-zinc-600 text-xs">
                {carrierMode !== 'audio' ? `${imageDims.w}x${imageDims.h} — ` : ''}
                {(fileSize / 1024).toFixed(1)} KB
              </span>
            </div>
          )}
          <input ref={fileInputRef} type="file"
            accept={carrierMode === 'audio' ? 'audio/wav' : 'image/png'}
            onChange={handleFile} className="hidden" />
        </label>
        {carrierMode === 'audio' && (
          <p className="text-zinc-800 text-xs mt-2">Encoding generates audio automatically.</p>
        )}
      </div>

      {/* Key method */}
      <div className="border-b border-zinc-800 p-4">
        <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">Key Method</p>
        <div className="flex gap-1 mb-3">
          {(['password', 'keyfile', 'ecdh'] as KeyMode[]).map(m => (
            <button key={m} onClick={() => setKeyMode(m)}
              className={`flex-1 text-xs py-2 border transition-all ${
                keyMode === m ? 'border-zinc-500 text-zinc-300' : 'border-zinc-800 text-zinc-600 hover:border-zinc-700'}`}>
              {m === 'ecdh' ? 'ECDH' : m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {keyMode === 'password' && (
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="——————————————" autoComplete="off" spellCheck={false}
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-3 focus:outline-none focus:border-zinc-600 placeholder-zinc-800" />
        )}

        {keyMode === 'keyfile' && (
          <label className={`block border p-3 cursor-pointer text-center transition-all
            ${keyfileName ? 'border-zinc-600 bg-zinc-900' : 'border-zinc-800 hover:border-zinc-700'}`}>
            <span className="text-xs text-zinc-500 block truncate">{keyfileName || 'Select any file as key'}</span>
            {keyfileName && <span className="text-zinc-700 text-xs">Click to change</span>}
            <input ref={keyfileInputRef} type="file" onChange={e => handleKeyfile(e, false)} className="hidden" />
          </label>
        )}

        {keyMode === 'ecdh' && (
          <div className="flex flex-col gap-2">
            {ecdhStatus === 'idle' && (
              <button onClick={handleGenerateKeyPair}
                className="w-full border border-zinc-700 text-zinc-400 text-xs py-2 hover:bg-zinc-900 transition-all">
                Generate Keypair
              </button>
            )}
            {ecdhStatus !== 'idle' && (
              <>
                <p className="text-zinc-700 text-xs">Your public key:</p>
                <div className="bg-zinc-900 border border-zinc-800 p-2">
                  <p className="text-zinc-500 text-xs break-all">{myPublicKey.slice(0, 40)}...</p>
                </div>
                <button onClick={() => navigator.clipboard.writeText(myPublicKey)}
                  className="text-xs text-zinc-600 hover:text-zinc-400 border border-zinc-800 py-1 transition-all">
                  Copy public key
                </button>
                <p className="text-zinc-700 text-xs mt-1">Their public key:</p>
                <textarea value={theirPublicKey} onChange={e => setTheirPublicKey(e.target.value)}
                  placeholder="Paste their public key..." autoComplete="off" spellCheck={false}
                  className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-2 focus:outline-none focus:border-zinc-600 resize-none h-16 placeholder-zinc-800" />
                {ecdhStatus === 'generated' && (
                  <button onClick={handleDeriveSecret} disabled={!theirPublicKey.trim()}
                    className="w-full border border-zinc-600 text-zinc-300 text-xs py-2 hover:bg-zinc-900 transition-all disabled:opacity-30">
                    Establish Channel
                  </button>
                )}
                {ecdhStatus === 'connected' && (
                  <div className="flex flex-col gap-2">
                    <p className="text-zinc-600 text-xs uppercase tracking-widest">Safety number</p>
                    <div className="bg-zinc-900 border border-zinc-800 p-3">
                      <p className="text-zinc-300 text-sm tracking-widest font-mono text-center">{safetyNumber}</p>
                    </div>
                    <p className="text-zinc-700 text-xs">Verify this matches your contact via separate channel.</p>
                    <button onClick={() => setSafetyVerified(v => !v)}
                      className={`text-xs py-2 border transition-all ${safetyVerified ? 'border-zinc-500 text-zinc-300' : 'border-zinc-800 text-zinc-600 hover:border-zinc-700'}`}>
                      {safetyVerified ? 'Verified' : 'Mark as verified'}
                    </button>
                    {!safetyVerified && (
                      <p className="text-zinc-700 text-xs">Confirm safety number before sending sensitive data.</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Payload */}
      <div className="border-b border-zinc-800 p-4">
        <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">
          Payload <span className="text-zinc-800 normal-case">(leave empty to decode)</span>
        </p>
        <textarea value={message} onChange={e => setMessage(e.target.value)}
          placeholder="Type to encode. Leave empty to decode."
          autoComplete="off" spellCheck={false}
          className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-3 focus:outline-none focus:border-zinc-600 resize-none h-28 placeholder-zinc-800" />
      </div>

      {/* Output filename */}
      <div className="border-b border-zinc-800 p-4">
        <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">Output Filename</p>
        <div className="flex items-center gap-1">
          <input type="text" value={outputName} onChange={e => setOutputName(e.target.value)}
            autoComplete="off" spellCheck={false}
            className="flex-1 bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-3 focus:outline-none focus:border-zinc-600" />
          <span className="text-zinc-700 text-xs">{carrierMode === 'audio' ? '.wav' : '.png'}</span>
        </div>
      </div>

      {/* Deniability */}
      {carrierMode === 'image' && (
        <div className="border-b border-zinc-800">
          <button onClick={() => setShowDecoy(v => !v)}
            className="w-full text-left px-4 py-3 text-zinc-700 text-xs hover:text-zinc-500 transition-all uppercase tracking-widest">
            {showDecoy ? '- Deniability layer' : '+ Deniability layer'}
          </button>
          {showDecoy && (
            <div className="px-4 pb-4 flex flex-col gap-3 border-t border-zinc-800 pt-3">
              <p className="text-zinc-700 text-xs">Alternate payload — revealed with alternate key</p>
              <textarea value={decoyMessage} onChange={e => setDecoyMessage(e.target.value)}
                placeholder="Cover payload..." autoComplete="off" spellCheck={false}
                className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-3 focus:outline-none focus:border-zinc-700 resize-none h-20 placeholder-zinc-800" />
              {keyMode === 'password' ? (
                <input type="password" value={decoyPassword} onChange={e => setDecoyPassword(e.target.value)}
                  placeholder="Alternate key" autoComplete="off"
                  className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-3 focus:outline-none focus:border-zinc-700 placeholder-zinc-800" />
              ) : (
                <label className={`block border p-3 cursor-pointer text-center transition-all
                  ${decoyKeyfileName ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-800 hover:border-zinc-700'}`}>
                  <span className="text-xs text-zinc-600 block truncate">{decoyKeyfileName || 'Select alternate keyfile'}</span>
                  <input ref={decoyKeyfileInputRef} type="file" onChange={e => handleKeyfile(e, true)} className="hidden" />
                </label>
              )}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="p-4 flex gap-2">
        <button onClick={handleDecode}
          disabled={status === 'processing' ||
            (carrierMode === 'image' && fileStatus !== 'ready') ||
            (carrierMode === 'image-gen' && fileStatus !== 'ready') ||
            (carrierMode === 'audio' && !audioBufferRef.current)}
          className="flex-1 py-3 text-xs uppercase tracking-widest border border-zinc-700 text-zinc-400 hover:bg-zinc-900 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
          Decode
        </button>
        <button onClick={handleEncode}
          disabled={status === 'processing' || !isEncodeMode ||
            (carrierMode === 'image' && fileStatus !== 'ready')}
          className="flex-1 py-3 text-xs uppercase tracking-widest border border-zinc-400 text-zinc-200 hover:bg-zinc-800 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
          {status === 'processing' ? 'Working...' : 'Encode'}
        </button>
      </div>
    </div>
  )

  // Shared right panel content
  const RightPanel = (
    <div className="flex flex-col h-full">

      {showPreview && (
        <div className="border-b border-zinc-800 p-4">
          <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">Generated carrier</p>
          <canvas ref={previewCanvasRef} className="w-full max-w-xs" style={{ imageRendering: 'pixelated' }} />
        </div>
      )}

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

        {status === 'cleared' && <p className="text-zinc-700 text-xs">Session cleared.</p>}

        {decoded && status !== 'cleared' && (
          <div className={`border bg-zinc-900 p-4 relative ${intact === false ? 'border-red-900' : 'border-zinc-800'}`}>
            {intact !== null && (
              <p className={`text-xs mb-3 uppercase tracking-widest ${intact ? 'text-zinc-700' : 'text-red-800'}`}>
                {intact ? 'integrity verified' : 'warning: possible tampering detected'}
              </p>
            )}
            <p className={`text-zinc-300 text-xs leading-relaxed whitespace-pre-wrap break-words transition-all duration-500 select-none ${decodedVisible ? '' : 'blur-md'}`}>
              {decoded}
            </p>
            {!decodedVisible && (
              <p className="text-zinc-700 text-xs text-center mt-3 select-none">Hold to reveal</p>
            )}
          </div>
        )}

        {!decoded && status !== 'cleared' && <p className="text-zinc-800 text-xs">—</p>}
      </div>

      <div className="border-b border-zinc-800 px-6 py-3">
        <div className="flex justify-between text-xs text-zinc-600 mb-1">
          <span>Capacity</span>
          <span>
            {message.length} / ~{capacity} chars
            {carrierMode === 'image' && fileStatus !== 'ready' && ' (load image)'}
          </span>
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
          <p key={i} className={`text-xs mb-1 ${
            entry.includes('ERROR') || entry.includes('WARNING') ? 'text-zinc-500' : 'text-zinc-600'}`}>
            {entry}
          </p>
        ))}
      </div>
    </div>
  )

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-300 flex flex-col" style={{ fontFamily: 'monospace' }}>

      {/* Top bar */}
      <div className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full transition-colors flex-shrink-0 ${
            status === 'processing' ? 'bg-yellow-500' :
            status === 'done' ? 'bg-zinc-400' :
            status === 'cleared' ? 'bg-zinc-700' : 'bg-zinc-600'}`} />
          <span className="text-zinc-500 text-xs tracking-widest uppercase">wspr</span>
        </div>
        <div className="flex items-center gap-3">
          {timeWindow && (
            <span className={`text-xs hidden sm:inline ${timeWindow.expiresIn <= 10 ? 'text-zinc-500' : 'text-zinc-700'}`}>
              {timeWindow.expiresIn}m
            </span>
          )}
          <button onClick={clearAll}
            className="text-xs text-zinc-600 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 px-3 py-1 transition-all">
            CLEAR
          </button>
        </div>
      </div>

      {/* Desktop layout — side by side */}
      <div className="hidden md:flex flex-1 overflow-hidden">
        <div className="w-96 border-r border-zinc-800 overflow-y-auto flex-shrink-0">
          {LeftPanel}
        </div>
        <div className="flex-1 flex flex-col min-w-0">
          {RightPanel}
        </div>
      </div>

      {/* Mobile layout — tabs */}
      <div className="flex md:hidden flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {mobileTab === 'settings' ? LeftPanel : RightPanel}
        </div>

        {/* Mobile tab bar */}
        <div className="border-t border-zinc-800 flex">
          <button
            onClick={() => setMobileTab('settings')}
            className={`flex-1 py-3 text-xs uppercase tracking-widest transition-all ${
              mobileTab === 'settings' ? 'text-zinc-300 border-t border-zinc-400 -mt-px' : 'text-zinc-600'}`}>
            Settings
          </button>
          <button
            onClick={() => setMobileTab('output')}
            className={`flex-1 py-3 text-xs uppercase tracking-widest transition-all relative ${
              mobileTab === 'output' ? 'text-zinc-300 border-t border-zinc-400 -mt-px' : 'text-zinc-600'}`}>
            Output
            {decoded && mobileTab !== 'output' && (
              <span className="absolute top-2 right-6 w-1.5 h-1.5 bg-zinc-400 rounded-full" />
            )}
          </button>
        </div>
      </div>

      {/* Desktop status bar */}
      <div className="hidden md:flex border-t border-zinc-800 px-6 py-2 items-center justify-between">
        <span className="text-zinc-700 text-xs">
          {status === 'idle' && 'Ready'}
          {status === 'ready' && 'Loaded'}
          {status === 'processing' && 'Processing...'}
          {status === 'done' && (isEncodeMode ? 'Encode complete' : 'Decode complete')}
          {status === 'cleared' && 'Cleared'}
        </span>
        <div className="flex items-center gap-4">
          {timeWindow && (
            <span className={`text-xs ${timeWindow.expiresIn <= 10 ? 'text-zinc-500' : 'text-zinc-700'}`}>
              window {timeWindow.expiresIn}m
            </span>
          )}
          <span className="text-zinc-800 text-xs">AES-256-GCM / LSB-hardened / Perlin / ECDH</span>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </main>
  )
}
