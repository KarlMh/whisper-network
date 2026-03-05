# Whisper Network

Hide encrypted messages inside ordinary images using steganography. No servers. No accounts. No traces.

Built for journalists, activists, and anyone who needs private communication that doesn't look like private communication.

## How it works

1. Load any PNG image
2. Type your message and set a key (password or keyfile)
3. The message is AES-256 encrypted then hidden inside the image pixels
4. Share the image anywhere — it looks completely normal
5. Recipient loads the image, enters the key, message is revealed

## Security features

- **AES-256-GCM encryption** — military grade
- **LSB steganography** — hidden in pixel data, invisible to the naked eye
- **Temporal keys** — messages expire after ~2 hours automatically
- **Keyfile support** — use any file as a key instead of a password
- **Deniability layer** — embed a decoy message revealed with a different key
- **EXIF stripping** — camera metadata scrubbed from every output image
- **Auto-clear** — session wipes after 5 minutes of inactivity
- **Panic clear** — press ESC twice to instantly wipe everything
- **No server** — everything runs in your browser, nothing is uploaded anywhere

## Run locally
```bash
pnpm install
pnpm dev
```

Open http://localhost:3000

## Stack

- Next.js 15
- Tailwind CSS
- Web Crypto API (AES-256-GCM, PBKDF2)
- Custom LSB steganography engine

## License

MIT
