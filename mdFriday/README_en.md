## Introduction

**MDFriday** is a digital asset creation assistant. Write in Obsidian, sync across devices, and publish instantly to the web. Features 500+ beautiful themes covering docs, blogs, resumes, portfolios, slides, and more.

## Features

- **Instant Publishing**: Write Markdown in Obsidian and publish as a professional website with one click.
- **Multi-Device Sync**: Real-time cross-device sync via CouchDB, write from anywhere.
- **Rich Themes**: 500+ beautiful themes for docs, blogs, resumes, portfolios, slides, and more.
- **Automatic HTTPS**: Built-in Caddy integration for automatic SSL certificate management with DNSPod support.

## Setup Notes

### Basic Configuration

After installation, configure the following:
- **Domain**: Your server domain name
- **Server IP**: Your server's public IP address
- **Admin Email and Password**: For logging into the MDFriday admin panel
- **CouchDB User and Password**: Database credentials

### Enable DNSPod (Optional)

For automatic HTTPS certificate management:
1. Set `DNSPOD_ENABLED` to `true`
2. Fill in `DNSPOD_ID` and `DNSPOD_SECRET` (obtain from DNSPod Console)

### Access Services

After deployment:
- **Main Site**: `http://your-server-ip:${PANEL_APP_PORT_HTTP}`
- **CouchDB Admin**: `http://your-server-ip:${PANEL_APP_PORT_HTTP}/_utils` (via cdb subdomain)
