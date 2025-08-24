module.exports = {
  apps: [
    {
      name: 'talimplus',
      script: 'dist/src/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3004,
        DB_HOST: 'localhost',
        DB_PORT: 5432,
        DB_USER: 'talimplus',
        DB_PASS: 'nematov19980524',
        DB_NAME: 'talimplus',
        JWT_SECRET: 'talimplus_secret',
      },
    },
  ],
};
