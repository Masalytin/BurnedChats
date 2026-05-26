import os from 'node:os';

export function getActor(): string {
  const { username } = os.userInfo();
  return `${username}@${os.hostname()}`;
}
