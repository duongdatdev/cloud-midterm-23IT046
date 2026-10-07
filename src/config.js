function required(name) {
  const value = process.env[name];
  if (!value || value.includes('YOUR_') || value.startsWith('REPLACE_')) {
    throw new Error(`Chua cau hinh bien moi truong ${name}.`);
  }
  return value;
}

export function loadConfig() {
  const config = {
    readUri: required('MONGODB_READ_URI'),
    writeUri: required('MONGODB_WRITE_URI'),
    sessionSecret: required('SESSION_SECRET'),
    adminUsername: required('ADMIN_USERNAME'),
    adminPassword: required('ADMIN_PASSWORD'),
    production: process.env.NODE_ENV === 'production',
    port: Number(process.env.PORT || 3000)
  };
  if (config.sessionSecret.length < 32) throw new Error('SESSION_SECRET phai co it nhat 32 ky tu.');
  if (config.adminPassword.length < 12) throw new Error('ADMIN_PASSWORD phai co it nhat 12 ky tu.');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('PORT khong hop le.');
  }
  for (const uri of [config.readUri, config.writeUri]) {
    if (!uri.startsWith('mongodb+srv://') && !uri.startsWith('mongodb://')) {
      throw new Error('URI MongoDB khong hop le.');
    }
  }
  return Object.freeze(config);
}
