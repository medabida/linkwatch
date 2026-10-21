export const OOKLA_RESULT = {
  type: "result",
  timestamp: "2026-10-21T10:00:00Z",
  ping: { jitter: 0.8, latency: 12.4, low: 11.1, high: 15.2 },
  download: { bandwidth: 11_875_000, bytes: 140_000_000, elapsed: 14_000, latency: { iqm: 30.1, low: 12.0, high: 80.5, jitter: 5.5 } },
  upload: { bandwidth: 2_500_000, bytes: 30_000_000, elapsed: 12_000, latency: { iqm: 40.2, low: 13.0, high: 90.1, jitter: 6.6 } },
  packetLoss: 0.5,
  isp: "Example ISP",
  interface: { internalIp: "192.168.1.10", name: "eth0", macAddr: "AA:BB:CC:DD:EE:FF", isVpn: false, externalIp: "203.0.113.7" },
  server: { id: 1234, host: "speed.example.com", port: 8080, name: "Example", location: "Berlin", country: "Germany", ip: "198.51.100.1" },
  result: { id: "abc-123", url: "https://www.speedtest.net/result/c/abc-123", persisted: true },
};
