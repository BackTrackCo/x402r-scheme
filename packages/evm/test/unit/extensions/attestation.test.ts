/* eslint-disable no-undef, @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createAttestationExtension,
  declareAttestationExtension,
  ATTESTATION_KEY,
} from '../../../src/extensions/attestation/index'

const mockContext = {
  requirements: {
    scheme: 'escrow',
    network: 'eip155:84532',
    amount: '10000',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    payTo: '0x1234567890123456789012345678901234567890',
    maxTimeoutSeconds: 300,
    extra: {},
  },
  resourceInfo: { url: '/weather', description: '' },
}

describe('createAttestationExtension', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('uses default key', () => {
    const ext = createAttestationExtension('http://arbiter:3001')
    expect(ext.key).toBe(ATTESTATION_KEY)
  })

  it('accepts custom key', () => {
    const ext = createAttestationExtension('http://arbiter:3001', 'compliance')
    expect(ext.key).toBe('compliance')
  })

  describe('enrichPaymentRequiredResponse', () => {
    it('returns identity on successful fetch', async () => {
      const identity = { role: 'escrow-arbiter', operator: '0xabc', signature: '0xdef' }
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(identity), { status: 200 }),
      )

      const ext = createAttestationExtension('http://arbiter:3001')
      const result = await ext.enrichPaymentRequiredResponse!({}, mockContext as any)

      expect(result).toEqual({ info: { identity } })
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://arbiter:3001/attest/identity',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    it('sends requirements and resource in body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 200 }))

      const ext = createAttestationExtension('http://arbiter:3001')
      await ext.enrichPaymentRequiredResponse!({}, mockContext as any)

      const body = JSON.parse((vi.mocked(globalThis.fetch).mock.calls[0][1] as any).body)
      expect(body.requirements).toEqual(mockContext.requirements)
      expect(body.resource).toEqual(mockContext.resourceInfo)
    })

    it('returns undefined on non-2xx response', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('error', { status: 500, statusText: 'Internal Server Error' }),
      )

      const ext = createAttestationExtension('http://arbiter:3001')
      const result = await ext.enrichPaymentRequiredResponse!({}, mockContext as any)

      expect(result).toBeUndefined()
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[attestation:attestation]'),
        expect.objectContaining({ message: '500 Internal Server Error' }),
      )
    })

    it('returns undefined on network error', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'))

      const ext = createAttestationExtension('http://arbiter:3001')
      const result = await ext.enrichPaymentRequiredResponse!({}, mockContext as any)

      expect(result).toBeUndefined()
      expect(warnSpy).toHaveBeenCalled()
    })

    it('uses custom key in warn messages', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('fail'))

      const ext = createAttestationExtension('http://arbiter:3001', 'my-arbiter')
      await ext.enrichPaymentRequiredResponse!({}, mockContext as any)

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[attestation:my-arbiter]'),
        expect.anything(),
      )
    })

    it('calls chained .onError() on network error', async () => {
      const onError = vi.fn()
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'))

      const ext = createAttestationExtension('http://arbiter:3001').onError(onError)
      const result = await ext.enrichPaymentRequiredResponse!({}, mockContext as any)

      expect(result).toBeUndefined()
      expect(onError).toHaveBeenCalledWith(expect.any(Error))
    })

    it('calls chained .onError() on non-2xx response', async () => {
      const onError = vi.fn()
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('error', { status: 503, statusText: 'Service Unavailable' }),
      )

      const ext = createAttestationExtension('http://arbiter:3001').onError(onError)
      const result = await ext.enrichPaymentRequiredResponse!({}, mockContext as any)

      expect(result).toBeUndefined()
      expect(onError).toHaveBeenCalledWith(expect.any(Error))
      expect((onError.mock.calls[0][0] as Error).message).toBe('503 Service Unavailable')
    })
  })
})

describe('declareAttestationExtension', () => {
  it('returns default key', () => {
    expect(declareAttestationExtension()).toEqual({ [ATTESTATION_KEY]: {} })
  })

  it('returns custom key', () => {
    expect(declareAttestationExtension('compliance')).toEqual({ compliance: {} })
  })
})
