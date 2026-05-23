const { extractLogins } = require('../scripts/extractor');

function makeBitwardenMain({ userId = 'test-uuid', ciphers = [], locked = false } = {}) {
  return {
    accountService: {
      activeAccount$: {
        subscribe: (cb) => {
          cb(locked ? null : { id: userId });
          return { unsubscribe: jest.fn() };
        }
      }
    },
    stateService: {
      getUserId: jest.fn().mockResolvedValue(locked ? null : userId)
    },
    cipherService: {
      getAllDecrypted: jest.fn().mockResolvedValue(ciphers)
    }
  };
}

describe('extractLogins', () => {
  test('returns not_found when bitwardenMain is absent', async () => {
    const result = await extractLogins(undefined);
    expect(result.status).toBe('not_found');
  });

  test('returns locked when no active userId', async () => {
    const bw = makeBitwardenMain({ locked: true });
    const result = await extractLogins(bw);
    expect(result.status).toBe('locked');
  });

  test('returns ok with login array on success', async () => {
    const ciphers = [{
      type: 1,
      name: 'GitHub',
      login: { username: 'user@example.com', password: 'secret', uris: [{ uri: 'https://github.com' }] }
    }];
    const bw = makeBitwardenMain({ ciphers });
    const result = await extractLogins(bw);
    expect(result.status).toBe('ok');
    expect(result.logins).toHaveLength(1);
    expect(result.logins[0]).toEqual({
      name: 'GitHub',
      username: 'user@example.com',
      password: 'secret',
      uri: 'https://github.com'
    });
  });

  test('filters out non-login cipher types', async () => {
    const ciphers = [
      { type: 1, name: 'Login', login: { username: 'u', password: 'p', uris: [] } },
      { type: 2, name: 'Note', login: null },
      { type: 3, name: 'Card', login: null }
    ];
    const bw = makeBitwardenMain({ ciphers });
    const result = await extractLogins(bw);
    expect(result.logins).toHaveLength(1);
    expect(result.logins[0].name).toBe('Login');
  });

  test('uses stateService fallback when accountService absent', async () => {
    const ciphers = [{ type: 1, name: 'Test', login: { username: 'u', password: 'p', uris: [] } }];
    const bw = makeBitwardenMain({ ciphers });
    delete bw.accountService;
    const result = await extractLogins(bw);
    expect(result.status).toBe('ok');
  });

  test('returns locked when getAllDecrypted throws', async () => {
    const bw = makeBitwardenMain();
    bw.cipherService.getAllDecrypted.mockRejectedValue(new Error('vault locked'));
    const result = await extractLogins(bw);
    expect(result.status).toBe('locked');
  });

  test('handles missing login fields on ciphers', async () => {
    const ciphers = [{ type: 1, name: 'Broken', login: null }];
    const bw = makeBitwardenMain({ ciphers });
    const result = await extractLogins(bw);
    expect(result.status).toBe('ok');
    expect(result.logins[0]).toEqual({ name: 'Broken', username: '', password: '', uri: '' });
  });

  test('returns ok with empty logins on empty vault', async () => {
    const bw = makeBitwardenMain({ ciphers: [] });
    const result = await extractLogins(bw);
    expect(result.status).toBe('ok');
    expect(result.logins).toHaveLength(0);
  });
});
