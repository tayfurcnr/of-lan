# of-lan

OF-LAN is a local network file sharing and communication tool.

## Run

```bash
npm install
npm start
```

## Access

- Local hostname: `http://oflan.local`
- Direct LAN IP: `http://<server-ip>`

## Notes

- The app advertises itself on the LAN with mDNS/Bonjour when supported.
- If `oflan.local` does not resolve on a client, install Bonjour/mDNS support or use the server IP directly.
- Messages are relayed through the server, so clients on the same LAN can chat without WebRTC setup.
