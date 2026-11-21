import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount, useSignMessage } from 'wagmi'
import { ZERO_BYTES32 } from '@/lib/p2p'
import { apiFetch, BackendApiError, getBackendSession, signInWithWallet, useBackendSession } from '@/lib/api'

export interface NameMatchBadgeData {
  status: 'match' | 'mismatch' | 'unverified'
  maskedInitials: string | null
}

export interface OrderVaultResponse {
  orderId: string
  viewerRole: 'buyer' | 'seller' | 'arbiter' | 'backup_arbiter'
  sellerDetails: {
    sealed: true
    verifiedHash: true
    contentHash: string
    holderName: string
    accountDetails: string
    notes: string
    kycNameMatch: NameMatchBadgeData
  } | null
  buyerPayer: {
    sealed: true
    verifiedHash: true
    contentHash: string
    transferId: string
    senderName: string
    last4: string
    paymentMethod?: string
    kycNameMatch: NameMatchBadgeData
  } | null
}

const MAX_EVIDENCE_BYTES = 1_048_576 // 1 MB server cap

/** Inspect genuine binary magic bytes so renamed .txt / fake .png files are rejected immediately. */
export function detectGenuineMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf' | null {
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  if (
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return 'application/pdf'
  }
  return null
}

function decodeImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      if (img.naturalWidth > 0 && img.naturalHeight > 0) resolve(img)
      else reject(new Error('corrupt_image'))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('corrupt_image'))
    }
    img.src = url
  })
}

export interface PreparedEvidenceFile {
  bytes: Uint8Array
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf'
  name: string
  previewUrl: string | null
}

/**
 * Strictly validates file magic bytes AND decodes images in-browser so fake/renamed files
 * (e.g. `.txt` renamed to `.png`) are rejected, while genuine large screenshots (>1 MB)
 * are cleanly compressed under 1 MB so uploads never fail.
 */
export async function validateAndPrepareEvidence(file: File): Promise<PreparedEvidenceFile> {
  if (file.size === 0) {
    throw new Error('Selected file is empty.')
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error('File is too large (max 12 MB screenshot or 1 MB PDF).')
  }

  const rawBuf = await file.arrayBuffer()
  const rawBytes = new Uint8Array(rawBuf)
  const detectedMime = detectGenuineMime(rawBytes)

  if (!detectedMime) {
    throw new Error('Fake or unsupported file rejected! Only genuine PNG, JPG, WebP images or PDF files are allowed.')
  }

  if (detectedMime === 'application/pdf') {
    if (rawBytes.byteLength > MAX_EVIDENCE_BYTES) {
      throw new Error('PDF receipt must be under 1 MB.')
    }
    return {
      bytes: rawBytes,
      mimeType: 'application/pdf',
      name: file.name.slice(0, 40) || 'receipt.pdf',
      previewUrl: null,
    }
  }

  // Decode image pixels to defeat files that only spoof the first 8 header bytes
  const sourceBlob = new Blob([rawBuf], { type: detectedMime })
  let img: HTMLImageElement
  try {
    img = await decodeImageElement(sourceBlob)
  } catch {
    throw new Error('Corrupted or fake image rejected! Please attach a real screenshot.')
  }

  if (rawBytes.byteLength <= 950_000) {
    return {
      bytes: rawBytes,
      mimeType: detectedMime,
      name: file.name.slice(0, 40) || 'screenshot.png',
      previewUrl: URL.createObjectURL(sourceBlob),
    }
  }

  // Genuine high-res screenshot > 950 KB: scale down cleanly so it fits under 1 MB encrypted limit
  const maxDim = 1600
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process screenshot.')
  ctx.drawImage(img, 0, 0, w, h)

  const compressedBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.84),
  )
  if (!compressedBlob || compressedBlob.size > MAX_EVIDENCE_BYTES) {
    throw new Error('Screenshot exceeds 1 MB even after compression. Crop it slightly and try again.')
  }
  const compBytes = new Uint8Array(await compressedBlob.arrayBuffer())
  return {
    bytes: compBytes,
    mimeType: 'image/jpeg',
    name: file.name.slice(0, 40) || 'screenshot.jpg',
    previewUrl: URL.createObjectURL(compressedBlob),
  }
}

