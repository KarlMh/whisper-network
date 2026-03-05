import Link from 'next/link'

export default function Landing() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-300 flex flex-col" style={{ fontFamily: 'monospace' }}>

      {/* Nav */}
      <nav className="border-b border-zinc-900 px-6 py-4 flex items-center justify-between">
        <span className="text-zinc-400 text-sm tracking-widest uppercase">wspr</span>
        <div className="flex items-center gap-4">
          <a href="https://github.com/KarlMh/wspr"
            target="_blank" rel="noopener noreferrer"
            className="text-zinc-600 hover:text-zinc-400 text-xs transition-all tracking-widest uppercase">
            GitHub
          </a>
          <Link href="/app"
            className="text-xs uppercase tracking-widest border border-zinc-600 hover:border-zinc-400 text-zinc-300 px-4 py-1.5 transition-all">
            Launch
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center">
        <div className="mb-6 flex items-center gap-2">
          <span className="text-zinc-700 text-xs uppercase tracking-widest border border-zinc-800 px-3 py-1">
            Open Source
          </span>
          <span className="text-zinc-700 text-xs uppercase tracking-widest border border-zinc-800 px-3 py-1">
            Zero Server
          </span>
          <span className="text-zinc-700 text-xs uppercase tracking-widest border border-zinc-800 px-3 py-1">
            Client-Side Only
          </span>
        </div>

        <h1 className="text-4xl md:text-6xl text-zinc-100 tracking-tight mb-6 max-w-3xl">
          Hide messages inside images.
        </h1>

        <p className="text-zinc-500 text-sm md:text-base max-w-xl mb-10 leading-relaxed">
          wspr is a steganography tool for people who need more than encryption.
          Not just unreadable — invisible. Your message doesn't exist until the right key is applied.
        </p>

        <Link href="/app"
          className="text-sm uppercase tracking-widest border border-zinc-400 hover:border-zinc-200 text-zinc-200 hover:text-white px-8 py-3 transition-all">
          Open wspr →
        </Link>
      </section>

      {/* Threat model */}
      <section className="border-t border-zinc-900 px-6 py-16 max-w-4xl mx-auto w-full">
        <p className="text-zinc-700 text-xs uppercase tracking-widest mb-8">Who it's for</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              title: 'Journalists',
              body: 'Communicate with sources across monitored channels. An image posted publicly contains nothing — until decoded with the pre-shared key.'
            },
            {
              title: 'Activists',
              body: 'Operate in environments where encrypted messages invite scrutiny. wspr produces files that are statistically indistinguishable from ordinary images.'
            },
            {
              title: 'Security researchers',
              body: 'Evaluate steganographic techniques. Mode A uses hardened LSB with chi-square normalization. Mode B uses generative Perlin noise carriers.'
            }
          ].map(({ title, body }) => (
            <div key={title} className="border border-zinc-900 p-5">
              <p className="text-zinc-300 text-xs uppercase tracking-widest mb-3">{title}</p>
              <p className="text-zinc-600 text-xs leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-zinc-900 px-6 py-16 max-w-4xl mx-auto w-full">
        <p className="text-zinc-700 text-xs uppercase tracking-widest mb-8">How it works</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              step: '01',
              title: 'Encrypt',
              body: 'Your message is encrypted with AES-256-GCM using your password, keyfile, or an ECDH-derived shared secret. A SHA-256 integrity hash is embedded.'
            },
            {
              step: '02',
              title: 'Hide',
              body: 'The ciphertext is scattered across pixel LSBs using a key-seeded pseudo-random permutation. Every unused pixel is filled with key-derived noise to defeat statistical analysis.'
            },
            {
              step: '03',
              title: 'Send',
              body: 'The output is a standard PNG with EXIF metadata stripped. It passes visual inspection, chi-square tests, and sequential pattern detectors.'
            }
          ].map(({ step, title, body }) => (
            <div key={step} className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="text-zinc-800 text-xs">{step}</span>
                <div className="flex-1 h-px bg-zinc-900" />
              </div>
              <p className="text-zinc-300 text-xs uppercase tracking-widest">{title}</p>
              <p className="text-zinc-600 text-xs leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature list */}
      <section className="border-t border-zinc-900 px-6 py-16 max-w-4xl mx-auto w-full">
        <p className="text-zinc-700 text-xs uppercase tracking-widest mb-8">Technical features</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            ['AES-256-GCM encryption', 'Industry-standard authenticated encryption'],
            ['PBKDF2 key derivation', '100,000 iterations, SHA-256'],
            ['Temporal keys', '2-hour expiry window — old messages auto-expire'],
            ['ECDH key exchange', 'Establish shared secrets without transmitting them'],
            ['Safety numbers', 'Verify key exchange integrity out-of-band'],
            ['LSB scatter pattern', 'Key-seeded pixel permutation — defeats sequential detectors'],
            ['Chi-square normalization', 'LSB distribution matches natural image statistics'],
            ['Whole-image noise fill', 'All unused pixels randomized — no statistical signature'],
            ['Generative carrier', 'Perlin noise images — nothing was modified, nothing to detect'],
            ['Audio steganography', 'Hide messages in WAV files'],
            ['Deniability layer', 'Dual-channel encoding — alternate key reveals alternate message'],
            ['EXIF stripping', 'All metadata removed from output files'],
            ['SHA-256 integrity', 'Detect tampering in transit'],
            ['Panic wipe', 'ESC × 2 clears all state instantly'],
            ['Auto-clear', '5-minute inactivity wipe'],
            ['Zero server', 'Everything runs in the browser — nothing is transmitted'],
          ].map(([feature, description]) => (
            <div key={feature} className="flex gap-3 py-2 border-b border-zinc-900">
              <span className="text-zinc-500 text-xs w-48 flex-shrink-0">{feature}</span>
              <span className="text-zinc-700 text-xs">{description}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Open source */}
      <section className="border-t border-zinc-900 px-6 py-16 max-w-4xl mx-auto w-full">
        <p className="text-zinc-700 text-xs uppercase tracking-widest mb-8">Open source</p>
        <div className="border border-zinc-900 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="text-zinc-300 text-xs mb-2">MIT License — audit it, fork it, self-host it.</p>
            <p className="text-zinc-600 text-xs leading-relaxed max-w-lg">
              wspr is fully open source. The cryptographic implementation is auditable.
              No obfuscation, no telemetry, no server. If you don't trust the hosted version, run it locally in under a minute.
            </p>
          </div>
          <a href="https://github.com/KarlMh/wspr"
            target="_blank" rel="noopener noreferrer"
            className="text-xs uppercase tracking-widest border border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-zinc-200 px-6 py-3 transition-all whitespace-nowrap">
            View on GitHub →
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-900 px-6 py-6 flex items-center justify-between">
        <span className="text-zinc-800 text-xs">wspr — steganography utility</span>
        <Link href="/app"
          className="text-zinc-700 hover:text-zinc-400 text-xs transition-all uppercase tracking-widest">
          Launch tool →
        </Link>
      </footer>

    </main>
  )
}
