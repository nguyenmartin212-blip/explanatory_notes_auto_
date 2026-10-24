const { networkInterfaces } = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');
const qr = require('qrcode-terminal');

function findLanAddress() {
  const addresses = Object.entries(networkInterfaces()).flatMap(([name, items]) =>
    (items ?? [])
      .filter(
        (item) =>
          item.family === 'IPv4' &&
          !item.internal &&
          /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address),
      )
      .map((item) => ({
        address: item.address,
        priority: /wi-?fi|wlan|wireless/i.test(name) ? 0 : 1,
      })),
  );
  addresses.sort((left, right) => left.priority - right.priority);

  if (!addresses[0]) {
    throw new Error(
      'Could not find a LAN IPv4 address. Set EXPO_PUBLIC_WEB_URL to a reachable web URL.',
    );
  }

  return addresses[0].address;
}

function canUsePort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '::' }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort() {
  const configuredPort = process.env.EXPO_PORT;
  const startPort = Number(configuredPort ?? 8081);
  if (!Number.isInteger(startPort) || startPort < 1 || startPort > 65535) {
    throw new Error('EXPO_PORT must be a valid TCP port.');
  }

  const attempts = configuredPort ? 1 : 50;
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = startPort + offset;
    if (port > 65535) break;
    if (await canUsePort(port)) return port;
  }

  throw new Error(
    configuredPort
      ? `EXPO_PORT ${startPort} is already in use.`
      : `No available Expo port found between ${startPort} and ${startPort + attempts - 1}.`,
  );
}

async function startWeb() {
  const port = await findAvailablePort();
  const lanAddress = findLanAddress();
  const webUrl = new URL(
    process.env.EXPO_PUBLIC_WEB_URL ?? `http://${lanAddress}:${port}`,
  );
  webUrl.search = '';
  webUrl.hash = '';
  webUrl.searchParams.set('visit', '1');
  webUrl.searchParams.set('poi', 'hanoi-thang-long');

  process.env.EXPO_PUBLIC_API_URL ??= `http://${lanAddress}:3000`;
  process.env.EXPO_PUBLIC_WEB_URL ??= `http://${lanAddress}:${port}`;

  console.log('\nQR để mở web trên điện thoại cùng mạng Wi-Fi:');
  console.log(webUrl.toString());
  qr.generate(webUrl.toString(), { small: true });
  console.log(`\nAPI backend: ${process.env.EXPO_PUBLIC_API_URL}`);
  console.log('Đảm bảo backend đang chạy và điện thoại truy cập được địa chỉ API này.\n');

  const expoCli = path.join(process.cwd(), 'node_modules', 'expo', 'bin', 'cli');
  const child = spawn(
    process.execPath,
    [expoCli, 'start', '--web', '--port', String(port)],
    { stdio: 'inherit', env: process.env },
  );

  child.on('error', (error) => {
    console.error('Could not start Expo web:', error);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exitCode = code ?? 1;
    }
  });
}

startWeb().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
