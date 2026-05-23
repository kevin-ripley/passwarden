const { toCsv, toBitwardenJson } = require('../utils/converter');

const makeCipher = (overrides = {}) => ({
  type: 1,
  name: 'GitHub',
  login: {
    username: 'user@example.com',
    password: 'abc123',
    uris: [{ uri: 'https://github.com' }]
  },
  ...overrides
});

describe('toCsv', () => {
  test('outputs header row', () => {
    const csv = toCsv([]);
    expect(csv.split('\n')[0]).toBe('name,username,password,url');
  });

  test('converts a single login', () => {
    const csv = toCsv([makeCipher()]);
    const rows = csv.split('\n');
    expect(rows[1]).toBe('GitHub,user@example.com,abc123,https://github.com');
  });

  test('filters out non-login types', () => {
    const note = makeCipher({ type: 2 });
    const csv = toCsv([note]);
    const rows = csv.split('\n').filter(Boolean);
    expect(rows.length).toBe(1); // header only
  });

  test('handles missing login fields gracefully', () => {
    const cipher = { type: 1, name: 'No Login', login: null };
    expect(() => toCsv([cipher])).not.toThrow();
    const csv = toCsv([cipher]);
    expect(csv).toContain('No Login');
  });

  test('handles missing URIs', () => {
    const cipher = makeCipher({ login: { username: 'u', password: 'p', uris: [] } });
    const csv = toCsv([cipher]);
    expect(csv.split('\n')[1]).toBe('GitHub,u,p,');
  });

  test('escapes commas in fields', () => {
    const cipher = makeCipher({ name: 'My, Site' });
    const csv = toCsv([cipher]);
    expect(csv).toContain('"My, Site"');
  });

  test('escapes double quotes in fields', () => {
    const cipher = makeCipher({ name: 'Say "Hello"' });
    const csv = toCsv([cipher]);
    expect(csv).toContain('"Say ""Hello"""');
  });

  test('handles empty vault', () => {
    const csv = toCsv([]);
    expect(csv).toBe('name,username,password,url');
  });

  test('handles 1000 logins without error', () => {
    const ciphers = Array.from({ length: 1000 }, (_, i) =>
      makeCipher({ name: `Site ${i}`, login: { username: `u${i}`, password: `p${i}`, uris: [{ uri: `https://site${i}.com` }] } })
    );
    expect(() => toCsv(ciphers)).not.toThrow();
    const rows = toCsv(ciphers).split('\n');
    expect(rows.length).toBe(1001); // header + 1000 rows
  });
});

describe('toBitwardenJson', () => {
  test('returns valid JSON with encrypted: false', () => {
    const json = toBitwardenJson([]);
    const parsed = JSON.parse(json);
    expect(parsed.encrypted).toBe(false);
    expect(Array.isArray(parsed.items)).toBe(true);
  });

  test('converts a single login', () => {
    const json = JSON.parse(toBitwardenJson([makeCipher()]));
    expect(json.items).toHaveLength(1);
    expect(json.items[0]).toEqual({
      type: 1,
      name: 'GitHub',
      login: {
        username: 'user@example.com',
        password: 'abc123',
        uris: [{ match: null, uri: 'https://github.com' }]
      }
    });
  });

  test('filters out non-login types', () => {
    const json = JSON.parse(toBitwardenJson([makeCipher({ type: 2 })]));
    expect(json.items).toHaveLength(0);
  });

  test('handles null login', () => {
    const cipher = { type: 1, name: 'Broken', login: null };
    expect(() => toBitwardenJson([cipher])).not.toThrow();
    const parsed = JSON.parse(toBitwardenJson([cipher]));
    expect(parsed.items[0].login.username).toBe('');
  });

  test('outputs empty uris array when no URIs', () => {
    const cipher = makeCipher({ login: { username: 'u', password: 'p', uris: null } });
    const parsed = JSON.parse(toBitwardenJson([cipher]));
    expect(parsed.items[0].login.uris).toEqual([]);
  });

  test('uses only first URI when multiple exist', () => {
    const cipher = makeCipher({
      login: { username: 'u', password: 'p', uris: [{ uri: 'https://a.com' }, { uri: 'https://b.com' }] }
    });
    const parsed = JSON.parse(toBitwardenJson([cipher]));
    expect(parsed.items[0].login.uris).toHaveLength(1);
    expect(parsed.items[0].login.uris[0].uri).toBe('https://a.com');
  });
});
