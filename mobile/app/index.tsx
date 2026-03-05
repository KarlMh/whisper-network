import 'react-native-get-random-values'
import React, { useState, useRef, useCallback, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, Platform, Pressable, KeyboardAvoidingView,
  ActivityIndicator, Clipboard
} from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import * as ImageManipulator from 'expo-image-manipulator'
import { SafeAreaView } from 'react-native-safe-area-context'
import { encrypt, decrypt, encryptToBytes, decryptFromBytes, getTimeWindow } from '../lib/crypto'
import { encodePixels, decodePixels } from '../lib/steg'
import { generateKeyPair, deriveSharedSecret, exportPrivateKey, importPrivateKey, generateSafetyNumber } from '../lib/keys'

type KeyMode = 'password' | 'keyfile' | 'ecdh'
type Tab = 'settings' | 'output'

const C = {
  bg: '#09090b',
  surface: '#18181b',
  border: '#27272a',
  borderActive: '#71717a',
  text: '#d4d4d8',
  textDim: '#52525b',
  textFaint: '#27272a',
  accent: '#a1a1aa',
  error: '#7f1d1d',
  yellow: '#eab308',
}

export default function App() {
  const [tab, setTab] = useState<Tab>('settings')
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

  const [imageUri, setImageUri] = useState('')
  const [imageName, setImageName] = useState('')
  const [imageWidth, setImageWidth] = useState(0)
  const [imageHeight, setImageHeight] = useState(0)
  const [imagePixels, setImagePixels] = useState<Uint8Array | undefined>()

  const [message, setMessage] = useState('')
  const [outputName, setOutputName] = useState('')

  const [decoded, setDecoded] = useState('')
  const [intact, setIntact] = useState<boolean | null>(null)
  const [decodedVisible, setDecodedVisible] = useState(false)

  const [log, setLog] = useState<string[]>([])
  const [status, setStatus] = useState<'idle' | 'processing' | 'done'>('idle')
  const [timeWindow, setTimeWindow] = useState(getTimeWindow())

  useEffect(() => {
    const i = setInterval(() => setTimeWindow(getTimeWindow()), 30000)
    return () => clearInterval(i)
  }, [])

  const addLog = (msg: string) => {
    const time = new Date().toTimeString().slice(0, 8)
    setLog(prev => [`[${time}] ${msg}`, ...prev].slice(0, 10))
  }

  const clearAll = useCallback(() => {
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
    setImageUri('')
    setImageName('')
    setImagePixels(undefined)
    setMessage('')
    setOutputName('')
    setDecoded('')
    setIntact(null)
    setDecodedVisible(false)
    setLog([])
    setStatus('idle')
    setTab('settings')
    addLog('Session cleared.')
  }, [])

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

  const handlePickImage = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'image/png' })
      if (result.canceled) return
      const asset = result.assets[0]
      const manipulated = await ImageManipulator.manipulateAsync(asset.uri, [], { format: ImageManipulator.SaveFormat.PNG })
      const base64 = await FileSystem.readAsStringAsync(manipulated.uri, { encoding: FileSystem.EncodingType.Base64 })
      const binary = atob(base64)
      // Decode PNG to raw pixels — simplified: use manipulator info
      setImageUri(asset.uri)
      setImageName(asset.name || 'image.png')
      setImageWidth(manipulated.width)
      setImageHeight(manipulated.height)
      setOutputName((asset.name || 'image').replace(/\.[^.]+$/, ''))
      addLog(`Loaded: ${asset.name} — ${manipulated.width}x${manipulated.height}`)
      // Store base64 for pixel access
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      setImagePixels(bytes)
    } catch (e) {
      addLog('ERROR: Failed to load image.')
    }
  }

  const handlePickKeyfile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*' })
      if (result.canceled) return
      const asset = result.assets[0]
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 })
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      setKeyfile(bytes)
      setKeyfileName(asset.name || 'keyfile')
      addLog(`Keyfile: ${asset.name}`)
    } catch {
      addLog('ERROR: Failed to load keyfile.')
    }
  }

  const handleGenerateKeyPair = async () => {
    addLog('Generating keypair...')
    const pair = await generateKeyPair()
    const privRaw = await exportPrivateKey(pair.privateKey)
    setMyPublicKey(pair.publicKeyRaw)
    setMyPrivateKeyRaw(privRaw)
    setEcdhStatus('generated')
    addLog('Keypair generated.')
  }

  const handleDeriveSecret = async () => {
    if (!myPrivateKeyRaw || !theirPublicKey.trim()) return addLog('ERROR: Need both keys.')
    try {
      const privateKey = await importPrivateKey(myPrivateKeyRaw)
      const secret = await deriveSharedSecret(privateKey, theirPublicKey.trim())
      const safety = await generateSafetyNumber(myPublicKey, theirPublicKey.trim())
      setSharedSecret(secret)
      setSafetyNumber(safety)
      setEcdhStatus('connected')
      addLog('Channel established. Verify safety number.')
    } catch {
      addLog('ERROR: Invalid public key.')
    }
  }

  const handleEncode = async () => {
    if (!message.trim()) return addLog('ERROR: No payload.')
    if (!imagePixels) return addLog('ERROR: No image loaded.')
    if (keyMode === 'password' && !password.trim()) return addLog('ERROR: No key.')
    if (keyMode === 'keyfile' && !keyfile) return addLog('ERROR: No keyfile.')
    if (keyMode === 'ecdh' && !sharedSecret) return addLog('ERROR: ECDH not established.')

    setStatus('processing')
    addLog('Encrypting...')
    try {
      const { pw, kf, ss } = getKeyParams()
      const scatterKey = getScatterKey(pw, kf, ss)
      const cipherBytes = await encryptToBytes(message.trim(), pw, kf, ss)
      addLog('Encoding into image...')
      const encodedPixels = encodePixels(imagePixels, imageWidth, imageHeight, cipherBytes, scatterKey)

      // Write back to PNG and share
      const base64 = btoa(String.fromCharCode(...encodedPixels))
      const outPath = `${FileSystem.cacheDirectory}${outputName || 'wspr'}.png`
      await FileSystem.writeAsStringAsync(outPath, base64, { encoding: FileSystem.EncodingType.Base64 })
      await Sharing.shareAsync(outPath, { mimeType: 'image/png' })

      setMessage('')
      setPassword('')
      addLog(`Done. Window: ${timeWindow.expiresIn}m`)
      setStatus('done')
    } catch (e: unknown) {
      addLog(`ERROR: ${e instanceof Error ? e.message : 'Unknown'}`)
      setStatus('idle')
    }
  }

  const handleDecode = async () => {
    if (!imagePixels) return addLog('ERROR: No image loaded.')
    if (keyMode === 'password' && !password.trim()) return addLog('ERROR: No key.')
    if (keyMode === 'keyfile' && !keyfile) return addLog('ERROR: No keyfile.')
    if (keyMode === 'ecdh' && !sharedSecret) return addLog('ERROR: ECDH not established.')

    setStatus('processing')
    addLog('Extracting...')
    try {
      const { pw, kf, ss } = getKeyParams()
      const scatterKey = getScatterKey(pw, kf, ss)
      const cipherBytes = decodePixels(imagePixels, imageWidth, imageHeight, scatterKey)
      if (cipherBytes) {
        const result = await decryptFromBytes(cipherBytes, pw, kf, ss)
        if (result && result.message.trim().length > 0) {
          setDecoded(result.message)
          setIntact(result.intact)
          setDecodedVisible(false)
          setTab('output')
          addLog(result.intact ? 'Done. Integrity verified.' : 'Done. WARNING: Integrity check failed.')
          setStatus('done')
          return
        }
      }
      addLog('No data found.')
      setStatus('idle')
    } catch {
      addLog('No data found.')
      setStatus('idle')
    }
  }

  const isEncodeMode = message.trim().length > 0

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: C.bg }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* Header */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <View style={[s.dot, {
              backgroundColor: status === 'processing' ? C.yellow :
                status === 'done' ? C.accent : C.border
            }]} />
            <Text style={s.headerTitle}>wspr</Text>
          </View>
          <View style={s.headerRight}>
            {timeWindow.expiresIn <= 10 && (
              <Text style={[s.tiny, { color: C.accent, marginRight: 8 }]}>{timeWindow.expiresIn}m</Text>
            )}
            <TouchableOpacity onPress={clearAll} style={s.clearBtn}>
              <Text style={s.clearBtnText}>CLEAR</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Content */}
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          {tab === 'settings' ? (

            <View>
              {/* Image picker */}
              <View style={s.section}>
                <Text style={s.label}>Input Image</Text>
                <TouchableOpacity style={[s.picker, imageUri ? s.pickerActive : {}]} onPress={handlePickImage}>
                  {imageUri ? (
                    <View>
                      <Text style={[s.small, { color: C.text }]} numberOfLines={1}>{imageName}</Text>
                      <Text style={s.tiny}>{imageWidth}x{imageHeight}</Text>
                    </View>
                  ) : (
                    <Text style={s.tiny}>Select PNG file</Text>
                  )}
                </TouchableOpacity>
              </View>

              {/* Key method */}
              <View style={s.section}>
                <Text style={s.label}>Key Method</Text>
                <View style={s.segmented}>
                  {(['password', 'keyfile', 'ecdh'] as KeyMode[]).map(m => (
                    <TouchableOpacity key={m} style={[s.seg, keyMode === m ? s.segActive : {}]} onPress={() => setKeyMode(m)}>
                      <Text style={[s.tiny, { color: keyMode === m ? C.text : C.textDim }]}>
                        {m === 'ecdh' ? 'ECDH' : m.charAt(0).toUpperCase() + m.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {keyMode === 'password' && (
                  <TextInput
                    style={s.input}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="——————————————"
                    placeholderTextColor={C.textFaint}
                    secureTextEntry
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                )}

                {keyMode === 'keyfile' && (
                  <TouchableOpacity style={[s.picker, keyfileName ? s.pickerActive : {}]} onPress={handlePickKeyfile}>
                    <Text style={s.tiny} numberOfLines={1}>{keyfileName || 'Select any file as key'}</Text>
                  </TouchableOpacity>
                )}

                {keyMode === 'ecdh' && (
                  <View style={{ gap: 8, marginTop: 8 }}>
                    {ecdhStatus === 'idle' && (
                      <TouchableOpacity style={s.btnSecondary} onPress={handleGenerateKeyPair}>
                        <Text style={s.btnSecondaryText}>Generate Keypair</Text>
                      </TouchableOpacity>
                    )}
                    {ecdhStatus !== 'idle' && (
                      <>
                        <Text style={s.tiny}>Your public key:</Text>
                        <View style={s.codeBox}>
                          <Text style={s.tiny} numberOfLines={2}>{myPublicKey.slice(0, 40)}...</Text>
                        </View>
                        <TouchableOpacity style={s.btnSecondary} onPress={() => Clipboard.setString(myPublicKey)}>
                          <Text style={s.btnSecondaryText}>Copy public key</Text>
                        </TouchableOpacity>
                        <Text style={s.tiny}>Their public key:</Text>
                        <TextInput
                          style={[s.input, { height: 64 }]}
                          value={theirPublicKey}
                          onChangeText={setTheirPublicKey}
                          placeholder="Paste their public key..."
                          placeholderTextColor={C.textFaint}
                          multiline
                          autoCorrect={false}
                          autoCapitalize="none"
                        />
                        {ecdhStatus === 'generated' && (
                          <TouchableOpacity
                            style={[s.btnSecondary, !theirPublicKey.trim() && { opacity: 0.3 }]}
                            onPress={handleDeriveSecret}
                            disabled={!theirPublicKey.trim()}>
                            <Text style={s.btnSecondaryText}>Establish Channel</Text>
                          </TouchableOpacity>
                        )}
                        {ecdhStatus === 'connected' && (
                          <View style={{ gap: 6 }}>
                            <Text style={s.label}>Safety Number</Text>
                            <View style={s.codeBox}>
                              <Text style={[s.small, { color: C.text, letterSpacing: 4, textAlign: 'center' }]}>{safetyNumber}</Text>
                            </View>
                            <Text style={s.tiny}>Verify this matches your contact via a separate channel.</Text>
                            <TouchableOpacity
                              style={[s.btnSecondary, safetyVerified ? s.btnVerified : {}]}
                              onPress={() => setSafetyVerified(v => !v)}>
                              <Text style={[s.btnSecondaryText, safetyVerified ? { color: C.text } : {}]}>
                                {safetyVerified ? 'Verified ✓' : 'Mark as verified'}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </>
                    )}
                  </View>
                )}
              </View>

              {/* Payload */}
              <View style={s.section}>
                <Text style={s.label}>Payload <Text style={s.tiny}>(leave empty to decode)</Text></Text>
                <TextInput
                  style={[s.input, { height: 100 }]}
                  value={message}
                  onChangeText={setMessage}
                  placeholder="Type to encode. Leave empty to decode."
                  placeholderTextColor={C.textFaint}
                  multiline
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>

              {/* Output filename */}
              <View style={s.section}>
                <Text style={s.label}>Output Filename</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TextInput
                    style={[s.input, { flex: 1 }]}
                    value={outputName}
                    onChangeText={setOutputName}
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                  <Text style={s.tiny}>.png</Text>
                </View>
              </View>

              {/* Actions */}
              <View style={[s.section, { flexDirection: 'row', gap: 8 }]}>
                <TouchableOpacity
                  style={[s.btnSecondary, { flex: 1 }, (!imagePixels || status === 'processing') && { opacity: 0.3 }]}
                  onPress={handleDecode}
                  disabled={!imagePixels || status === 'processing'}>
                  <Text style={s.btnSecondaryText}>Decode</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.btnPrimary, { flex: 1 }, (!isEncodeMode || !imagePixels || status === 'processing') && { opacity: 0.3 }]}
                  onPress={handleEncode}
                  disabled={!isEncodeMode || !imagePixels || status === 'processing'}>
                  {status === 'processing'
                    ? <ActivityIndicator color={C.text} size="small" />
                    : <Text style={s.btnPrimaryText}>Encode</Text>}
                </TouchableOpacity>
              </View>
            </View>

          ) : (

            <View>
              {/* Output */}
              <View style={s.section}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <Text style={s.label}>Output</Text>
                  {decoded && (
                    <Pressable
                      onPressIn={() => setDecodedVisible(true)}
                      onPressOut={() => setDecodedVisible(false)}
                      style={s.revealBtn}>
                      <Text style={s.tiny}>hold to reveal</Text>
                    </Pressable>
                  )}
                </View>

                {decoded ? (
                  <View style={[s.outputBox, intact === false && { borderColor: C.error }]}>
                    {intact !== null && (
                      <Text style={[s.tiny, { marginBottom: 8, color: intact ? C.textDim : '#ef4444' }]}>
                        {intact ? 'integrity verified' : 'WARNING: possible tampering'}
                      </Text>
                    )}
                    <Text style={[s.small, { color: decodedVisible ? C.text : C.bg }]}>
                      {decoded}
                    </Text>
                    {!decodedVisible && (
                      <Text style={[s.tiny, { textAlign: 'center', marginTop: 8 }]}>Hold to reveal</Text>
                    )}
                  </View>
                ) : (
                  <Text style={[s.tiny, { color: C.textFaint }]}>—</Text>
                )}
              </View>

              {/* Log */}
              <View style={s.section}>
                <Text style={s.label}>Log</Text>
                {log.length === 0
                  ? <Text style={[s.tiny, { color: C.textFaint }]}>Awaiting input.</Text>
                  : log.map((entry, i) => (
                    <Text key={i} style={[s.tiny, {
                      marginBottom: 4,
                      color: entry.includes('ERROR') || entry.includes('WARNING') ? C.accent : C.textDim
                    }]}>{entry}</Text>
                  ))
                }
              </View>
            </View>
          )}
        </ScrollView>

        {/* Tab bar */}
        <View style={s.tabBar}>
          <TouchableOpacity style={[s.tab, tab === 'settings' && s.tabActive]} onPress={() => setTab('settings')}>
            <Text style={[s.tiny, { color: tab === 'settings' ? C.text : C.textDim }]}>Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tab, tab === 'output' && s.tabActive]} onPress={() => setTab('output')}>
            <Text style={[s.tiny, { color: tab === 'output' ? C.text : C.textDim }]}>Output</Text>
            {decoded && tab !== 'output' && <View style={s.badge} />}
          </TouchableOpacity>
        </View>

      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { color: C.textDim, fontSize: 11, letterSpacing: 4, textTransform: 'uppercase' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  clearBtn: { borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, paddingVertical: 4 },
  clearBtnText: { color: C.textDim, fontSize: 10, letterSpacing: 2 },
  section: { padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  label: { color: C.textDim, fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 8 },
  small: { fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  tiny: { color: C.textDim, fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  picker: { borderWidth: 1, borderColor: C.border, padding: 16, alignItems: 'center' },
  pickerActive: { borderColor: C.borderActive, backgroundColor: C.surface },
  segmented: { flexDirection: 'row', gap: 4, marginBottom: 8 },
  seg: { flex: 1, borderWidth: 1, borderColor: C.border, paddingVertical: 6, alignItems: 'center' },
  segActive: { borderColor: C.borderActive },
  input: { borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, color: C.text, fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', padding: 12 },
  codeBox: { borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, padding: 10 },
  btnPrimary: { borderWidth: 1, borderColor: C.accent, padding: 14, alignItems: 'center' },
  btnPrimaryText: { color: C.text, fontSize: 10, letterSpacing: 3, textTransform: 'uppercase' },
  btnSecondary: { borderWidth: 1, borderColor: C.border, padding: 10, alignItems: 'center' },
  btnSecondaryText: { color: C.textDim, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase' },
  btnVerified: { borderColor: C.borderActive },
  outputBox: { borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, padding: 16 },
  revealBtn: { borderWidth: 1, borderColor: C.border, paddingHorizontal: 8, paddingVertical: 4 },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabActive: { borderTopWidth: 1, borderTopColor: C.accent, marginTop: -1 },
  badge: { position: 'absolute', top: 10, right: 20, width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent },
})
