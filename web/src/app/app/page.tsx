import Link from 'next/link'

export default function AppHub() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-300 flex flex-col" style={{ fontFamily: 'monospace' }}>

      {/* Header */}
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <span className="text-zinc-500 text-xs tracking-widest uppercase">wspr</span>
        <Link href="/" className="text-zinc-700 hover:text-zinc-400 text-xs transition-all uppercase tracking-widest">
          ← back
        </Link>
      </div>

      {/* Hub */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <p className="text-zinc-700 text-xs uppercase tracking-widest mb-12">Select mode</p>

        <div className="w-full max-w-lg flex flex-col gap-3">

          {/* Tool */}
          <Link href="/app/tool"
            className="group border border-zinc-800 hover:border-zinc-600 p-6 transition-all">
            <div className="flex items-start justify-between mb-4">
              <p className="text-zinc-300 text-sm uppercase tracking-widest">Steganography</p>
              <span className="text-zinc-700 text-xs group-hover:text-zinc-500 transition-all">→</span>
            </div>
            <p className="text-zinc-600 text-xs leading-relaxed mb-4">
              Hide encrypted messages inside images or audio files. AES-256-GCM encryption, hardened LSB embedding, generative Perlin noise carrier.
            </p>
            <div className="flex flex-wrap gap-2">
              {['AES-256-GCM', 'LSB hardened', 'Perlin carrier', 'ECDH', 'EXIF strip'].map(tag => (
                <span key={tag} className="text-zinc-800 text-xs border border-zinc-900 px-2 py-0.5">{tag}</span>
              ))}
            </div>
          </Link>

          {/* Chat */}
          <Link href="/chat"
            className="group border border-zinc-800 hover:border-zinc-600 p-6 transition-all">
            <div className="flex items-start justify-between mb-4">
              <p className="text-zinc-300 text-sm uppercase tracking-widest">Encrypted Chat</p>
              <span className="text-zinc-700 text-xs group-hover:text-zinc-500 transition-all">→</span>
            </div>
            <p className="text-zinc-600 text-xs leading-relaxed mb-4">
              P2P encrypted messaging over Nostr. No server, no account, no phone number. Identity is a keypair stored in an encrypted file you control.
            </p>
            <div className="flex flex-wrap gap-2">
              {['Nostr P2P', 'AES-256-GCM', 'No IP leak', 'Contact book', 'File sharing'].map(tag => (
                <span key={tag} className="text-zinc-800 text-xs border border-zinc-900 px-2 py-0.5">{tag}</span>
              ))}
            </div>
          </Link>
        </div>

        <p className="text-zinc-800 text-xs mt-12">Everything runs in your browser. Nothing is transmitted unencrypted.</p>
      </div>

    </main>
  )
}
