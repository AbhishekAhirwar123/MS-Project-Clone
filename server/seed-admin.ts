// Creates the first admin account (or resets an existing admin's password), using values from .env:
//   ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD
// Run once after setting up the database:  npm run seed:admin
try { process.loadEnvFile('.env'); } catch { /* no .env file */ }

const { ObjectId } = await import('mongodb');
const { col, closeDb, dbName } = await import('./db.js');
const { hashPassword, passwordProblem } = await import('./passwords.js');

const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const name = (process.env.ADMIN_NAME || 'Administrator').trim();
const password = process.env.ADMIN_PASSWORD || '';

if (!email || !password) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env first.');
  process.exit(1);
}
const problem = passwordProblem(password);
if (problem) { console.error(problem); process.exit(1); }

try {
  const users = await col.users();
  const now = new Date();
  const existing = await users.findOne({ email });
  if (existing) {
    await users.updateOne({ _id: existing._id }, { $set: { role: 'admin', active: true, passwordHash: await hashPassword(password), mustChangePassword: false, updatedAt: now } });
    console.log('Updated ' + email + ': role set to admin and password reset (database "' + dbName() + '").');
  } else {
    await users.insertOne({ _id: new ObjectId(), email, name, role: 'admin', passwordHash: await hashPassword(password), active: true, mustChangePassword: false, createdAt: now, updatedAt: now });
    console.log('Created admin ' + email + ' in database "' + dbName() + '".');
  }
  console.log('You can now remove ADMIN_PASSWORD from .env.');
} catch (e) {
  console.error('Could not create the admin:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await closeDb();
}
