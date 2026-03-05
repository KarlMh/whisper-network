'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { encode, decodeChannel } from '@/lib/steg'
import { encrypt, decrypt, getTimeWindow } from '@/lib/crypto'
import { stripExif } from '@/lib/exif'

export default function Home() {
  const [fileStatus, setFileStatus] = useState<'none' | 'loading' | 'ready'>('none')
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [imageDims, setImageDims] = useState({ w: 0, h: 0 })

  const [password, setPassword] = useState('')
  const [keyfile, setKeyfile] = useState<Uint8Array | undefined>()
  const [keyfileName, setKeyfileName] = useState('')
  const [keyMode, setKeyMode] = useState<'password' | 'keyfile'>('password')

  const [decoyPassword, setDecoyPassword] = useState('')
  const [decoyKeyfile, setDecoyKeyfile] = useState<Uint8Array | undefined>()
  const [decoyKeyfileName, setDecoyKeyfileName] = useState('')
  const [decoyMessage, setDecoyMessage] = useState('')
  const [showDecoy, setShowDecoy] = useState(false)

  const [message, setMessage] = useState('')
  const [outputName, setOutputName] = useState('')

  const [decoded, setDecoded] = useState('')
  const [decodedVisible, setDecodedVisible] = useState(false)
  const [blurTimer, setBlurTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  const [log, setLog] = useState<string[]>([])
  const [status, setStatus] = useState<'idle' | 'ready' | 'processing' | 'done' | 'cleared'>('idle')
  const [timeWindow, setTimeWindow] = useState<{ current: string; expiresIn: number } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const keyfileInputRef = useRef<HTMLInputElement>(null)
  const decoyKeyfileInputRef = useRef<HTMLInputElement>(null)
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
    setPassword('')
    setKeyfile(undefined)
    setKeyfileName('')
    setKeyMode('password')
    setDecoyPassword('')
    setDecoyKeyfile(undefined)
    setDecoyKeyfileName('')
    setDecoyMessage('')
    setShowDecoy(false)
    setMessage('')
    setOutputName('')
    setDecoded('')
    setDecodedVisible(false)
    setLog([])
    setStatus('cleared')
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

  // Time window ticker
  useEffect(() => {
    const update = () => setTimeWindow(getTimeWindow())
    update()
    const interval = setInterval(update, 30000)
    return () => clearInterval(interval)
  }, [])

  // ESC x2 panic
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

  // Auto-clear 5 min inactivity
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

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFileStatus('loading')
    setDecoded('')
    setLog([])

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
      addLog(`Loaded: ${f.name} — ${img.width}x${img.height} — capacity ~${capacity} chars`)
    }
    img.onerror = () => {
      setFileStatus('none')
      addLog('ERROR: Failed to load image.')
    }
    img.src = URL.createObjectURL(f)
  }

  const handleKeyfile = async (
    e: React.ChangeEvent<HTMLInputElement>,
    isDecoy = false
  ) => {
    const f = e.target.files?.[0]
    if (!f) return
    const buf = await f.arrayBuffer()
    const bytes = new Uint8Array(buf)
    if (isDecoy) {
      setDecoyKeyfile(bytes)
      setDecoyKeyfileName(f.name)
      addLog(`Decoy keyfile loaded: ${f.name}`)
    } else {
      setKeyfile(bytes)
      setKeyfileName(f.name)
      addLog(`Keyfile loaded: ${f.name}`)
    }
  }

  const showDecoded = (text: string) => {
    setDecoded(text)
    setDecodedVisible(true)
    if (blurTimer) clearTimeout(blurTimer)
    const t = setTimeout(() => setDecodedVisible(false), 30000)
    setBlurTimer(t)
  }

  const handleEncode = async () => {
    const canvas = canvasRef.current
    if (!canvas || fileStatus !== 'ready') return addLog('ERROR: No image loaded.')
    if (!message.trim()) return addLog('ERROR: No payload.')
    if (keyMode === 'password' && !password.trim()) return addLog('ERROR: No key.')
    if (keyMode === 'keyfile' && !keyfile) return addLog('ERROR: No keyfile loaded.')

    setStatus('processing')
    addLog('Encrypting payload...')

    try {
      const realEncrypted = await encrypt(
        message.trim(),
        keyMode === 'password' ? password.trim() : '',
        keyMode === 'keyfile' ? keyfile : undefined
      )

      const decoyEncrypted = (showDecoy && decoyMessage.trim())
        ? await encrypt(
            decoyMessage.trim(),
            decoyKeyfile ? '' : decoyPassword.trim(),
            decoyKeyfile
          )
        : await encrypt('', 'no-decoy-placeholder')

      addLog('Encoding into image...')
      const ctx = canvas.getContext('2d')!
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const encoded = encode(imageData, realEncrypted, decoyEncrypted)
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

      addLog(`Saved: ${outputName.trim() || 'image'}.png — window expires in ${timeWindow?.expiresIn ?? '?'}m`)
      setStatus('done')
    } catch (e: unknown) {
      addLog(`ERROR: ${e instanceof Error ? e.message : 'Unknown error'}`)
      setStatus('ready')
    }
  }

  const handleDecode = async () => {
    const canvas = canvasRef.current
    if (!canvas || fileStatus !== 'ready') return addLog('ERROR: No image loaded.')
    if (keyMode === 'password' && !password.trim()) return addLog('ERROR: No key.')
    if (keyMode === 'keyfile' && !keyfile) return addLog('ERROR: No keyfile loaded.')

    setStatus('processing')
    addLog('Extracting...')

    try {
      const ctx = canvas.getContext('2d')!
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

      const rawReal = decodeChannel(imageData, 0)
      const rawDecoy = decodeChannel(imageData, 1)

      const pw = keyMode === 'password' ? password.trim() : ''
      const kf = keyMode === 'keyfile' ? keyfile : undefined

      const realResult = await decrypt(rawReal, pw, kf)
      if (realResult !== null && realResult.trim().length > 0) {
        showDecoded(realResult)
        addLog('Done. Output visible for 30s.')
        setStatus('done')
        return
      }

      const decoyResult = await decrypt(rawDecoy, pw, kf)
      if (decoyResult !== null && decoyResult.trim().length > 0) {
        showDecoded(decoyResult)
        addLog('Done. Output visible for 30s.')
        setStatus('done')
        return
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

  return (
    <main
      className="min-h-screen bg-zinc-950 text-zinc-300 flex flex-col"
      style={{ fontFamily: 'monospace' }}>

      {/* Top bar */}
      <div className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full transition-colors ${
            status === 'processing' ? 'bg-yellow-500' :
            status === 'done' ? 'bg-zinc-400' :
            status === 'cleared' ? 'bg-zinc-700' :
            'bg-zinc-600'}`}
          />
          <span className="text-zinc-500 text-xs tracking-widest uppercase">
            Image Utility v1.0
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-zinc-700 text-xs">ESC x2 to clear</span>
          <button
            onClick={clearAll}
            className="text-xs text-zinc-600 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 px-3 py-1 transition-all">
            CLEAR
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* Left panel */}
        <div className="w-96 border-r border-zinc-800 flex flex-col overflow-y-auto">

          {/* Image input */}
          <div className="border-b border-zinc-800 p-4">
            <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">Input Image</p>
            <label className={`block border p-4 cursor-pointer transition-all text-center
              ${fileStatus === 'ready' ? 'border-zinc-600 bg-zinc-900' :
                fileStatus === 'loading' ? 'border-zinc-700' :
                'border-zinc-800 hover:border-zinc-700'}`}>
              {fileStatus === 'none' && (
                <span className="text-zinc-600 text-xs">Select PNG file</span>
              )}
              {fileStatus === 'loading' && (
                <span className="text-zinc-500 text-xs">Loading...</span>
              )}
              {fileStatus === 'ready' && (
                <div>
                  <span className="text-zinc-400 text-xs block truncate">{fileName}</span>
                  <span className="text-zinc-600 text-xs">
                    {imageDims.w}x{imageDims.h} — {(fileSize / 1024).toFixed(1)} KB
                  </span>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png"
                onChange={handleFile}
                className="hidden"
              />
            </label>
          </div>

          {/* Key method */}
          <div className="border-b border-zinc-800 p-4">
            <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">Key Method</p>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setKeyMode('password')}
                className={`flex-1 text-xs py-1.5 border transition-all ${
                  keyMode === 'password'
                    ? 'border-zinc-500 text-zinc-300'
                    : 'border-zinc-800 text-zinc-600 hover:border-zinc-700'}`}>
                Password
              </button>
              <button
                onClick={() => setKeyMode('keyfile')}
                className={`flex-1 text-xs py-1.5 border transition-all ${
                  keyMode === 'keyfile'
                    ? 'border-zinc-500 text-zinc-300'
                    : 'border-zinc-800 text-zinc-600 hover:border-zinc-700'}`}>
                Keyfile
              </button>
            </div>

            {keyMode === 'password' && (
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="——————————————"
                autoComplete="off"
                spellCheck={false}
                className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-3 focus:outline-none focus:border-zinc-600 placeholder-zinc-800"
              />
            )}

            {keyMode === 'keyfile' && (
              <label className={`block border p-3 cursor-pointer text-center transition-all
                ${keyfileName ? 'border-zinc-600 bg-zinc-900' : 'border-zinc-800 hover:border-zinc-700'}`}>
                <span className="text-xs text-zinc-500 block truncate">
                  {keyfileName || 'Select any file as key'}
                </span>
                {keyfileName && (
                  <span className="text-zinc-700 text-xs">Click to change</span>
                )}
                <input
                  ref={keyfileInputRef}
                  type="file"
                  onChange={e => handleKeyfile(e, false)}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {/* Payload */}
          <div className="border-b border-zinc-800 p-4">
            <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">
              Payload{' '}
              <span className="text-zinc-800 normal-case">(leave empty to decode)</span>
            </p>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Type to encode. Leave empty to decode."
              autoComplete="off"
              spellCheck={false}
              className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-3 focus:outline-none focus:border-zinc-600 resize-none h-28 placeholder-zinc-800"
            />
          </div>

          {/* Output filename */}
          <div className="border-b border-zinc-800 p-4">
            <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">
              Output Filename
            </p>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={outputName}
                onChange={e => setOutputName(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="flex-1 bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-3 focus:outline-none focus:border-zinc-600"
              />
              <span className="text-zinc-700 text-xs">.png</span>
            </div>
          </div>

          {/* Deniability layer */}
          <div className="border-b border-zinc-800">
            <button
              onClick={() => setShowDecoy(v => !v)}
              className="w-full text-left px-4 py-3 text-zinc-700 text-xs hover:text-zinc-500 transition-all uppercase tracking-widest">
              {showDecoy ? '- Deniability layer' : '+ Deniability layer'}
            </button>

            {showDecoy && (
              <div className="px-4 pb-4 flex flex-col gap-3 border-t border-zinc-800 pt-3">
                <p className="text-zinc-700 text-xs">
                  Alternate payload — revealed with alternate key
                </p>
                <textarea
                  value={decoyMessage}
                  onChange={e => setDecoyMessage(e.target.value)}
                  placeholder="Cover payload..."
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-3 focus:outline-none focus:border-zinc-700 resize-none h-20 placeholder-zinc-800"
                />
                {keyMode === 'password' ? (
                  <input
                    type="password"
                    value={decoyPassword}
                    onChange={e => setDecoyPassword(e.target.value)}
                    placeholder="Alternate key"
                    autoComplete="off"
                    className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-3 focus:outline-none focus:border-zinc-700 placeholder-zinc-800"
                  />
                ) : (
                  <label className={`block border p-3 cursor-pointer text-center transition-all
                    ${decoyKeyfileName ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-800 hover:border-zinc-700'}`}>
                    <span className="text-xs text-zinc-600 block truncate">
                      {decoyKeyfileName || 'Select alternate keyfile'}
                    </span>
                    <input
                      ref={decoyKeyfileInputRef}
                      type="file"
                      onChange={e => handleKeyfile(e, true)}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="p-4 flex gap-2">
            <button
              onClick={handleDecode}
              disabled={status === 'processing' || fileStatus !== 'ready'}
              className="flex-1 py-3 text-xs uppercase tracking-widest border border-zinc-700 text-zinc-400 hover:bg-zinc-900 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
              Decode
            </button>
            <button
              onClick={handleEncode}
              disabled={status === 'processing' || fileStatus !== 'ready' || !isEncodeMode}
              className="flex-1 py-3 text-xs uppercase tracking-widest border border-zinc-400 text-zinc-200 hover:bg-zinc-800 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
              {status === 'processing' ? 'Working...' : 'Encode'}
            </button>
          </div>
        </div>

        {/* Right panel */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Output */}
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

            {status === 'cleared' && (
              <p className="text-zinc-700 text-xs">Session cleared.</p>
            )}

            {decoded && status !== 'cleared' && (
              <div className="border border-zinc-800 bg-zinc-900 p-4 relative">
                <p className={`text-zinc-300 text-xs leading-relaxed whitespace-pre-wrap break-words transition-all duration-500 select-none ${decodedVisible ? '' : 'blur-md'}`}>
                  {decoded}
                </p>
                {!decodedVisible && (
                  <p className="text-zinc-700 text-xs text-center mt-3 select-none">
                    Hold to reveal
                  </p>
                )}
              </div>
            )}

            {!decoded && status !== 'cleared' && (
              <p className="text-zinc-800 text-xs">—</p>
            )}
          </div>

          {/* Capacity bar */}
          {fileStatus === 'ready' && (
            <div className="border-b border-zinc-800 px-6 py-3">
              <div className="flex justify-between text-xs text-zinc-600 mb-1">
                <span>Capacity</span>
                <span>{message.length} / ~{capacity} chars</span>
              </div>
              <div className="w-full bg-zinc-900 h-px">
                <div
                  className={`h-px transition-all ${capacityUsed > 90 ? 'bg-red-800' : 'bg-zinc-600'}`}
                  style={{ width: `${capacityUsed}%` }}
                />
              </div>
            </div>
          )}

          {/* Log */}
          <div className="h-48 p-4 overflow-y-auto">
            <p className="text-zinc-700 text-xs uppercase tracking-widest mb-2">Log</p>
            {log.length === 0 && (
              <p className="text-zinc-800 text-xs">Awaiting input.</p>
            )}
            {log.map((entry, i) => (
              <p key={i} className={`text-xs mb-1 ${
                entry.includes('ERROR') ? 'text-zinc-500' : 'text-zinc-600'}`}>
                {entry}
              </p>
            ))}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="border-t border-zinc-800 px-6 py-2 flex items-center justify-between">
        <span className="text-zinc-700 text-xs">
          {status === 'idle' && 'Ready'}
          {status === 'ready' && 'Image loaded'}
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
          <span className="text-zinc-800 text-xs">
            AES-256-GCM / LSB / PBKDF2 / EXIF-stripped
          </span>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </main>
  )
}