export async function uploadOrderEvidence(
  orderId: bigint,
  prepared: PreparedEvidenceFile,
): Promise<{ id: string; contentHash: string; size: number; mimeType: string }> {
  const buf = new ArrayBuffer(prepared.bytes.byteLength)
  new Uint8Array(buf).set(prepared.bytes)
  return apiFetch<{ id: string; contentHash: string; size: number; mimeType: string }>(
    `/orders/${orderId.toString()}/evidence`,
    {
      method: 'POST',
      headers: { 'content-type': prepared.mimeType },
      rawBody: buf,
    },
  )
}

export async function fetchOrderEvidenceBlob(
  orderId: bigint,
  blobId: string,
): Promise<{ objectUrl: string; mimeType: string }> {
  const session = getBackendSession()
  if (!session) throw new BackendApiError('unauthorized', 401)
  const res = await fetch(`/api/orders/${orderId.toString()}/evidence/${encodeURIComponent(blobId)}`, {
    headers: { authorization: `Bearer ${session.token}` },
  })
  if (!res.ok) {
    throw new BackendApiError('not_found', res.status)
  }
  const blob = await res.blob()
  return { objectUrl: URL.createObjectURL(blob), mimeType: blob.type || 'application/octet-stream' }
}

export function useVaultActions() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const queryClient = useQueryClient()

  const ensureSession = async () => {
    if (!address) throw new Error('Connect wallet first')
    const current = getBackendSession()
    if (current && current.wallet === address.toLowerCase()) return current
    return signInWithWallet(address, signMessageAsync)
  }

  const sealDetails = async (input: {
    kind: 'ad_details' | 'order_details'
    holderName: string
    accountDetails: string
    notes?: string
  }): Promise<{ id: string; contentHash: `0x${string}` }> => {
    await ensureSession()
    return apiFetch<{ id: string; contentHash: `0x${string}` }>('/vault/details', {
      method: 'POST',
      body: input,
    })
  }

  const bindAdDetails = async (blobId: string, adId: bigint): Promise<void> => {
    await apiFetch('/vault/bind-ad', {
      method: 'POST',
      body: { blobId, adId: adId.toString() },
    }).catch(() => undefined)
  }

  const sealPayerProof = async (input: {
    orderId: bigint
    transferId: string
    senderName: string
    last4: string
    paymentMethod?: string
  }): Promise<{ id: string; contentHash: `0x${string}` }> => {
    await ensureSession()
    const res = await apiFetch<{ id: string; contentHash: `0x${string}` }>('/vault/payer', {
      method: 'POST',
      body: {
        orderId: input.orderId.toString(),
        transferId: input.transferId,
        senderName: input.senderName,
        last4: input.last4,
        ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
      },
    })
    void queryClient.invalidateQueries({ queryKey: ['order-vault', input.orderId.toString()] })
    return res
  }

  return { ensureSession, sealDetails, bindAdDetails, sealPayerProof }
}

export function useOrderVault(
  orderId: bigint,
  detailsHash: `0x${string}`,
  payerProof: `0x${string}`,
  canAccess: boolean,
) {
  const { address, isConnected } = useAccount()
  const session = useBackendSession()
  const normalizedWallet = address?.toLowerCase() ?? null
  const isSignedIn = !!(isConnected && normalizedWallet && session && session.wallet === normalizedWallet)
  const hasAnyHash = detailsHash !== ZERO_BYTES32 || payerProof !== ZERO_BYTES32

  return useQuery({
    queryKey: ['order-vault', orderId.toString(), detailsHash, payerProof, session?.token ?? null],
    queryFn: () => apiFetch<OrderVaultResponse>(`/orders/${orderId.toString()}/vault`),
    enabled: isSignedIn && canAccess && hasAnyHash,
    staleTime: 10_000,
    retry: 1,
  })
}
