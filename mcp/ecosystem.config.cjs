// pm2 start mcp/ecosystem.config.cjs  (sirlar mcp/.env da, bu yerda emas)
module.exports = {
  apps: [
    {
      name: 'talimplus-mcp',
      cwd: __dirname,
      script: 'server.mjs',
      node_args: '--env-file=.env',
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
    },
  ],
};
