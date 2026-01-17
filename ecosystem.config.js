module.exports = {
  apps: [
    {
      name: 'talimplus',
      script: 'dist/src/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
    },
  ],
};
