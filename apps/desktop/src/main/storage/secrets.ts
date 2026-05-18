import keytar from 'keytar';

const SERVICE = 'opencodex';

export async function setSecret(account: string, value: string): Promise<void> {
  await keytar.setPassword(SERVICE, account, value);
}

export async function getSecret(account: string): Promise<string | null> {
  return keytar.getPassword(SERVICE, account);
}

export async function deleteSecret(account: string): Promise<boolean> {
  return keytar.deletePassword(SERVICE, account);
}

export async function listSecretAccounts(): Promise<readonly string[]> {
  const creds = await keytar.findCredentials(SERVICE);
  return creds.map((c) => c.account);
}
