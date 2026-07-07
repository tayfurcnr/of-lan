# of-lan

OF-LAN is a local network file sharing and communication tool.

## Run

```bash
npm install
npm start
```

The app listens on port `80` by default, so on Linux you usually need to start it with elevated privileges:

```bash
sudo npm start
```

To advertise the app as `oflan.local` over mDNS/Bonjour, start it with:

```bash
OFLAN_ENABLE_MDNS=1 npm start
```

## Access

- Local hostname: `http://oflan.local`
- Direct LAN IP: `http://<server-ip>`

## Notes

- The app advertises itself on the LAN with mDNS/Bonjour when supported.
- If `oflan.local` does not resolve on a client, install Bonjour/mDNS support or use the server IP directly.
- Messages are relayed through the server, so clients on the same LAN can chat without WebRTC setup.

## Backup / Restore

The admin panel can back up and restore the persistent app data.

### Backup

- Open the admin panel and sign in.
- Click `Backup`.
- The app downloads a `.tar.gz` archive that includes:
  - `data/`
  - `uploads/`
- The admin panel also shows the latest downloaded backup timestamp and app version.

### Restore

- Open the admin panel and sign in.
- Click `Restore`.
- Select a `.tar.gz` or `.tgz` backup archive.
- The backup is staged first and will be applied on the next server restart.

### What gets restored

- SQLite database data under `data/`
- Uploaded/shared files under `uploads/`

### Important

- Restore replaces the current `data/` and `uploads/` contents.
- Restart the server after uploading a restore archive to activate it.
- Keep a copy of any current files you still need before restoring.
