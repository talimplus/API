# Talimplus — faqat o'qiydigan MCP server

Claude (claude.ai / Desktop → **Settings → Connectors**) bazani o'qib, tahlil
qilishi uchun. Hech narsani o'zgartira olmaydi — uchta qavatda himoyalangan:

1. **Postgres roli `talimplus_ro`** — faqat `SELECT`, rol darajasida
   `default_transaction_read_only = on`, 20 s timeout, 5 ta ulanish.
   Yashirilgan: `users.password`, Telegram bot tokeni, QR tokenlar,
   `blacklisted_tokens`, pasport va JSHSHIR (`setup-readonly.sql` boshida ro'yxat).
2. **Server** — har so'rov `BEGIN READ ONLY` ichida, bitta statement
   (extended protocol), oxirida `ROLLBACK`. Natija ko'pi bilan 2000 qator.
3. **Filtr** — faqat `SELECT / WITH / VALUES / TABLE / EXPLAIN / SHOW`.

Tool'lar: `list_tables`, `describe_table`, `query`.

## Serverga o'rnatish

```bash
cd learning-center-saas/mcp
npm ci --omit=dev

# 1) read-only rol (idempotent; yangi jadval qo'shgan migratsiyadan keyin qayta ishga tushiring)
sudo -u postgres psql -d talimplus -v ro_password='KUCHLI_PAROL' -f setup-readonly.sql

# 2) sozlamalar
cp .env.example .env
openssl rand -hex 32        # -> MCP_SECRET (tokenlarni imzolaydi)
nano .env                   # MCP_SECRET, MCP_LOGIN_PASSWORD, MCP_PUBLIC_URL, MCP_DB_PASS

# 3) ishga tushirish
pm2 start ecosystem.config.cjs && pm2 save
curl http://127.0.0.1:3010/health
```

Node **20.6+** kerak (`--env-file`).

## HTTPS (nginx)

Claude.ai connector Anthropic serveridan ulanadi — manzil **ochiq HTTPS** bo'lishi
shart (`localhost` ishlamaydi). Mavjud API domenining `server { }` blokiga **ikkala**
`location` qo'shiladi (`/.well-known/oauth-*` — OAuth topish uchun, busiz connector
"Couldn't register with … sign-in service" deydi):

```nginx
location = /mcp { proxy_pass http://127.0.0.1:3010; include /etc/nginx/mcp_proxy.conf; }
location /mcp/  { proxy_pass http://127.0.0.1:3010; include /etc/nginx/mcp_proxy.conf; }
location /.well-known/oauth- { proxy_pass http://127.0.0.1:3010; include /etc/nginx/mcp_proxy.conf; }
```

`/etc/nginx/mcp_proxy.conf`:
```nginx
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_buffering off;
proxy_read_timeout 60s;
access_log off;
```

Tekshirish: `curl https://<api-domen>/.well-known/oauth-protected-resource/mcp` → JSON.

## Claude'ga ulash

**claude.ai / Claude Desktop:** Settings → Connectors → *Add custom connector*
- Name: `Talimplus DB`
- URL: `https://<api-domen>/mcp`
- OAuth Client ID / Secret — **bo'sh** (Claude o'zi ro'yxatdan o'tadi).
- *Connect* → parol sahifasi ochiladi → `MCP_LOGIN_PASSWORD` → tayyor.

Token 1 soat, refresh 30 kun (Claude o'zi yangilaydi). Barcha ulanishlarni
uzish: `MCP_SECRET` ni almashtirib `pm2 restart talimplus-mcp`. Parolni 5 marta
xato kiritgan IP 15 daqiqaga bloklanadi.

Keyin chatda: *"Talimplus DB orqali oxirgi 3 oy bo'yicha har bir tashkilotning tushumini ko'rsat"*.

**Claude Code:**
```bash
claude mcp add --transport http talimplus-db https://<api-domen>/mcp \
  --header "Authorization: Bearer <MCP_SECRET>"
```

Muqobil (OAuth'siz): `https://<api-domen>/mcp/<MCP_SECRET>` ham ishlaydi.

## Lokal sinov

```bash
psql -d li_tech -v ro_password='test' -f setup-readonly.sql
MCP_SECRET=$(openssl rand -hex 32) MCP_DB_NAME=li_tech MCP_DB_PASS=test node server.mjs
npx @modelcontextprotocol/inspector   # Streamable HTTP, http://127.0.0.1:3010/mcp/<secret>
```
