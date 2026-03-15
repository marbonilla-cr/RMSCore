export function startKeepAlive() {
  const ping = () => fetch("/api/health").catch(() => {});
  ping();
  setInterval(ping, 4 * 60 * 1000);
}
