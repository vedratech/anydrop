// `ng serve` proxy: uploads go to the mock server (port from AD_PORT, default 3100).
const target = `http://127.0.0.1:${process.env.AD_PORT || 3100}`;
export default { '/upload': { target, secure: false }, '/__config': { target, secure: false } };
