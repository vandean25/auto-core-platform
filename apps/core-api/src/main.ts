if (process.env.ACP_WORKER_MODE === 'pdf') {
  void import('./worker-main.js');
} else {
  void import('./api-main.js');
}
