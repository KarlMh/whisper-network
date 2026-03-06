'use client'
import { useEffect, useRef } from 'react'
import { CallState } from '@/lib/call'

type Props = {
  state: CallState
  contactName: string
  duration: number
  localVolume: number
  remoteVolume: number
  muted: boolean
  remoteStream: MediaStream | null
  onAnswer: () => void
  onDecline: () => void
  onHangup: () => void
  onMute: () => void
  onClose: () => void
}

function VoiceRings({ volume, label }: { volume: number; label: string }) {
  const active = volume > 8
  const rings = [1, 2, 3]
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative flex items-center justify-center w-20 h-20">
        {rings.map((r) => (
          <div
            key={r}
            className="absolute rounded-full border transition-all duration-100"
            style={{
              width: `${20 + r * 16 + (active ? volume * 0.3 * r : 0)}px`,
              height: `${20 + r * 16 + (active ? volume * 0.3 * r : 0)}px`,
              borderColor: active
                ? `rgba(161,161,170,${0.4 - r * 0.1})`
                : `rgba(63,63,70,${0.4 - r * 0.1})`,
              opacity: active ? 1 : 0.3,
            }}
          />
        ))}
        <div className={`w-12 h-12 rounded-full border-2 flex items-center justify-center transition-all ${
          active ? 'border-zinc-400 bg-zinc-800' : 'border-zinc-700 bg-zinc-900'
        }`}>
          <span className="text-lg">{label === 'You' ? '🎙' : '🔊'}</span>
        </div>
      </div>
      <p className={`text-xs tracking-widest uppercase transition-all ${active ? 'text-zinc-400' : 'text-zinc-700'}`}>
        {label}
      </p>
    </div>
  )
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60).toString().padStart(2, '0')
  const sec = (s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}

export default function CallOverlay({
  state, contactName, duration, localVolume, remoteVolume,
  muted, remoteStream, onAnswer, onDecline, onHangup, onMute, onClose
}: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    if (audioRef.current && remoteStream) {
      audioRef.current.srcObject = remoteStream
    }
  }, [remoteStream])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ fontFamily: 'monospace', backgroundColor: 'rgba(9,9,11,0.97)', height: '100dvh' }}>
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      <div className="w-full max-w-sm flex flex-col items-center gap-6 px-6 py-8" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))', paddingTop: 'max(2rem, env(safe-area-inset-top))' }}>

        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 mb-1">
            <div className={`w-1.5 h-1.5 rounded-full ${
              state === 'connected' ? 'bg-zinc-400' :
              state === 'calling' || state === 'receiving' ? 'bg-yellow-500 animate-pulse' :
              'bg-zinc-700'}`} />
            <span className="text-zinc-600 text-xs uppercase tracking-widest">
              {state === 'calling' ? 'calling' :
               state === 'receiving' ? 'incoming call' :
               state === 'connected' ? 'connected' :
               state === 'ended' ? 'call ended' : ''}
            </span>
          </div>
          <p className="text-zinc-300 text-sm uppercase tracking-widest">{contactName}</p>
          {state === 'connected' && (
            <p className="text-zinc-600 text-xs font-mono">{formatDuration(duration)}</p>
          )}
        </div>

        {state === 'connected' && (
          <div className="flex items-end justify-center gap-16">
            <VoiceRings volume={muted ? 0 : localVolume} label="You" />
            <VoiceRings volume={remoteVolume} label={contactName} />
          </div>
        )}

        {state === 'calling' && (
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full border border-zinc-800 flex items-center justify-center relative">
              <div className="absolute inset-0 rounded-full border border-zinc-600 animate-ping opacity-30" />
              <span className="text-2xl">☎</span>
            </div>
            <p className="text-zinc-700 text-xs">Waiting for {contactName}...</p>
          </div>
        )}

        {state === 'receiving' && (
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full border border-zinc-600 flex items-center justify-center relative">
              <div className="absolute inset-0 rounded-full border border-zinc-400 animate-ping opacity-20" />
              <div className="absolute inset-2 rounded-full border border-zinc-600 animate-ping opacity-20" style={{ animationDelay: '0.3s' }} />
              <span className="text-2xl">☎</span>
            </div>
          </div>
        )}

        {state === 'connected' && (
          <div className="flex items-center gap-2 border border-zinc-900 px-4 py-2">
            <div className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
            <span className="text-zinc-700 text-xs">DTLS-SRTP · P2P · Nostr signaling</span>
          </div>
        )}

        <div className="flex gap-3 w-full">
          {state === 'receiving' && (<>
            <button onClick={onAnswer}
              className="flex-1 border border-zinc-500 text-zinc-300 hover:bg-zinc-800 text-xs py-4 uppercase tracking-widest transition-all">
              Answer
            </button>
            <button onClick={onDecline}
              className="flex-1 border border-zinc-800 text-zinc-600 hover:border-red-900 hover:text-red-700 text-xs py-4 uppercase tracking-widest transition-all">
              Decline
            </button>
          </>)}

          {state === 'calling' && (
            <button onClick={onDecline}
              className="flex-1 border border-zinc-800 text-zinc-600 hover:border-red-900 hover:text-red-700 text-xs py-4 uppercase tracking-widest transition-all">
              Cancel
            </button>
          )}

          {state === 'connected' && (<>
            <button onClick={onMute}
              className={`flex-1 border text-xs py-4 uppercase tracking-widest transition-all ${
                muted ? 'border-zinc-500 text-zinc-300 bg-zinc-900' : 'border-zinc-800 text-zinc-600 hover:border-zinc-600'}`}>
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button onClick={onHangup}
              className="flex-1 border border-zinc-800 text-zinc-600 hover:border-red-900 hover:text-red-700 text-xs py-4 uppercase tracking-widest transition-all">
              End
            </button>
          </>)}

          {state === 'ended' && (
            <button onClick={onClose}
              className="flex-1 border border-zinc-800 text-zinc-600 text-xs py-4 uppercase tracking-widest transition-all">
              Close
            </button>
          )}
        </div>

        {state === 'connected' && (
          <p className="text-zinc-800 text-xs text-center">
            Your IP may be visible to your peer. Use a VPN for full anonymity.
          </p>
        )}
      </div>
    </div>
  )
}
