function escapeCsvField(value) {
  const str = String(value == null ? '' : value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function normalizeLogin(cipher) {
  return {
    name: cipher.name || '',
    username: cipher.login?.username || '',
    password: cipher.login?.password || '',
    uri: cipher.login?.uris?.[0]?.uri || ''
  };
}

function toCsv(ciphers) {
  const logins = ciphers.filter(c => c.type === 1).map(normalizeLogin);
  const header = 'name,username,password,url';
  const rows = logins.map(l =>
    [l.name, l.username, l.password, l.uri].map(escapeCsvField).join(',')
  );
  return [header, ...rows].join('\n');
}

function toBitwardenJson(ciphers) {
  const logins = ciphers.filter(c => c.type === 1).map(normalizeLogin);
  const items = logins.map(l => ({
    type: 1,
    name: l.name,
    login: {
      username: l.username,
      password: l.password,
      uris: l.uri ? [{ match: null, uri: l.uri }] : []
    }
  }));
  return JSON.stringify({ encrypted: false, items }, null, 2);
}

module.exports = { toCsv, toBitwardenJson, normalizeLogin };
