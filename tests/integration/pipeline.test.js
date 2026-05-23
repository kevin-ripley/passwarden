const { toCsv, toBitwardenJson } = require('../../utils/converter');
const { extractLogins } = require('../../scripts/extractor');

// Full pipeline: stubbed bitwardenMain → extractLogins → convert → verify output
describe('Full export pipeline', () => {
  const mockCiphers = [
    {
      type: 1,
      name: 'GitHub',
      login: { username: 'dev@example.com', password: 'gh-secret', uris: [{ uri: 'https://github.com' }] }
    },
    {
      type: 1,
      name: 'Gmail',
      login: { username: 'me@gmail.com', password: 'gm-secret', uris: [{ uri: 'https://mail.google.com' }] }
    },
    {
      type: 2,
      name: 'SSH Key Note',
      login: null
    }
  ];

  function makeBitwardenMain() {
    return {
      accountService: {
        activeAccount$: {
          subscribe: (cb) => {
            cb({ id: 'real-uuid-1234' });
            return { unsubscribe: jest.fn() };
          }
        }
      },
      cipherService: {
        getAllDecrypted: jest.fn().mockResolvedValue(mockCiphers)
      }
    };
  }

  test('extracts only logins, converts to valid CSV', async () => {
    const bw = makeBitwardenMain();
    const result = await extractLogins(bw);

    expect(result.status).toBe('ok');
    expect(result.logins).toHaveLength(2); // excludes the type:2 note

    const fakeCiphers = result.logins.map(l => ({
      type: 1, name: l.name,
      login: { username: l.username, password: l.password, uris: l.uri ? [{ uri: l.uri }] : [] }
    }));

    const csv = toCsv(fakeCiphers);
    const rows = csv.split('\n');
    expect(rows[0]).toBe('name,username,password,url');
    expect(rows[1]).toBe('GitHub,dev@example.com,gh-secret,https://github.com');
    expect(rows[2]).toBe('Gmail,me@gmail.com,gm-secret,https://mail.google.com');
  });

  test('extracts only logins, converts to valid Bitwarden JSON', async () => {
    const bw = makeBitwardenMain();
    const result = await extractLogins(bw);

    const fakeCiphers = result.logins.map(l => ({
      type: 1, name: l.name,
      login: { username: l.username, password: l.password, uris: l.uri ? [{ uri: l.uri }] : [] }
    }));

    const json = JSON.parse(toBitwardenJson(fakeCiphers));
    expect(json.encrypted).toBe(false);
    expect(json.items).toHaveLength(2);
    expect(json.items[0].name).toBe('GitHub');
    expect(json.items[0].login.username).toBe('dev@example.com');
    expect(json.items[1].name).toBe('Gmail');
  });

  test('locked vault produces no output', async () => {
    const bw = {
      accountService: {
        activeAccount$: {
          subscribe: (cb) => { cb(null); return { unsubscribe: jest.fn() }; }
        }
      },
      stateService: { getUserId: jest.fn().mockResolvedValue(null) },
      cipherService: { getAllDecrypted: jest.fn() }
    };
    const result = await extractLogins(bw);
    expect(result.status).toBe('locked');
    expect(bw.cipherService.getAllDecrypted).not.toHaveBeenCalled();
  });

  test('handles 1000 logins end-to-end', async () => {
    const bigVault = Array.from({ length: 1000 }, (_, i) => ({
      type: 1,
      name: `Site ${i}`,
      login: { username: `u${i}@test.com`, password: `pass${i}`, uris: [{ uri: `https://site${i}.com` }] }
    }));
    const bw = {
      accountService: { activeAccount$: { subscribe: cb => { cb({ id: 'uid' }); return { unsubscribe: jest.fn() }; } } },
      cipherService: { getAllDecrypted: jest.fn().mockResolvedValue(bigVault) }
    };
    const result = await extractLogins(bw);
    expect(result.status).toBe('ok');
    expect(result.logins).toHaveLength(1000);

    const fakeCiphers = result.logins.map(l => ({
      type: 1, name: l.name,
      login: { username: l.username, password: l.password, uris: l.uri ? [{ uri: l.uri }] : [] }
    }));
    expect(() => toCsv(fakeCiphers)).not.toThrow();
    expect(() => toBitwardenJson(fakeCiphers)).not.toThrow();
  });
});
