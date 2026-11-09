// pm2 start mcp/ecosystem.config.cjs  (sirlar mcp/.env da, bu yerda emas)
module.exports = {
  apps: [
    {
      name: 'talimplus-mcp',
      cwd: __dirname,
      script: 'server.mjs',
      // fork majburiy: cluster rejimida pm2 ESM (.mjs) faylni ochola olmaydi
      // va node_args ni hisobga olmaydi → ilova darhol `errored` bo'ladi.
      exec_mode: 'fork',
      interpreter_args: '--env-file=.env',
      autorestart: true,
      max_memory_restart: '300M',
    },
  ],
};
