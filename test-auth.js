const { createAppAuth } = require('@octokit/auth-app');
try {
  createAppAuth({ clientId: '123', clientSecret: 'abc' });
  console.log("Success");
} catch(e) {
  console.log("Error:", e.message);
}
