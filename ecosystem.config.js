module.exports = {
  apps: [{
    name        : 'pullup',
    script      : 'server.js',
    instances   : 'max',          // Un process par CPU
    exec_mode   : 'cluster',
    watch       : false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV  : 'development',
      PORT      : 3000
    },
    env_production: {
      NODE_ENV  : 'production',
      PORT      : 3000
    },
    error_file  : '/var/log/pullup/error.log',
    out_file    : '/var/log/pullup/out.log',
    log_file    : '/var/log/pullup/combined.log',
    time        : true,
    restart_delay: 3000,
    max_restarts: 10,
  }]
};
