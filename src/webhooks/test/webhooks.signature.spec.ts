import { createHmac } from 'crypto';
import { WebhooksService } from '../webhooks.service';

describe('WebhooksService.verifySignature', () => {
  const secret = 'whsec_test_secret';
  const ts = '1700000000000';
  const body = JSON.stringify({ id: 'd1', event: 'BOOKING_CONFIRMED', data: { ref: 'X' } });
  const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');

  it('accepts a valid signature (with or without sha256= prefix)', () => {
    expect(WebhooksService.verifySignature(secret, ts, body, sig)).toBe(true);
    expect(WebhooksService.verifySignature(secret, ts, body, `sha256=${sig}`)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(WebhooksService.verifySignature(secret, ts, body + 'tampered', sig)).toBe(false);
  });

  it('rejects a tampered timestamp', () => {
    expect(WebhooksService.verifySignature(secret, '1700000000001', body, sig)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    expect(WebhooksService.verifySignature('whsec_other', ts, body, sig)).toBe(false);
  });
});
