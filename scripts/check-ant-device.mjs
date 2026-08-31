// Quick ANT+ USB device detection script — run with: node scripts/check-ant-device.mjs
import { getDeviceList } from 'usb';

const KNOWN_ANT_DEVICES = [
  { vid: 0x0fcf, pid: 0x1008, name: 'ANT USB Stick 2' },
  { vid: 0x0fcf, pid: 0x1004, name: 'ANT USB Stick (gen 1)' },
  { vid: 0x0fcf, pid: 0x1009, name: 'ANT USB-m Stick' },
];

const devices = getDeviceList();

console.log(`USB devices found: ${devices.length}\n`);

let antFound = false;

for (const def of KNOWN_ANT_DEVICES) {
  const device = devices.find(
    (d) =>
      d.deviceDescriptor.idVendor === def.vid &&
      d.deviceDescriptor.idProduct === def.pid
  );

  if (!device) {
    console.log(`[ ] ${def.name} — not detected`);
    continue;
  }

  console.log(`[+] ${def.name} detected (VID=0x${def.vid.toString(16).padStart(4, '0')} PID=0x${def.pid.toString(16).padStart(4, '0')})`);
  antFound = true;

  try {
    device.open();
    console.log('    Driver OK — device opened successfully via libusb (e.g. libusbK/WinUSB)');
    device.close();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`    Driver ERROR — device found but could not open: ${msg}`);
    console.log('    -> Make sure a libusb-compatible driver is installed via Zadig (recommend: libusbK)');
  }
}

if (!antFound) {
  console.log('\nNo ANT+ stick detected. Check:');
  console.log('  1. Dongle is plugged in');
  console.log('  2. Device Manager shows it (not with a warning icon)');
}
